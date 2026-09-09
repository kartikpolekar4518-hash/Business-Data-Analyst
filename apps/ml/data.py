"""Turning `{ rows, schema }` into a tidy frame.

All three models need the same four things: find the column a business meaning
lives in, build a frame under canonical names, coerce numbers and dates, and drop
rows that cannot be used. Written once here.

`schema` is NoPS's semantic map — business meaning to column name, e.g.
`{"customer_id": "Customer ID", "date": "Order Date", "revenue": "Amount"}`.
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd


def pick(schema: dict[str, str], *semantics: str) -> str | None:
    """The column for the first of these business meanings that is mapped."""
    for s in semantics:
        column = schema.get(s)
        if isinstance(column, str) and column.strip():
            return column
    return None


def build(rows: list[dict[str, Any]], columns: dict[str, str]) -> pd.DataFrame:
    """A frame under canonical names, from `{canonical: source column}`.

    A mapped column absent from the rows themselves comes back all-null rather
    than raising, so a stale schema map is a refusal further down and not a 500.
    """
    frame = pd.DataFrame(rows)
    out = pd.DataFrame(index=frame.index)
    for canonical, source in columns.items():
        out[canonical] = frame[source] if source in frame.columns else pd.Series(
            [None] * len(frame), index=frame.index, dtype="object"
        )
    return out


# A number as written down: an optional sign, digits, and an optional exponent.
_NUMBER = re.compile(r"([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)")


def numbers(series: pd.Series) -> pd.Series:
    """Numeric, with anything unparseable as NaN. Currency strings included."""
    if series.dtype.kind in "if":
        return series.astype("float64")

    text = series.astype("string").str.strip()
    # Anything already written as a number is taken as written, so an exponent
    # (`1e5`, `1.5e-05`) survives the currency handling below rather than losing
    # its `e` and coming back as a different number.
    parsed = _floats(pd.to_numeric(text, errors="coerce"), text.index)

    unread = parsed.isna() & text.notna()
    if unread.any():
        rest = text[unread]
        # Accounting writes a negative in brackets, and dropping the brackets
        # turned a refund into income.
        negative = rest.str.contains(r"\(.*\d.*\)", regex=True).fillna(False)
        # Currency symbols, thousands separators and stray words go first, so a
        # leading sign ends up against the digits it belongs to and is not left
        # behind by the match: `-$1,200.50` is a refund, not income.
        recovered = _floats(
            pd.to_numeric(
                rest.str.replace(r"[^0-9eE+\-.()]", "", regex=True)
                .str.extract(_NUMBER, expand=False),
                errors="coerce",
            ),
            rest.index,
        )
        parsed.loc[unread] = recovered.where(~negative, -recovered.abs())
    return parsed


def _floats(series: pd.Series, index: pd.Index) -> pd.Series:
    """Plain float64, whatever nullable dtype the parse came back as."""
    return pd.Series(series.to_numpy(dtype="float64", na_value=float("nan")), index=index)


# The start of a numeric date: `03/04/2024`, `3-4-24`.
_NUMERIC_DATE = re.compile(r"^(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}")


def dates(series: pd.Series) -> pd.Series:
    """Dates, with anything unparseable as NaT."""
    if pd.api.types.is_datetime64_any_dtype(series):
        return pd.to_datetime(series, errors="coerce")
    text = series.astype("string").str.strip()
    return pd.to_datetime(text, errors="coerce", format="mixed", dayfirst=_dayfirst(text), utc=False)


def _dayfirst(text: pd.Series) -> bool:
    """Whether the column as a whole is written day first.

    Decided once for the column rather than value by value: guessing per value
    read `01/02/2024` as January and `13/02/2024` as February in the same column,
    which moved every date, gap and cutoff computed from it.
    """
    parts = text.str.extract(_NUMERIC_DATE)
    if parts.empty:
        return False
    first = pd.to_numeric(parts[0], errors="coerce")
    second = pd.to_numeric(parts[1], errors="coerce")
    return bool((first > 12).any()) and not bool((second > 12).any())


def keys(series: pd.Series) -> pd.Series:
    """Identifiers as trimmed strings; blanks become NA so they drop out."""
    out = series.astype("string").str.strip()
    return out.replace("", pd.NA)


EMPTY_ORDER_COLUMN = (
    "The mapped order column is empty in every row, so orders could not be counted "
    "from it. Each purchase date is treated as one order instead."
)
BLANK_ORDER_IDS = (
    "{blank} of {total} usable rows have no order id. Each is counted as an order "
    "of its own rather than dropped."
)


def orders(frame: pd.DataFrame) -> tuple[bool, list[str]]:
    """Tidy the optional `order` column, and say whether it can be counted on.

    Two ways it used to change the numbers with nothing looking wrong: a stale
    schema map makes `build` return the column all-null, which counts every
    customer as having zero orders; and `groupby` throws away rows whose key is
    missing, which took a blank-id row's revenue with it. Both are handled here
    and reported to the caller.
    """
    if "order" not in frame.columns:
        return False, []

    frame["order"] = keys(frame["order"])
    blank = int(frame["order"].isna().sum())
    if blank == len(frame):
        frame.drop(columns="order", inplace=True)
        return False, [EMPTY_ORDER_COLUMN]
    if blank:
        frame["order"] = frame["order"].fillna(
            "row-" + frame.index.to_series().astype("string")
        )
        return True, [BLANK_ORDER_IDS.format(blank=blank, total=len(frame))]
    return True, []


def span_days(when: pd.Series) -> float:
    """Days covered by a date column. 0.0 when there is nothing to measure."""
    if when.empty or when.isna().all():
        return 0.0
    return float((when.max() - when.min()).days)


def rounded(value: Any, places: int) -> float | None:
    """Round for output. NaN and infinities become None — JSON has no word for them."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return round(number, places)
