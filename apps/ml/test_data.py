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


def test_numbers_keeps_an_exponent_and_reads_brackets_as_negative():
    # Stripping everything but digits, a dot and a minus turned "1e5" into 15 and
    # a bracketed refund into income.
    parsed = data.numbers(pd.Series(["1e5", "(50)", "$(1,200.50)", "1.5e-05", "-3", "-$1,200.50"]))

    assert parsed.tolist() == [100000.0, -50.0, -1200.5, 0.000015, -3.0, -1200.5]


def test_numbers_reads_an_exponent_written_among_text():
    parsed = data.numbers(pd.Series([1.5e-05, "2.5e-05", "n/a"], dtype="object"))

    assert parsed.tolist()[:2] == [1.5e-05, 2.5e-05]
    assert parsed.isna().tolist() == [False, False, True]


def test_dates_reads_a_day_first_column_the_same_way_throughout():
    # Guessing value by value read the first as 2 January and the second as
    # 13 February, which moved every gap and cutoff computed from the column.
    parsed = data.dates(pd.Series(["01/02/2024", "13/02/2024", "28/02/2024"]))

    assert [d.month for d in parsed] == [2, 2, 2]
    assert [d.day for d in parsed] == [1, 13, 28]


def test_dates_still_reads_a_month_first_column_as_written():
    parsed = data.dates(pd.Series(["01/02/2024", "03/15/2024"]))

    assert (parsed[0].month, parsed[0].day) == (1, 2)
    assert (parsed[1].month, parsed[1].day) == (3, 15)
