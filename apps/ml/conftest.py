"""Shared fixtures. Every generator is seeded, so a failing test fails the same way twice."""

from __future__ import annotations

import json
import random
from datetime import date, timedelta
from typing import Any

import pytest

SCHEMA = {
    "customer_id": "customer_id",
    "order_id": "order_id",
    "date": "order_date",
    "revenue": "revenue",
    "product_name": "product_name",
}


def serialised(result: dict[str, Any]) -> str:
    """A result as text, minus the one field that cannot be reproducible.

    `metadata.computedAt` is the wall clock. Everything else is a function of the
    rows, the config and the pinned dependencies, and that is the claim these
    tests exist to check.
    """
    copy = json.loads(json.dumps(result))
    copy["metadata"].pop("computedAt")
    return json.dumps(copy, sort_keys=True)


def transactions(
    *,
    customers: int = 200,
    days: int = 900,
    seed: int = 11,
    lapse_rate: float = 0.4,
    start: date = date(2023, 1, 1),
) -> list[dict[str, Any]]:
    """Order lines for customers who buy on their own rhythm, some of whom stop.

    Distinct buying rhythms and a genuine lapse are what make segments separable
    and churn learnable, so the models are exercised rather than merely run.
    """
    rnd = random.Random(seed)
    rows: list[dict[str, Any]] = []
    products = ["Phone", "Earbuds", "Laptop", "Monitor", "Desk", "Chair"]
    for c in range(customers):
        interval = rnd.choice([14, 21, 30, 45])
        stop = rnd.randint(days // 6, days - 60) if rnd.random() < lapse_rate else days
        day, order = rnd.randint(0, interval), 0
        while day < min(stop, days):
            for _ in range(rnd.randint(1, 3)):
                rows.append({
                    "customer_id": f"C{c:04d}",
                    "order_id": f"O{c:04d}-{order:03d}",
                    "order_date": (start + timedelta(days=day)).isoformat(),
                    "revenue": round(rnd.uniform(20, 200), 2),
                    "product_name": rnd.choice(products),
                })
            order += 1
            day += max(3, int(rnd.gauss(interval, interval * 0.25)))
    return rows


def baskets(*, orders: int = 900, seed: int = 3, pair_rate: float = 0.55) -> list[dict[str, Any]]:
    """Order lines where some products genuinely sell together."""
    rnd = random.Random(seed)
    catalogue = ["Phone", "Earbuds", "Laptop", "Monitor", "Desk", "Chair", "Mouse", "Keyboard"]
    partner = {"Phone": "Earbuds", "Laptop": "Monitor", "Desk": "Chair", "Mouse": "Keyboard"}
    rows: list[dict[str, Any]] = []
    for o in range(orders):
        first = rnd.choice(catalogue)
        items = {first}
        for _ in range(rnd.randint(0, 3)):
            items.add(partner[first] if first in partner and rnd.random() < pair_rate else rnd.choice(catalogue))
        for product in items:
            rows.append({"order_id": f"ORD-{o:05d}", "product_name": product, "revenue": 10.0})
    return rows


def single_product_orders(*, orders: int = 400, seed: int = 5) -> list[dict[str, Any]]:
    """One product per order — the shape that would produce valid, useless rules."""
    rnd = random.Random(seed)
    catalogue = ["Phone", "Earbuds", "Laptop", "Monitor"]
    return [
        {"order_id": f"ORD-{o:05d}", "product_name": rnd.choice(catalogue), "revenue": 10.0}
        for o in range(orders)
    ]


@pytest.fixture(scope="session")
def sales_rows() -> list[dict[str, Any]]:
    return transactions()


@pytest.fixture(scope="session")
def basket_rows() -> list[dict[str, Any]]:
    return baskets()
