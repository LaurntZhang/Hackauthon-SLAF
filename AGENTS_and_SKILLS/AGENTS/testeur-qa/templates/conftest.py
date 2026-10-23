"""Reusable synthetic fixtures for governance tests."""

from decimal import Decimal

import pytest


@pytest.fixture
def valid_transaction() -> dict[str, object]:
    return {"amount": Decimal("3450.00"), "currency": "EUR", "counterparty": "Nexus Trading Ltd"}


@pytest.fixture
def high_value_transaction() -> dict[str, object]:
    return {"amount": Decimal("75000.00"), "currency": "EUR", "counterparty": "Apex Capital Partners"}
