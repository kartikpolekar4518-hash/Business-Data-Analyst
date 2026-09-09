"""Product affinities — `basket:v1.0.0`.

"What sells with what" has no implementation in the engine and no credible
JavaScript library. FP-Growth over real baskets, reported as rules with support,
confidence and lift.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
from mlxtend.frequent_patterns import association_rules, fpgrowth
from mlxtend.preprocessing import TransactionEncoder

import contract
import data

MODEL_VERSION = "basket:v1.0.0"

MIN_ORDERS = 200
# A file of single-line orders produces technically valid, completely misleading
# rules. These three gates are what stop that.
MIN_MULTI_PRODUCT_SHARE = 0.15
MIN_MEAN_BASKET = 1.2

DEFAULT_MIN_SUPPORT = 0.01
DEFAULT_MIN_CONFIDENCE = 0.10
MIN_LIFT = 1.0
MAX_RULES = 200
# FP-Growth is exponential in the worst case, so the catalogue is bounded. Rare
# products rarely clear the support floor, but a run that hits this cap says so:
# with a wide enough catalogue, a real pairing can be dropped along with them.
MAX_PRODUCTS = 500


def run(rows: list[dict[str, Any]], schema: dict[str, str], config: dict[str, Any]) -> dict[str, Any]:
    rows_in = len(rows)
    warnings: list[str] = []
    refuse = lambda reason, metrics=None: contract.insufficient(
        MODEL_VERSION, reason, rows_in=rows_in, metrics=metrics, extra=warnings
    )

    order_column = data.pick(schema, "order_id")
    product_column = data.pick(schema, "product_name", "product_id")
    if not order_column:
        return refuse("No order column was detected, so the rows cannot be grouped into baskets.")
    if not product_column:
        return refuse("No product column was detected, so there is nothing to pair up.")

    frame = data.build(rows, {"order": order_column, "product": product_column})
    frame["order"] = data.keys(frame["order"])
    frame["product"] = data.keys(frame["product"])
    frame = frame.dropna(subset=["order", "product"]).drop_duplicates()
    if frame.empty:
        return refuse("No row had both an order and a product.")

    baskets = frame.groupby("order")["product"].apply(list)
    orders = len(baskets)
    sizes = baskets.apply(len)
    multi_share = float((sizes >= 2).mean())
    mean_basket = float(sizes.mean())
    quality = {
        "orders": orders,
        "meanBasketSize": data.rounded(mean_basket, 2),
        "multiProductShare": data.rounded(multi_share, 4),
        "products": int(frame["product"].nunique()),
    }

    if orders < MIN_ORDERS:
        return refuse(
            f"Only {orders} orders are in this data, and at least {MIN_ORDERS} are needed "
            "before a pairing is a pattern rather than a coincidence.",
            quality,
        )
    if multi_share < MIN_MULTI_PRODUCT_SHARE or mean_basket <= MIN_MEAN_BASKET:
        return refuse(
            f"Not enough multi-product basket data: {multi_share:.0%} of orders hold two or more "
            f"different products, averaging {mean_basket:.2f} products an order. "
            "Almost every order here is a single item, so there is nothing bought together to find.",
            quality,
        )

    min_support = _fraction(config.get("minSupport"), DEFAULT_MIN_SUPPORT)
    min_confidence = _fraction(config.get("minConfidence"), DEFAULT_MIN_CONFIDENCE)

    products = frame["product"].value_counts()
    if len(products) > MAX_PRODUCTS:
        keep = set(products.head(MAX_PRODUCTS).index)
        baskets = baskets.apply(lambda items: [p for p in items if p in keep])
        warnings.append(
            f"Limited to the {MAX_PRODUCTS} best-selling products of {len(products)}. "
            "No rule involving any of the rest is reported."
        )

    encoded = TransactionEncoder()
    matrix = pd.DataFrame(
        encoded.fit(baskets.tolist()).transform(baskets.tolist()),
        columns=encoded.columns_,
    )
    frequent = fpgrowth(matrix, min_support=min_support, use_colnames=True)
    if frequent.empty:
        return refuse(
            f"No product combination appears in as much as {min_support:.1%} of orders, "
            "so no pairing here is common enough to act on.",
            quality,
        )

    rules = association_rules(frequent, metric="confidence", min_threshold=min_confidence)
    rules = rules[rules["lift"] > MIN_LIFT]
    if rules.empty:
        return refuse(
            "No pair of products sells together more often than they would by chance.",
            quality,
        )

    ranked = rules.sort_values(
        ["lift", "support", "confidence"], ascending=False
    ).head(MAX_RULES)
    if len(rules) > MAX_RULES:
        warnings.append(f"Showing the {MAX_RULES} strongest of {len(rules)} rules, highest lift first.")

    return contract.ok(
        MODEL_VERSION,
        predictions={"rules": _rules(ranked, orders)},
        metrics={
            **quality,
            "rules": int(len(rules)),
            "topLift": data.rounded(float(ranked["lift"].max()), 2),
            "minSupport": min_support,
            "minConfidence": min_confidence,
        },
        rows_in=rows_in,
        entities_out=int(len(ranked)),
        warnings=warnings,
    )


def _fraction(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if 0 < number < 1 else fallback


def _rules(ranked: pd.DataFrame, orders: int) -> list[dict[str, Any]]:
    return [
        {
            # Sorted so the same rule reads the same way on every run.
            "buys": sorted(str(p) for p in row.antecedents),
            "alsoBuys": sorted(str(p) for p in row.consequents),
            "support": data.rounded(float(row.support), 4),
            "confidence": data.rounded(float(row.confidence), 4),
            "lift": data.rounded(float(row.lift), 3),
            "orders": int(round(float(row.support) * orders)),
        }
        for row in ranked.itertuples()
    ]
