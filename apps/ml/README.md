# `apps/ml` — the Signals service

Three questions the deterministic engine cannot answer, and nothing else:
who your customers really are as groups, who is about to stop buying, and what
sells with what. Everything else — cleaning, forecasting, correlation, anomalies,
key drivers, scheduling, SQL, metric calculation — stays in TypeScript, and adding
a fourth capability here needs the scope boundary in `docs/signals-plan.md`
reopened first.

## What it is not

No database, no connection string, no organisation lookup, no authorisation logic,
no persistence. Node loads rows that are already tenant-scoped, posts them here,
and stores what comes back. Tenant isolation stays in the one place it already is.

## Running it

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
ML_ALLOW_NO_SECRET=1 uvicorn main:app --host 127.0.0.1 --port 8000
```

In a deployment Node spawns this itself; running it by hand is for development.
Bind to `127.0.0.1` and nothing else. Set `ML_SHARED_SECRET` and send it as the
`x-ml-secret` header — defence in depth on top of the loopback bind, not the
boundary itself.

It is required. With no secret set the model routes answer `503` rather than
serving anyone who reaches the port; `ML_ALLOW_NO_SECRET=1` opts a development
machine out of that, and belongs nowhere else. Both are in `.env.example`.
`/health` is open either way, because that is how the caller learns the service
is up.

```bash
curl localhost:8000/health
curl -X POST localhost:8000/basket -H 'content-type: application/json' \
  -d '{"rows":[{"order_id":"1","product_name":"Phone"}],"schema":{"order_id":"order_id","product_name":"product_name"},"config":{}}'
```

## Tests

```bash
pytest apps/ml
```

Each model is checked for three things: that the same rows and config give the
same answer twice over, that it refuses rather than producing a weak number when
the data cannot support one, and that broken input — no rows, a missing column, a
single customer, identical values, text where money should be — comes back as a
refusal and never as an exception.

## The response

Every route returns the same envelope, and Node validates it before storing
anything:

```json
{
  "contractVersion": "1.0",
  "modelVersion": "basket:v1.0.0",
  "status": "ok | insufficient_data | error",
  "warnings": [],
  "metrics": {},
  "predictions": {},
  "metadata": { "rowsIn": 0, "entitiesOut": 0, "computedAt": "" }
}
```

`insufficient_data` is a **successful** response carrying the reason and no
predictions. A refusal is a result, not a failure, and the reason is what the page
shows.

Nothing in the payload names the estimator, so a model can be replaced behind a
`modelVersion` bump without the API or the UI changing.

## Reproducibility

Same rows, same config, same pinned dependencies, same `modelVersion`,
`random_state=42` → the same output. That is the claim, and it is the only claim.
`metadata.computedAt` is the wall clock and the one field excluded from it.

Everything in `requirements.txt` is pinned exactly, because an unpinned dependency
could change a prediction without anything in this repo changing.
