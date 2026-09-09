from __future__ import annotations

import pandas as pd

import data


def test_pick_takes_the_first_business_meaning_that_is_mapped():
    schema = {"customer_name": "Client", "date": "Day"}

    assert data.pick(schema, "customer_id", "customer_name") == "Client"
    assert data.pick(schema, "customer_id") is None
    assert data.pick({"revenue": "  "}, "revenue") is None


def test_build_fills_a_mapped_column_the_rows_do_not_have():
    frame = data.build([{"a": 1}], {"x": "a", "y": "missing"})

    assert list(frame.columns) == ["x", "y"]
    assert frame["y"].isna().all()


def test_numbers_reads_money_and_drops_what_is_not_a_number():
    parsed = data.numbers(pd.Series(["$1,200.50", "45", "", "n/a", None]))

    assert parsed.tolist()[:2] == [1200.5, 45.0]
    assert parsed.isna().tolist() == [False, False, True, True, True]


def test_keys_trims_and_treats_a_blank_as_missing():
    assert data.keys(pd.Series([" C1 ", "", "  "])).tolist()[0] == "C1"
    assert data.keys(pd.Series([" C1 ", "", "  "])).isna().tolist() == [False, True, True]


def test_rounded_has_no_word_for_nan_so_it_says_nothing():
    assert data.rounded(1.23456, 2) == 1.23
    assert data.rounded(float("nan"), 2) is None
    assert data.rounded(float("inf"), 2) is None
    assert data.rounded("not a number", 2) is None
    assert data.rounded(None, 2) is None


def test_span_days_of_nothing_is_zero():
    assert data.span_days(pd.Series([], dtype="datetime64[ns]")) == 0.0
    assert data.span_days(data.dates(pd.Series(["2024-01-01", "2024-01-31"]))) == 30.0
