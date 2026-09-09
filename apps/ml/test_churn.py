from __future__ import annotations

import pytest
from conftest import SCHEMA, serialised, transactions

import churn


def test_scores_customers_and_shows_its_own_accuracy(sales_rows):
    result = churn.run(sales_rows, SCHEMA, {})

    assert result["status"] == "ok"
    assert result["modelVersion"] == "churn:v1.0.0"
    # The accuracy figure is displayed, so it is always present and never buried.
    assert result["metrics"]["auc"] >= churn.MIN_AUC
    for key in ("precision", "recall", "trainCustomers", "testCustomers", "scoredCustomers"):
        assert result["metrics"][key] is not None

    customers = result["predictions"]["customers"]
    assert customers
    assert all(0.0 <= c["risk"] <= 1.0 for c in customers)
    # Highest risk first, because that is the order the page reads in.
    assert customers == sorted(customers, key=lambda c: -c["risk"])


def test_each_score_arrives_with_its_own_reasons(sales_rows):
    result = churn.run(sales_rows, SCHEMA, {})
    top = result["predictions"]["customers"][0]

    assert 1 <= len(top["factors"]) <= churn.TOP_FACTORS
    for factor in top["factors"]:
        assert factor["feature"] in churn.FEATURES
        assert factor["label"] == churn.FEATURE_LABELS[factor["feature"]]
        assert factor["direction"] in ("raises", "lowers")


def test_same_rows_and_config_give_the_same_result(sales_rows):
    first = churn.run(sales_rows, SCHEMA, {})
    second = churn.run(sales_rows, SCHEMA, {})
    assert serialised(first) == serialised(second)


def test_the_headline_counts_match_the_scores(sales_rows):
    result = churn.run(sales_rows, SCHEMA, {})
    threshold = result["metrics"]["riskThreshold"]
    # Truncation would break this, so the fixture stays under the display cap.
    assert result["metrics"]["scoredCustomers"] <= churn.MAX_CUSTOMERS_RETURNED

    high = [c for c in result["predictions"]["customers"] if c["risk"] >= threshold]
    assert result["metrics"]["highRisk"] == len(high)
    assert result["metrics"]["revenueAtRisk"] == pytest.approx(sum(c["revenue"] for c in high), abs=0.05)


@pytest.mark.parametrize("missing", ["customer_id", "date", "revenue"])
def test_refuses_without_a_column_it_needs(sales_rows, missing):
    schema = {k: v for k, v in SCHEMA.items() if k != missing}
    result = churn.run(sales_rows, schema, {})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None


def test_refuses_on_less_than_a_year_of_data():
    rows = transactions(customers=300, days=200, seed=4)
    result = churn.run(rows, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert str(churn.MIN_SPAN_DAYS) in result["warnings"][0]


def test_refuses_on_too_few_customers():
    rows = transactions(customers=40, days=900, seed=6)
    result = churn.run(rows, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert str(churn.MIN_CUSTOMERS) in result["warnings"][0]


def test_refuses_when_almost_nobody_lapses():
    # Everyone keeps buying to the end, so there is nothing to learn churn from.
    rows = transactions(customers=200, days=900, seed=8, lapse_rate=0.0)
    result = churn.run(rows, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert str(churn.MIN_EXAMPLES) in result["warnings"][0]


def test_empty_rows_refuse_without_raising():
    result = churn.run([], SCHEMA, {})
    assert result["status"] == "insufficient_data"


def test_one_customer_refuses():
    rows = [
        {"customer_id": "C1", "order_id": f"O{i}", "order_date": f"2023-{1 + i % 12:02d}-01", "revenue": 10.0}
        for i in range(400)
    ]
    result = churn.run(rows, SCHEMA, {})
    assert result["status"] == "insufficient_data"


def test_non_numeric_revenue_refuses_rather_than_crashing(sales_rows):
    broken = [{**row, "revenue": "n/a"} for row in sales_rows]
    result = churn.run(broken, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None


def test_all_identical_customers_refuse():
    rows = [
        {"customer_id": f"C{c}", "order_id": f"O{c}-{i}", "order_date": "2023-06-01", "revenue": 50.0}
        for c in range(300) for i in range(4)
    ]
    result = churn.run(rows, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None


def test_a_nonsense_config_falls_back_to_the_defaults(sales_rows):
    result = churn.run(sales_rows, SCHEMA, {"gapMultiple": "soon", "riskThreshold": 7})

    assert result["status"] == "ok"
    assert result["metrics"]["gapMultiple"] == churn.DEFAULT_GAP_MULTIPLE
    assert result["metrics"]["riskThreshold"] == churn.DEFAULT_RISK_THRESHOLD


def test_without_an_order_column_each_row_counts_as_a_purchase(sales_rows):
    schema = {k: v for k, v in SCHEMA.items() if k != "order_id"}
    result = churn.run(sales_rows, schema, {})

    assert result["status"] in ("ok", "insufficient_data")
    if result["status"] == "ok":
        assert result["metrics"]["scoredCustomers"] > 0
