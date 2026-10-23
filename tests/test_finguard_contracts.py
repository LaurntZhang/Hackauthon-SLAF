"""Verrouillage des contrats figés (CADRAGE §7)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from src.models import contracts
from src.models.finguard_contracts import (
    AgentMandate,
    AuditEvent,
    Authorization,
    DecisionRecord,
    ExecutionOrder,
    ExecutionReport,
    HumanDecision,
    JudgeVerdict,
    PolicyDecision,
    TransactionIntent,
    UntrustedContent,
    compute_intent_hash,
    compute_order_hash,
)

FROZEN_FIELDS: dict[type, set[str]] = {
    AgentMandate: {
        "agent_id",
        "role",
        "allowed_tools",
        "allowed_assets",
        "max_amount",
        "trust_score",
        "quarantined",
        "expires_at",
    },
    UntrustedContent: {"source", "content", "flagged", "flags"},
    TransactionIntent: {
        "intent_id",
        "correlation_id",
        "proposer_id",
        "asset",
        "asset_type",
        "side",
        "amount",
        "currency",
        "counterparty",
        "rationale",
        "confidence",
        "data_sources",
    },
    JudgeVerdict: {"judge_id", "intent_id", "vote", "rule_ids", "confidence", "justification"},
    PolicyDecision: {"outcome", "triggered_rules", "policy_version", "explanation"},
    HumanDecision: {"thread_id", "action", "approver_id", "signature", "timestamp"},
    Authorization: {
        "auth_id",
        "intent_id",
        "intent_hash",
        "max_amount",
        "approvers",
        "expires_at",
        "revoked",
    },
    ExecutionOrder: {"order_id", "auth_id", "executor_id", "asset", "side", "amount", "counterparty"},
    ExecutionReport: {"order_id", "status", "reason"},
    AuditEvent: {
        "timestamp",
        "correlation_id",
        "agent_id",
        "action",
        "reasoning",
        "status",
        "policy_version",
        "trust_score",
        "context",
        "prev_hash",
        "hash",
    },
    DecisionRecord: {"correlation_id", "summary", "factors", "votes", "rules", "uncertainties", "path"},
}


def make_intent(**overrides: object) -> TransactionIntent:
    data: dict[str, object] = {
        "intent_id": "int-1",
        "correlation_id": "cor-1",
        "proposer_id": "proposer",
        "asset": "FR-OAT-2034",
        "asset_type": "bond",
        "side": "buy",
        "amount": Decimal("4000"),
        "counterparty": "BNP-SECURITIES-SIM",
        "rationale": "Allonger la duration",
        "confidence": 0.8,
    }
    data.update(overrides)
    return TransactionIntent.model_validate(data)


@pytest.mark.parametrize("model", list(FROZEN_FIELDS))
def test_frozen_contract_keeps_every_documented_field(model: type) -> None:
    assert FROZEN_FIELDS[model] <= set(model.model_fields)  # type: ignore[attr-defined]


def test_legacy_contracts_module_reexports_the_same_classes() -> None:
    assert contracts.TransactionIntent is TransactionIntent
    assert contracts.compute_intent_hash is compute_intent_hash


def test_intent_is_immutable() -> None:
    intent = make_intent()
    with pytest.raises(ValidationError):
        intent.amount = Decimal("1")  # type: ignore[misc]


@pytest.mark.parametrize(
    "overrides",
    [
        {"amount": Decimal("-5")},
        {"amount": Decimal("0")},
        {"amount": 4000.0},
        {"confidence": 1.5},
        {"side": "short"},
        {"asset_type": "nft"},
        {"currency": "EURO"},
        {"unexpected": "field"},
    ],
)
def test_malformed_intent_is_rejected_before_the_graph(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        make_intent(**overrides)


def test_intent_hash_covers_only_economic_fields_and_is_canonical() -> None:
    base = make_intent()
    assert compute_intent_hash(base) == compute_intent_hash(
        make_intent(rationale="autre texte", intent_id="int-2")
    )
    assert compute_intent_hash(base) == compute_intent_hash(make_intent(amount=Decimal("4000.00")))
    assert compute_intent_hash(base) != compute_intent_hash(make_intent(asset="DE-BUND-2033"))
    assert compute_intent_hash(base) != compute_intent_hash(make_intent(side="sell"))
    assert len(compute_intent_hash(base)) == 64


def test_order_hash_matches_intent_hash_only_when_identical() -> None:
    intent = make_intent()
    order = ExecutionOrder(
        order_id="ord-1",
        auth_id="auth-1",
        executor_id="executor",
        asset=intent.asset,
        asset_type=intent.asset_type,
        side=intent.side,
        amount=intent.amount,
        counterparty=intent.counterparty,
        currency=intent.currency,
    )
    assert compute_order_hash(order) == compute_intent_hash(intent)
    assert compute_order_hash(order.model_copy(update={"asset": "EQ-VERDA-SE"})) != compute_intent_hash(
        intent
    )


def test_human_decision_requires_hex_signature() -> None:
    with pytest.raises(ValidationError):
        HumanDecision(
            thread_id="t",
            action="approve",
            approver_id="a",
            signature="not-a-signature",
            timestamp=datetime.now(UTC),
        )
