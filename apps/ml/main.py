"""The Python service. Stateless maths, and nothing else.

No database, no connection string, no organisation lookup, no authorisation logic
and no persistence. Node loads rows that are already tenant-scoped, posts them
here, and stores what comes back — so tenant isolation stays in the one place it
already lives.

Bound to 127.0.0.1 by the process that spawns it. The shared secret is defence in
depth on top of that, not the boundary itself.
"""

from __future__ import annotations

import hmac
import os
from typing import Any, Callable

from fastapi import FastAPI, Header, HTTPException

import basket
import churn
import contract
import segmentation

app = FastAPI(title="NoPS Signals", version=contract.CONTRACT_VERSION)

MODELS: dict[str, Any] = {
    "segment": segmentation,
    "churn": churn,
    "basket": basket,
}


def _authorise(supplied: str | None) -> None:
    expected = os.environ.get("ML_SHARED_SECRET", "")
    if not expected:
        # Unset means local development, where the loopback bind is the whole
        # boundary. Deployments set it; `.env.example` says so.
        return
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="bad shared secret")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "contractVersion": contract.CONTRACT_VERSION,
        "models": {name: module.MODEL_VERSION for name, module in MODELS.items()},
    }


def _route(name: str) -> Callable[[contract.MlRequest, str | None], dict[str, Any]]:
    module = MODELS[name]

    def handler(
        body: contract.MlRequest,
        x_ml_secret: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _authorise(x_ml_secret)
        try:
            return module.run(body.rows, body.schema_, body.config)
        except Exception as exc:  # noqa: BLE001
            # A model failure is reported inside the contract, not as a 5xx: the
            # reason is worth storing, and Node treats any non-2xx as "no result"
            # and would throw it away.
            return contract.failed(
                module.MODEL_VERSION,
                f"{type(exc).__name__}: {exc}",
                rows_in=len(body.rows),
            )

    handler.__name__ = f"{name}_route"
    return handler


for _name in MODELS:
    app.post(f"/{_name}")(_route(_name))
