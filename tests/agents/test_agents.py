"""Agents en mode script, repli LLM et limites du superviseur."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from pydantic import BaseModel

from src.agents.compliance_judge import ComplianceJudgeAgent
from src.agents.executor import ExecutorAgent
from src.agents.llm import StructuredLLM
from src.agents.proposer import ProposerAgent
from src.agents.risk_judge import RiskJudgeAgent
from src.control.policy_config import PolicyConfig
from src.models.finguard_contracts import (
    Authorization,
    TransactionIntent,
    UntrustedContent,
    Vote,
    compute_intent_hash,
    utc_now,
)
from src.simulation.fixtures import Portfolio
from tests.conftest import failing_llm

SCRIPT = StructuredLLM(enabled=False)


def intent(**overrides: object) -> TransactionIntent:
    data: dict[str, object] = {
        "intent_id": "int-1",
        "correlation_id": "cor-1",
        "proposer_id": "proposer",
        "asset": "FR-OAT-2034",
        "asset_type": "bond",
        "side": "buy",
        "amount": Decimal("4000"),
        "counterparty": "BNP-SECURITIES-SIM",
        "rationale": "Allonger la duration souveraine",
        "confidence": 0.85,
    }
    data.update(overrides)
    return TransactionIntent.model_validate(data)


class ApprovingModel:
    """Modèle LLM complaisant qui approuve tout."""

    def with_structured_output(self, schema: type[BaseModel]) -> Any:
        class Runnable:
            def invoke(self, _messages: object) -> BaseModel:
                return schema.model_validate(
                    {"vote": "approve", "rule_ids": [], "confidence": 0.99, "justification": "tout va bien"}
                )

        return Runnable()


def test_proposer_parses_objective_in_script_mode() -> None:
    outcome = ProposerAgent(SCRIPT, "BNP-SECURITIES-SIM").propose(
        correlation_id="cor-1", request={"objective": "Acheter 85 000 € d'actions Lumen"}, untrusted=[]
    )
    assert outcome.intent is not None
    assert (outcome.intent.asset, outcome.intent.amount, outcome.intent.side.value) == (
        "EQ-LUMEN-SA",
        Decimal("85000"),
        "buy",
    )


def test_proposer_reports_uninterpretable_objective_without_raising() -> None:
    outcome = ProposerAgent(SCRIPT, "BNP-SECURITIES-SIM").propose(
        correlation_id="cor-1", request={"objective": "fais quelque chose"}, untrusted=[]
    )
    assert outcome.intent is None and "non interprétable" in outcome.reason


def test_proposer_llm_failure_falls_back_explicitly() -> None:
    outcome = ProposerAgent(failing_llm(), "BNP-SECURITIES-SIM").propose(
        correlation_id="cor-1", request={"objective": "Acheter 4000 € d'OAT"}, untrusted=[]
    )
    assert outcome.intent is not None
    assert outcome.fallback_reason and "ConnectionError" in outcome.fallback_reason


def test_risk_judge_vetoes_large_equity_and_concentration(policies: PolicyConfig) -> None:
    judge = RiskJudgeAgent(SCRIPT, Portfolio(policies.fund.aum), policies)
    large = judge.assess(intent(asset="EQ-LUMEN-SA", asset_type="equity", amount=Decimal("85000"))).verdict
    assert large.vote is Vote.VETO and "RISK_LARGE_EQUITY_POSITION" in large.rule_ids
    concentrated = judge.assess(intent(amount=Decimal("120000"))).verdict
    assert "RISK_ISSUER_CONCENTRATION" in concentrated.rule_ids
    assert judge.assess(intent()).verdict.vote is Vote.APPROVE


def test_risk_judge_vetoes_selling_more_than_held(policies: PolicyConfig) -> None:
    judge = RiskJudgeAgent(SCRIPT, Portfolio(policies.fund.aum), policies)
    verdict = judge.assess(intent(side="sell", amount=Decimal("500000"))).verdict
    assert verdict.vote is Vote.VETO and "RISK_SHORT_SELL" in verdict.rule_ids


def test_compliance_judge_vetoes_unknown_counterparty_and_tainted_source(policies: PolicyConfig) -> None:
    judge = ComplianceJudgeAgent(SCRIPT, policies)
    flagged = UntrustedContent(source="news:1", content="x", flagged=True, flags=["FW_IBAN"])
    verdict = judge.assess(intent(counterparty="SHADOW", data_sources=["news:1"]), [flagged]).verdict
    assert verdict.vote is Vote.VETO
    assert {"COMPLIANCE_COUNTERPARTY_KYC", "COMPLIANCE_TAINTED_SOURCE"} <= set(verdict.rule_ids)


def test_llm_cannot_overturn_a_rule_based_veto(policies: PolicyConfig) -> None:
    complacent = StructuredLLM(factory=ApprovingModel, enabled=True)
    verdict = ComplianceJudgeAgent(complacent, policies).assess(intent(counterparty="SHADOW"), []).verdict
    assert verdict.vote is Vote.VETO


def test_judge_llm_failure_uses_rules_and_marks_fallback(policies: PolicyConfig) -> None:
    outcome = RiskJudgeAgent(failing_llm(), Portfolio(policies.fund.aum), policies).assess(intent())
    assert outcome.verdict.vote is Vote.APPROVE
    assert outcome.verdict.fallback_used and outcome.fallback_reason


def test_executor_copies_authorized_intent() -> None:
    approved = intent()
    auth = Authorization(
        auth_id="auth-1",
        intent_id=approved.intent_id,
        intent_hash=compute_intent_hash(approved),
        max_amount=approved.amount,
        approvers=["risk_judge"],
        expires_at=utc_now(),
    )
    order = ExecutorAgent().prepare(auth, approved)
    assert (order.asset, order.amount, order.counterparty) == (
        approved.asset,
        approved.amount,
        approved.counterparty,
    )
