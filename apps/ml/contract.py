"""The response envelope every route returns.

Node validates this shape with Zod before persisting anything, and depends on the
contract rather than on the algorithm behind it. Nothing in the payload names the
estimator, so a model can be replaced behind a `modelVersion` bump without the API
or the UI changing.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

CONTRACT_VERSION = "1.0"

Status = Literal["ok", "insufficient_data", "error"]

Metrics = dict[str, float | int | str | None]


class MlRequest(BaseModel):
    """`{ rows, schema, config }` — the only request shape this service accepts.

    `schema` is aliased because it shadows an attribute on pydantic's BaseModel;
    the wire name stays `schema`, which is what Node sends.
    """

    rows: list[dict[str, Any]] = []
    schema_: dict[str, str] = Field(default={}, alias="schema")
    config: dict[str, Any] = {}

    model_config = {"populate_by_name": True}


def _envelope(
    model_version: str,
    status: Status,
    *,
    predictions: Any,
    metrics: Metrics,
    warnings: list[str],
    rows_in: int,
    entities_out: int,
) -> dict[str, Any]:
    return {
        "contractVersion": CONTRACT_VERSION,
        "modelVersion": model_version,
        "status": status,
        "warnings": warnings,
        "metrics": metrics,
        "predictions": predictions,
        "metadata": {
            "rowsIn": rows_in,
            "entitiesOut": entities_out,
            # The one field that is not reproducible, and the one field the
            # determinism tests exclude for that reason.
            "computedAt": datetime.now(timezone.utc).isoformat(),
        },
    }


def ok(
    model_version: str,
    *,
    predictions: Any,
    metrics: Metrics,
    rows_in: int,
    entities_out: int,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    return _envelope(
        model_version, "ok",
        predictions=predictions, metrics=metrics, warnings=warnings or [],
        rows_in=rows_in, entities_out=entities_out,
    )


def insufficient(
    model_version: str,
    reason: str,
    *,
    rows_in: int,
    metrics: Metrics | None = None,
) -> dict[str, Any]:
    """A refusal is a result, not a failure.

    This is a successful response carrying the reason and no predictions. The UI
    renders the reason verbatim rather than showing a weak estimate.
    """
    return _envelope(
        model_version, "insufficient_data",
        predictions=None, metrics=metrics or {}, warnings=[reason],
        rows_in=rows_in, entities_out=0,
    )


def failed(model_version: str, message: str, *, rows_in: int) -> dict[str, Any]:
    return _envelope(
        model_version, "error",
        predictions=None, metrics={}, warnings=[message],
        rows_in=rows_in, entities_out=0,
    )
