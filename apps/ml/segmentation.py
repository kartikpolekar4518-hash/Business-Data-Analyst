"""Customer segments — `segment:v1.0.0`.

Recency, frequency and monetary value per customer, clustered together. The
deterministic engine already splits customers on revenue quartiles; that is one
axis, and one axis is all it can be. Personas need the three together, which is a
different problem and the reason this runs here.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

import contract
import data

MODEL_VERSION = "segment:v1.0.0"

MIN_CUSTOMERS = 50
# Below this, the clusters are an artefact of the algorithm rather than a shape in
# the data. Saying so beats naming five groups that do not exist.
MIN_SILHOUETTE = 0.15
K_RANGE = range(2, 7)
# Bounds the stored result. A million customers must not become a million-row Json
# column; the clusters and their sizes are exact either way.
MAX_CUSTOMERS_RETURNED = 5000


def run(rows: list[dict[str, Any]], schema: dict[str, str], config: dict[str, Any]) -> dict[str, Any]:
    rows_in = len(rows)
    refuse = lambda reason: contract.insufficient(MODEL_VERSION, reason, rows_in=rows_in)

    customer_column = data.pick(schema, "customer_id", "customer_name")
    date_column = data.pick(schema, "date")
    revenue_column = data.pick(schema, "revenue", "sales")
    if not customer_column:
        return refuse("No customer column was detected, so there is nobody to group.")
    if not date_column:
        return refuse("No date column was detected, so how recently anyone bought is unknown.")
    if not revenue_column:
        return refuse("No revenue column was detected, so how much anyone spends is unknown.")

    columns = {"customer": customer_column, "date": date_column, "revenue": revenue_column}
    order_column = data.pick(schema, "order_id")
    if order_column:
        columns["order"] = order_column

    frame = data.build(rows, columns)
    frame["customer"] = data.keys(frame["customer"])
    frame["date"] = data.dates(frame["date"])
    frame["revenue"] = data.numbers(frame["revenue"])
    frame = frame.dropna(subset=["customer", "date", "revenue"])
    if frame.empty:
        return refuse("No row had a customer, a date and a revenue figure together.")

    rfm = _rfm(frame, has_orders="order" in frame.columns)
    if len(rfm) < MIN_CUSTOMERS:
        return refuse(
            f"Only {len(rfm)} customers have usable history. "
            f"Grouping needs at least {MIN_CUSTOMERS}."
        )

    # Log first: spend and order counts are long-tailed, and without it one
    # outlier customer becomes a cluster of one.
    features = StandardScaler().fit_transform(
        np.column_stack([
            np.log1p(rfm["recencyDays"].clip(lower=0)),
            np.log1p(rfm["frequency"].clip(lower=0)),
            np.log1p(rfm["monetary"].clip(lower=0)),
        ])
    )

    best = None
    scores: dict[str, float | None] = {}
    for k in K_RANGE:
        if k >= len(rfm):
            break
        labels = KMeans(n_clusters=k, random_state=42, n_init=10).fit_predict(features)
        if len(set(labels)) < 2:
            continue
        score = float(silhouette_score(features, labels))
        scores[f"silhouette_k{k}"] = data.rounded(score, 4)
        if best is None or score > best[0]:
            best = (score, k, labels)

    if best is None:
        return refuse("The customers could not be separated into groups at all.")

    score, k, labels = best
    if score < MIN_SILHOUETTE:
        return refuse(
            f"The customers do not fall into distinct groups "
            f"(separation {score:.2f}, and {MIN_SILHOUETTE} is the minimum worth reporting). "
            "Inventing groups here would be misleading."
        )

    rfm = rfm.assign(clusterId=labels)
    clusters = _describe(rfm)
    customers = _customers(rfm, clusters)

    return contract.ok(
        MODEL_VERSION,
        predictions={"clusters": clusters, "customers": customers},
        metrics={
            "customers": len(rfm),
            "clusters": k,
            "silhouette": data.rounded(score, 4),
            "totalRevenue": data.rounded(float(rfm["monetary"].sum()), 2),
            **scores,
        },
        rows_in=rows_in,
        entities_out=len(rfm),
        warnings=(
            [f"Showing {MAX_CUSTOMERS_RETURNED} of {len(rfm)} customers, highest spend first. "
             "Group sizes and shares cover everyone."]
            if len(rfm) > MAX_CUSTOMERS_RETURNED else []
        ),
    )


def _rfm(frame: pd.DataFrame, *, has_orders: bool) -> pd.DataFrame:
    """One row per customer: days since last purchase, how often, how much."""
    as_of = frame["date"].max()
    grouped = frame.groupby("customer", sort=True)
    rfm = pd.DataFrame({
        "recencyDays": (as_of - grouped["date"].max()).dt.days.astype("float64"),
        # Orders, not rows — with baskets, a row is a product line and counting
        # those would call a four-item order four purchases.
        "frequency": (
            grouped["order"].nunique() if has_orders else grouped["date"].nunique()
        ).astype("float64"),
        "monetary": grouped["revenue"].sum().astype("float64"),
    })
    return rfm.reset_index()


def _describe(rfm: pd.DataFrame) -> list[dict[str, Any]]:
    """Name each cluster from its centre, on the two axes that decide behaviour."""
    total_revenue = float(rfm["monetary"].sum())
    centres = rfm.groupby("clusterId").agg(
        size=("customer", "size"),
        recencyDays=("recencyDays", "mean"),
        frequency=("frequency", "mean"),
        monetary=("monetary", "mean"),
        revenue=("monetary", "sum"),
    ).reset_index()

    # Recent-ness and value, each 0–1 across the clusters. Ranks rather than raw
    # values, so one extreme cluster cannot flatten the rest into a single bucket.
    recent = _unit_rank(-centres["recencyDays"])
    value = _unit_rank(centres["frequency"].rank(pct=True) + centres["monetary"].rank(pct=True))

    names = [_name(r, v) for r, v in zip(recent, value)]
    centres["name"] = _deduplicate(names, centres["monetary"])

    return [
        {
            "id": int(row.clusterId),
            "name": row.name_,
            "size": int(row.size),
            "revenue": data.rounded(float(row.revenue), 2),
            "revenueShare": data.rounded(float(row.revenue) / total_revenue, 4) if total_revenue else None,
            "centroid": {
                "recencyDays": data.rounded(float(row.recencyDays), 1),
                "frequency": data.rounded(float(row.frequency), 2),
                "monetary": data.rounded(float(row.monetary), 2),
            },
        }
        for row in centres.rename(columns={"name": "name_"}).itertuples()
    ]


def _unit_rank(series: pd.Series) -> list[float]:
    ranked = series.rank(method="average")
    low, high = float(ranked.min()), float(ranked.max())
    if high == low:
        return [0.5] * len(ranked)
    return [(float(v) - low) / (high - low) for v in ranked]


def _name(recent: float, value: float) -> str:
    """Five plain-English names, from where a cluster sits on the two axes."""
    high_recent, high_value = recent >= 0.6, value >= 0.6
    low_recent, low_value = recent <= 0.4, value <= 0.4
    if high_recent and high_value:
        return "Champions"
    if high_recent and low_value:
        return "New"
    if low_recent and high_value:
        return "At risk"
    if low_recent and low_value:
        return "Hibernating"
    return "Loyal"


def _deduplicate(names: list[str], monetary: pd.Series) -> list[str]:
    """Two clusters can land in the same quadrant. Number them by spend so every
    label on the page points at exactly one group."""
    counts: dict[str, int] = {}
    for n in names:
        counts[n] = counts.get(n, 0) + 1

    order = {
        name: sorted(
            [i for i, n in enumerate(names) if n == name],
            key=lambda i: (-float(monetary.iloc[i]), i),
        )
        for name, count in counts.items() if count > 1
    }
    out = list(names)
    for name, indices in order.items():
        for rank, i in enumerate(indices, start=1):
            out[i] = f"{name} {rank}"
    return out


def _customers(rfm: pd.DataFrame, clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    names = {c["id"]: c["name"] for c in clusters}
    shown = rfm.sort_values(["monetary", "customer"], ascending=[False, True]).head(MAX_CUSTOMERS_RETURNED)
    return [
        {
            "customer": str(row.customer),
            "clusterId": int(row.clusterId),
            "cluster": names[int(row.clusterId)],
            "recencyDays": int(row.recencyDays),
            "frequency": int(row.frequency),
            "monetary": data.rounded(float(row.monetary), 2),
        }
        for row in shown.itertuples()
    ]
