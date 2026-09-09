from __future__ import annotations

import pytest
from conftest import SCHEMA, baskets, serialised, single_product_orders

import basket


def test_finds_the_products_that_sell_together(basket_rows):
    result = basket.run(basket_rows, SCHEMA, {})

    assert result["status"] == "ok"
    assert result["modelVersion"] == "basket:v1.0.0"
    rules = result["predictions"]["rules"]
    assert rules
    # Every rule is a pairing that beats chance; that is the whole point of lift.
    assert all(r["lift"] > basket.MIN_LIFT for r in rules)
    assert rules == sorted(rules, key=lambda r: -r["lift"])

    # The fixture builds Phone with Earbuds deliberately, so it must be found.
    pairs = {(tuple(r["buys"]), tuple(r["alsoBuys"])) for r in rules}
    assert (("Phone",), ("Earbuds",)) in pairs


def test_same_rows_and_config_give_the_same_result(basket_rows):
    first = basket.run(basket_rows, SCHEMA, {})
    second = basket.run(basket_rows, SCHEMA, {})
    assert serialised(first) == serialised(second)


def test_basket_quality_is_reported_alongside_the_rules(basket_rows):
    result = basket.run(basket_rows, SCHEMA, {})

    assert result["metrics"]["orders"] == len({r["order_id"] for r in basket_rows})
    assert result["metrics"]["meanBasketSize"] > basket.MIN_MEAN_BASKET
    assert result["metrics"]["multiProductShare"] >= basket.MIN_MULTI_PRODUCT_SHARE


def test_refuses_when_every_order_holds_one_product():
    # The shape the retail sample generator used to produce. Without this gate the
    # demo would return valid, completely misleading output.
    result = basket.run(single_product_orders(), SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert "multi-product" in result["warnings"][0]
    assert result["predictions"] is None
    # The refusal still says what it measured.
    assert result["metrics"]["meanBasketSize"] == 1.0


def test_refuses_on_too_few_orders():
    result = basket.run(baskets(orders=50, seed=9), SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert str(basket.MIN_ORDERS) in result["warnings"][0]


@pytest.mark.parametrize("missing", ["order_id", "product_name"])
def test_refuses_without_a_column_it_needs(basket_rows, missing):
    schema = {k: v for k, v in SCHEMA.items() if k != missing}
    result = basket.run(basket_rows, schema, {})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None


def test_refuses_when_nothing_is_common_enough_to_act_on(basket_rows):
    result = basket.run(basket_rows, SCHEMA, {"minSupport": 0.99})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None


def test_empty_rows_refuse_without_raising():
    result = basket.run([], SCHEMA, {})
    assert result["status"] == "insufficient_data"


def test_the_same_product_twice_in_one_order_is_not_a_pairing():
    # A duplicate line says nothing about what is bought with what.
    doubled = [
        {"order_id": f"ORD-{o}", "product_name": "Phone", "revenue": 10.0}
        for o in range(400) for _ in range(3)
    ]
    result = basket.run(doubled, SCHEMA, {})

    assert result["status"] == "insufficient_data"
    assert result["metrics"]["meanBasketSize"] == 1.0


def test_a_schema_naming_a_column_the_rows_do_not_have_refuses(basket_rows):
    schema = {**SCHEMA, "product_name": "item_description"}
    result = basket.run(basket_rows, schema, {})

    assert result["status"] == "insufficient_data"
    assert result["predictions"] is None


def test_a_nonsense_config_falls_back_to_the_defaults(basket_rows):
    result = basket.run(basket_rows, SCHEMA, {"minSupport": "a lot", "minConfidence": 12})

    assert result["status"] == "ok"
    assert result["metrics"]["minSupport"] == basket.DEFAULT_MIN_SUPPORT
    assert result["metrics"]["minConfidence"] == basket.DEFAULT_MIN_CONFIDENCE
