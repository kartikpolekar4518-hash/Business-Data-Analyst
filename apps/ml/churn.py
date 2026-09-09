"""Churn risk — `churn:v1.0.0`.

Nothing in the deterministic engine predicts. The SaaS pack's `churn` metric
measures churn that already happened. This estimates who is about to stop buying,
and SHAP gives each customer their own reasons rather than one global ranking.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import precision_score, recall_score, roc_auc_score

import contract
import data

MODEL_VERSION = "churn:v1.0.0"

MIN_CUSTOMERS = 100
MIN_SPAN_DAYS = 365
# Per class, per side of the split. Fewer than this and the accuracy figure is
# noise, and the accuracy figure is the number on the page.
MIN_EXAMPLES = 20
# 0.5 is a coin toss. A model that cannot beat one should not be shown.
MIN_AUC = 0.6
DEFAULT_GAP_MULTIPLE = 2.0
DEFAULT_RISK_THRESHOLD = 0.5
FALLBACK_GAP_DAYS = 30.0
MAX_CUSTOMERS_RETURNED = 5000
TOP_FACTORS = 3

FEATURES = ["recencyDays", "frequency", "tenureDays", "avgOrderValue", "spendTrend", "gapVariance"]
FEATURE_LABELS = {
    "recencyDays": "Days since last order",
    "frequency": "Orders placed",
    "tenureDays": "Days as a customer",
    "avgOrderValue": "Average order value",
    "spendTrend": "Spend trend",
    "gapVariance": "How irregular their orders are",
}


def run(rows: list[dict[str, Any]], schema: dict[str, str], config: dict[str, Any]) -> dict[str, Any]:
    rows_in = len(rows)
    refuse = lambda reason: contract.insufficient(MODEL_VERSION, reason, rows_in=rows_in)

    customer_column = data.pick(schema, "customer_id", "customer_name")
    date_column = data.pick(schema, "date")
    revenue_column = data.pick(schema, "revenue", "sales")
    if not customer_column:
        return refuse("No customer column was detected, so there is nobody to score.")
    if not date_column:
        return refuse("No date column was detected, and churn is entirely about timing.")
    if not revenue_column:
        return refuse("No revenue column was detected, so what is at stake is unknown.")

    columns = {"customer": customer_column, "date": date_column, "revenue": revenue_column}
    order_column = data.pick(schema, "order_id")
    if order_column:
        columns["order"] = order_column

    frame = data.build(rows, columns)
    frame["customer"] = data.keys(frame["customer"])
    frame["date"] = data.dates(frame["date"])
    frame["revenue"] = data.numbers(frame["revenue"])
    frame = frame.dropna(subset=["customer", "date", "revenue"])
    if "order" not in frame.columns:
        # No order id: one row is one purchase, which is what the frequency and
        # gap features assume anyway.
        frame["order"] = frame["customer"].astype("string") + "|" + frame["date"].astype("string")
    frame = frame.sort_values(["customer", "date"])
    if frame.empty:
        return refuse("No row had a customer, a date and a revenue figure together.")

    span = data.span_days(frame["date"])
    if span < MIN_SPAN_DAYS:
        return refuse(
            f"The data covers {int(span)} days. Churn needs at least "
            f"{MIN_SPAN_DAYS} so that behaviour can be watched changing over time."
        )
    customers = int(frame["customer"].nunique())
    if customers < MIN_CUSTOMERS:
        return refuse(
            f"Only {customers} customers have usable history. "
            f"Scoring needs at least {MIN_CUSTOMERS}."
        )

    gap_multiple = _positive(config.get("gapMultiple"), DEFAULT_GAP_MULTIPLE)
    risk_threshold = _fraction(config.get("riskThreshold"), DEFAULT_RISK_THRESHOLD)

    # Two cuts, so the test window is strictly later than the training window.
    # A random split would score a model on behaviour it had already seen and
    # inflate the one figure that has to be honest.
    start, end = frame["date"].min(), frame["date"].max()
    t1 = start + (end - start) * 0.50
    t2 = start + (end - start) * 0.75

    train = _window(frame, features_to=t1, label_at=t2, gap_multiple=gap_multiple)
    test = _window(frame, features_to=t2, label_at=end, gap_multiple=gap_multiple)
    for name, window in (("training", train), ("test", test)):
        if window is None:
            return refuse(f"No customer had any history in the {name} period.")
        churned = int(window["churned"].sum())
        retained = len(window) - churned
        if churned < MIN_EXAMPLES or retained < MIN_EXAMPLES:
            return refuse(
                f"The {name} period holds {churned} customers who lapsed and {retained} who did not. "
                f"At least {MIN_EXAMPLES} of each is needed before an accuracy figure means anything."
            )

    model = GradientBoostingClassifier(random_state=42)
    model.fit(train[FEATURES].to_numpy(), train["churned"].to_numpy())

    probabilities = model.predict_proba(test[FEATURES].to_numpy())[:, 1]
    truth = test["churned"].to_numpy()
    auc = float(roc_auc_score(truth, probabilities))
    if auc < MIN_AUC:
        return refuse(
            f"The model scored {auc:.2f} on data it had not seen, and {MIN_AUC} is the floor "
            "for being better than guessing. A number nobody should act on is worse than none."
        )
    predicted = (probabilities >= risk_threshold).astype(int)

    scoring = _window(frame, features_to=end, label_at=None, gap_multiple=gap_multiple)
    if scoring is None or scoring.empty:
        return refuse("No customer had usable history at the most recent date in the data.")
    # Scored by the model whose accuracy is displayed — not a larger one refitted
    # afterwards, which would leave the figure describing something else.
    scoring = scoring.assign(risk=model.predict_proba(scoring[FEATURES].to_numpy())[:, 1])

    factors, shap_warning = _factors(model, scoring)
    at_risk = scoring[scoring["risk"] >= risk_threshold]

    return contract.ok(
        MODEL_VERSION,
        predictions={"customers": _customers(scoring, factors)},
        metrics={
            "auc": data.rounded(auc, 4),
            "precision": data.rounded(float(precision_score(truth, predicted, zero_division=0)), 4),
            "recall": data.rounded(float(recall_score(truth, predicted, zero_division=0)), 4),
            "trainCustomers": len(train),
            "testCustomers": len(test),
            "trainChurnRate": data.rounded(float(train["churned"].mean()), 4),
            "testChurnRate": data.rounded(float(test["churned"].mean()), 4),
            "scoredCustomers": len(scoring),
            "highRisk": len(at_risk),
            "revenueAtRisk": data.rounded(float(at_risk["revenue"].sum()), 2),
            "riskThreshold": risk_threshold,
            "gapMultiple": gap_multiple,
            "trainedThrough": t1.date().isoformat(),
            "testedThrough": end.date().isoformat(),
        },
        rows_in=rows_in,
        entities_out=len(scoring),
        warnings=([shap_warning] if shap_warning else []) + (
            [f"Showing the {MAX_CUSTOMERS_RETURNED} highest-risk of {len(scoring)} customers. "
             "The counts above cover everyone."]
            if len(scoring) > MAX_CUSTOMERS_RETURNED else []
        ),
    )


def _positive(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


def _fraction(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if 0 < number < 1 else fallback


def _window(
    frame: pd.DataFrame, *, features_to: Any, label_at: Any, gap_multiple: float
) -> pd.DataFrame | None:
    """Features from everything up to `features_to`; the answer, if asked for, from
    where each customer stood at `label_at`.

    Nothing after `features_to` reaches a feature, which is what keeps the label
    out of the model's input.
    """
    history = frame[frame["date"] <= features_to]
    if history.empty:
        return None

    orders = (
        history.groupby(["customer", "order"], sort=True)
        .agg(date=("date", "min"), revenue=("revenue", "sum"))
        .reset_index()
        .sort_values(["customer", "date"])
    )
    gaps = orders.groupby("customer")["date"].diff().dt.days
    typical = gaps.groupby(orders["customer"]).median()
    # One order tells you nothing about that customer's rhythm, so they borrow the
    # population's. Better than dropping every one-time buyer, who are exactly the
    # people this question is about.
    population_gap = float(typical.median()) if typical.notna().any() else FALLBACK_GAP_DAYS
    typical = typical.fillna(population_gap).replace(0, population_gap)

    grouped = orders.groupby("customer", sort=True)
    last, first = grouped["date"].max(), grouped["date"].min()
    revenue, count = grouped["revenue"].sum(), grouped["revenue"].size()

    features = pd.DataFrame({
        "recencyDays": (features_to - last).dt.days.astype("float64"),
        "frequency": count.astype("float64"),
        "tenureDays": (features_to - first).dt.days.astype("float64"),
        "avgOrderValue": (revenue / count).astype("float64"),
        "spendTrend": grouped.apply(_trend, include_groups=False).astype("float64"),
        "gapVariance": gaps.groupby(orders["customer"]).std().fillna(0.0).astype("float64"),
        "revenue": revenue.astype("float64"),
        "typicalGap": typical.astype("float64"),
    }).reset_index()

    if label_at is None:
        return features

    up_to_label = frame[frame["date"] <= label_at].groupby("customer")["date"].max()
    latest = features["customer"].map(up_to_label)
    silence = (label_at - latest).dt.days.astype("float64")
    # Their own rhythm, not one cutoff for everybody: a weekly buyer gone a month
    # is a different fact from a yearly buyer gone a month.
    return features.assign(churned=(silence > features["typicalGap"] * gap_multiple).astype(int))


def _trend(group: pd.DataFrame) -> float:
    """Later spend against earlier spend, as a change. 0 when there is one order."""
    values = group["revenue"].to_numpy()
    if len(values) < 2:
        return 0.0
    half = len(values) // 2
    earlier, later = float(values[:half].sum()), float(values[half:].sum())
    return (later - earlier) / (earlier + 1.0)


def _factors(model: GradientBoostingClassifier, scoring: pd.DataFrame) -> tuple[Any, str | None]:
    """Per-customer reasons from SHAP.

    If SHAP fails the scores still stand, so the reasons are dropped with a warning
    rather than the whole result.
    """
    try:
        import shap

        values = shap.TreeExplainer(model).shap_values(scoring[FEATURES].to_numpy())
        return values, None
    except Exception as exc:  # noqa: BLE001 — a reasons failure must not lose the scores
        return None, f"Per-customer reasons are unavailable for this run ({type(exc).__name__})."


def _customers(scoring: pd.DataFrame, factors: Any) -> list[dict[str, Any]]:
    ranked = scoring.sort_values(["risk", "customer"], ascending=[False, True])
    shown = ranked.head(MAX_CUSTOMERS_RETURNED)
    positions = {c: i for i, c in enumerate(scoring["customer"])}

    out = []
    for row in shown.itertuples():
        entry = {
            "customer": str(row.customer),
            "risk": data.rounded(float(row.risk), 4),
            "revenue": data.rounded(float(row.revenue), 2),
            "recencyDays": int(row.recencyDays),
            "frequency": int(row.frequency),
            "typicalGapDays": data.rounded(float(row.typicalGap), 1),
            "factors": [],
        }
        if factors is not None:
            contributions = factors[positions[row.customer]]
            top = sorted(range(len(FEATURES)), key=lambda i: -abs(float(contributions[i])))[:TOP_FACTORS]
            entry["factors"] = [
                {
                    "feature": FEATURES[i],
                    "label": FEATURE_LABELS[FEATURES[i]],
                    "value": data.rounded(float(getattr(row, FEATURES[i])), 2),
                    "impact": data.rounded(float(contributions[i]), 4),
                    "direction": "raises" if float(contributions[i]) > 0 else "lowers",
                }
                for i in top
            ]
        out.append(entry)
    return out
