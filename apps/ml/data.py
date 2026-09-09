"""Turning `{ rows, schema }` into a tidy frame.

All three models need the same four things: find the column a business meaning
lives in, build a frame under canonical names, coerce numbers and dates, and drop
rows that cannot be used. Written once here.

`schema` is NoPS's semantic map — business meaning to column name, e.g.
`{"customer_id": "Customer ID", "date": "Order Date", "revenue": "Amount"}`.
"""

from __future__ import annotations

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


def numbers(series: pd.Series) -> pd.Series:
    """Numeric, with anything unparseable as NaN. Currency strings included."""
    if series.dtype.kind in "if":
        return series.astype("float64")
    cleaned = (
        series.astype("string")
        .str.replace(r"[^\d.\-]", "", regex=True)
        .replace("", None)
    )
    return pd.to_numeric(cleaned, errors="coerce")


def dates(series: pd.Series) -> pd.Series:
    """Dates, with anything unparseable as NaT."""
    return pd.to_datetime(series, errors="coerce", format="mixed", utc=False)


def keys(series: pd.Series) -> pd.Series:
    """Identifiers as trimmed strings; blanks become NA so they drop out."""
    out = series.astype("string").str.strip()
    return out.replace("", pd.NA)


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
