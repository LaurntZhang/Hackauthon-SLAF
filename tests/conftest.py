"""Fixtures communes : système isolé (audit temporaire), transactions modèles et signatures HITL."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.agents.llm import StructuredLLM
from src.api.main import create_app
from src.control.hitl import DEMO_SECRET, approval_message, control_message, sign
from src.control.policy_config import PolicyConfig, load_policies
from src.graph.graph_runtime import FinGuardSystem, GraphRuntime, SharedServices
from src.models.api_models import TransactionResult
from src.models.finguard_contracts import HumanAction, HumanDecision, utc_now

SECRET = "test-secret"


@pytest.fixture(autouse=True)
def _script_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINGUARD_LLM", "off")
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)


@pytest.fixture
def policies() -> PolicyConfig:
    return load_policies()


@pytest.fixture
def audit_path(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def make_shared(policies: PolicyConfig, audit_path: Path) -> Callable[..., SharedServices]:
    def factory(**overrides: Any) -> SharedServices:
        params: dict[str, Any] = {"config": policies, "audit_path": audit_path, "hitl_secret": SECRET}
        params.update(overrides)
        return SharedServices.create(**params)

    return factory


@pytest.fixture
def shared(make_shared: Callable[..., SharedServices]) -> SharedServices:
    return make_shared()


@pytest.fixture
def system(shared: SharedServices) -> FinGuardSystem:
    return FinGuardSystem(shared)


@pytest.fixture
def runtime(system: FinGuardSystem) -> GraphRuntime:
    return system.main


@pytest.fixture
def client(system: FinGuardSystem) -> Iterator[TestClient]:
    with TestClient(create_app(system)) as test_client:
        yield test_client


def proposal(**overrides: Any) -> dict[str, Any]:
    """Proposition conforme de 4 000 € d'OAT (S1) ; surcharge champ par champ."""
    base: dict[str, Any] = {
        "asset": "FR-OAT-2034",
        "asset_type": "bond",
        "side": "buy",
        "amount": "4000",
        "counterparty": "BNP-SECURITIES-SIM",
        "rationale": "Allonger la duration souveraine",
        "confidence": 0.85,
    }
    base.update(overrides)
    return base


@pytest.fixture
def valid_tx() -> dict[str, Any]:
    return proposal()


@pytest.fixture
def high_value_tx() -> dict[str, Any]:
    return proposal(asset="EQ-LUMEN-SA", asset_type="equity", amount="85000", rationale="Renforcer la tech")


@pytest.fixture
def suspicious_tx() -> dict[str, Any]:
    return proposal(counterparty="SHADOW-BROKER-LTD")


def signed_decision(
    result: TransactionResult,
    action: HumanAction = HumanAction.APPROVE,
    approver_id: str = "risk_officer_1",
    secret: str = SECRET,
) -> HumanDecision:
    """Décision HITL signée pour un thread en attente."""
    assert result.pending_approval is not None
    timestamp = utc_now().replace(microsecond=0)
    message = approval_message(
        thread_id=result.thread_id,
        action=action,
        approver_id=approver_id,
        intent_hash=result.pending_approval.intent_hash,
        timestamp=timestamp,
    )
    return HumanDecision(
        thread_id=result.thread_id,
        action=action,
        approver_id=approver_id,
        signature=sign(secret, message),
        timestamp=timestamp,
    )


def signed_control(
    command: str, target: str, operator_id: str = "ops_officer_1", secret: str = SECRET
) -> dict[str, Any]:
    """Corps JSON d'une commande d'opérateur signée."""
    timestamp = utc_now().replace(microsecond=0)
    message = control_message(command=command, target=target, operator_id=operator_id, timestamp=timestamp)
    return {
        "operator_id": operator_id,
        "signature": sign(secret, message),
        "timestamp": timestamp.isoformat(),
        "reason": "commande de test",
    }


class FailingModel:
    """Modèle LLM qui échoue systématiquement (panne fournisseur simulée)."""

    def with_structured_output(self, schema: Any) -> Any:
        raise ConnectionError("fournisseur LLM injoignable")


def failing_llm() -> StructuredLLM:
    return StructuredLLM(factory=FailingModel, enabled=True)


__all__ = ["DEMO_SECRET", "SECRET", "failing_llm", "proposal", "signed_control", "signed_decision"]
