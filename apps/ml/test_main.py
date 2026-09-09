from __future__ import annotations

import pytest
from conftest import SCHEMA, baskets
from fastapi.testclient import TestClient

import basket
import contract
import main


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ML_SHARED_SECRET", raising=False)
    monkeypatch.setenv("ML_ALLOW_NO_SECRET", "1")
    return TestClient(main.app)


def test_health_names_the_contract_and_every_model(client):
    body = client.get("/health").json()

    assert body["contractVersion"] == contract.CONTRACT_VERSION
    assert body["models"] == {
        "segment": "segment:v1.0.0",
        "churn": "churn:v1.0.0",
        "basket": "basket:v1.0.0",
    }


def test_a_route_returns_the_contract(client, basket_rows):
    body = client.post("/basket", json={"rows": basket_rows, "schema": SCHEMA, "config": {}}).json()

    assert body["status"] == "ok"
    assert set(body) == {
        "contractVersion", "modelVersion", "status", "warnings",
        "metrics", "predictions", "metadata",
    }
    assert set(body["metadata"]) == {"rowsIn", "entitiesOut", "computedAt"}
    assert body["metadata"]["rowsIn"] == len(basket_rows)


@pytest.mark.parametrize("route", ["segment", "churn", "basket"])
def test_no_rows_is_a_refusal_not_a_crash(client, route):
    body = client.post(f"/{route}", json={"rows": [], "schema": {}, "config": {}}).json()

    assert body["status"] == "insufficient_data"
    assert body["warnings"]


def test_a_model_that_throws_is_reported_inside_the_contract(client, monkeypatch):
    # Node treats any non-2xx as no result at all, so the reason has to come back
    # in a 200 to be worth anything.
    def explode(*_args, **_kwargs):
        raise RuntimeError("something went wrong")

    monkeypatch.setattr(basket, "run", explode)
    response = client.post("/basket", json={"rows": [], "schema": SCHEMA, "config": {}})

    assert response.status_code == 200
    assert response.json()["status"] == "error"
    assert "something went wrong" in response.json()["warnings"][0]


def test_a_malformed_body_is_rejected(client):
    assert client.post("/basket", json={"rows": "not a list"}).status_code == 422


def test_the_shared_secret_is_required_when_it_is_set(monkeypatch):
    monkeypatch.setenv("ML_SHARED_SECRET", "s3cret")
    monkeypatch.delenv("ML_ALLOW_NO_SECRET", raising=False)
    guarded = TestClient(main.app)
    body = {"rows": baskets(orders=210, seed=13), "schema": SCHEMA, "config": {}}

    assert guarded.post("/basket", json=body).status_code == 401
    assert guarded.post("/basket", json=body, headers={"x-ml-secret": "wrong"}).status_code == 401
    assert guarded.post("/basket", json=body, headers={"x-ml-secret": "s3cret"}).status_code == 200
    # Health is how the caller finds out the service is up; it stays open.
    assert guarded.get("/health").status_code == 200


def test_a_missing_secret_closes_the_door_rather_than_opening_it(monkeypatch):
    # An unset secret used to skip the check, so a deployment that forgot the
    # variable served anyone who reached the port.
    monkeypatch.delenv("ML_SHARED_SECRET", raising=False)
    monkeypatch.delenv("ML_ALLOW_NO_SECRET", raising=False)
    unconfigured = TestClient(main.app)
    body = {"rows": [], "schema": SCHEMA, "config": {}}

    assert unconfigured.post("/basket", json=body).status_code == 503
    assert unconfigured.post("/basket", json=body, headers={"x-ml-secret": "guess"}).status_code == 503
    # Health stays open, so the caller can still see the service is up.
    assert unconfigured.get("/health").status_code == 200


def test_a_non_ascii_secret_header_is_refused_not_a_crash(monkeypatch):
    monkeypatch.setenv("ML_SHARED_SECRET", "s3cret")
    monkeypatch.delenv("ML_ALLOW_NO_SECRET", raising=False)
    guarded = TestClient(main.app)
    body = {"rows": [], "schema": SCHEMA, "config": {}}

    # Headers arrive as bytes and starlette decodes them latin-1, which is how a
    # non-ASCII secret reaches `hmac.compare_digest` at all.
    response = guarded.post(
        "/basket", json=body, headers={"x-ml-secret": "sécret".encode("latin-1")}
    )

    assert response.status_code == 401
