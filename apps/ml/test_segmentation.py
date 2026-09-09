from __future__ import annotations

import pytest
from conftest import SCHEMA, serialised, transactions

import segmentation


def test_groups_customers_and_reports_separation(sales_rows):
    result = segmentation.run(sales_rows, SCHEMA, {})

    assert result["status"] == "ok"
    assert result["contractVersion"] == "1.0"
    assert result["modelVersion"] == "segment:v1.0.0"
    assert 2 <= result["metrics"]["clusters"] <= 6
    assert result["metrics"]["silhouette"] >= segmentation.MIN_SILHOUETTE

    clusters = result["predictions"]["clusters"]
    assert sum(c["size"] for c in clusters) == result["metrics"]["customers"]
    assert result["metadata"]["entitiesOut"] == result["metrics"]["customers"]
    # Every label on the page has to point at exactly one group.
    assert len({c["name"] for c in clusters}) == len(clusters)
    # Shares are rounded for display, so they sum to 1 within that rounding.
    assert abs(sum(c["revenueShare"] for c in clusters) - 1.0) < 1e-3


def test_same_rows_and_config_give_the_same_result(sales_rows):
    first = segmentation.run(sales_rows, SCHEMA, {})
    second = segmentation.run(sales_rows, SCHEMA, {})
    assert serialised(first) == serialised(second)


def test_every_customer_lands_in_a_named_group(sales_rows):
    result = segmentation.run(sales_rows, SCHEMA, {})
    names = {c["id"]: c["name"] for c in result["predictions"]["clusters"]}
    for customer in result["predictions"]["customers"]:
        assert customer["cluster"] == names[customer["clusterId"]]


@pytest.mark.parametrize("missing", ["customer_id", "date", "revenue"])
def test_refuses_without_a_column_it_needs(sales_rows, missing):
    schema = {k: v for k, v in SCHEMA.items() if k != missing}
    result = segmentation.run(sales_rows, schema, {})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None
    assert result["warnings"]


def test_refuses_rather_than_inventing_groups_from_too_few_customers():
    rows = transactions(customers=20, days=400, seed=2)
    result = segmentation.run(rows, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert str(segmentation.MIN_CUSTOMERS) in result["warnings"][0]


@pytest.mark.filterwarnings("ignore:Number of distinct clusters")
def test_refuses_when_the_customers_have_no_real_structure():
    # Identical customers cannot fall into groups. Naming some would be an invention.
    rows = [
        {"customer_id": f"C{c}", "order_id": f"O{c}-{i}", "order_date": "2024-01-01", "revenue": 100.0}
        for c in range(80) for i in range(3)
    ]
    result = segmentation.run(rows, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None


def test_empty_rows_refuse_without_raising():
    result = segmentation.run([], SCHEMA, {})
    assert result["status"] == "insufficient_data"


def test_one_customer_refuses():
    rows = [
        {"customer_id": "C1", "order_id": f"O{i}", "order_date": "2024-01-01", "revenue": 10.0}
        for i in range(300)
    ]
    result = segmentation.run(rows, SCHEMA, {})
    assert result["status"] == "insufficient_data"


def test_non_numeric_revenue_drops_out_rather_than_crashing(sales_rows):
    broken = [{**row, "revenue": "not a number"} for row in sales_rows]
    result = segmentation.run(broken, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert "revenue" in result["warnings"][0].lower() or "customer" in result["warnings"][0].lower()


def test_currency_formatted_revenue_is_read_as_money(sales_rows):
    formatted = [{**row, "revenue": f"${row['revenue']:,.2f}"} for row in sales_rows]
    plain = segmentation.run(sales_rows, SCHEMA, {})
    result = segmentation.run(formatted, SCHEMA, {})

    assert result["status"] == "ok"
    assert result["metrics"]["customers"] == plain["metrics"]["customers"]


def test_a_schema_naming_a_column_the_rows_do_not_have_refuses(sales_rows):
    schema = {**SCHEMA, "revenue": "amount_in_pounds"}
    result = segmentation.run(sales_rows, schema, {})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None
