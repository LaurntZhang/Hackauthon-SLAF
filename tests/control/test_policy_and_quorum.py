"""Policy Engine et quorum pondéré : règles figées du cadrage."""

from __future__ import annotations

from decimal import Decimal

import pytest

from src.control.mandates import MandateRegistry, TrustEvent
from src.control.policy_config import PolicyConfig, load_mandates
from src.control.policy_engine import PolicyEngine
from src.control.quorum import WeightedQuorum
from src.models.finguard_contracts import (
    JudgeVerdict,
    PolicyDecision,
    PolicyOutcome,
    TransactionIntent,
    UntrustedContent,
    Vote,
)
from src.simulation.fixtures import instrument_types


@pytest.fixture
def mandates(policies: PolicyConfig) -> MandateRegistry:
    return MandateRegistry(load_mandates(), policies.trust)


@pytest.fixture
def engine(policies: PolicyConfig, mandates: MandateRegistry) -> PolicyEngine:
    return PolicyEngine(policies, mandates, instrument_types())


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
        "rationale": "Allonger la duration",
        "confidence": 0.85,
    }
    data.update(overrides)
    return TransactionIntent.model_validate(data)


def test_conforming_intent_is_allowed(engine: PolicyEngine) -> None:
    result = engine.evaluate(intent(), [])
    assert result.decision.outcome is PolicyOutcome.ALLOW
    assert result.decision.policy_version == "2026.10.23-1"


@pytest.mark.parametrize(
    ("overrides", "rule"),
    [
        ({"asset": "XC-BTC-PERP", "asset_type": "crypto"}, "ASSET_TYPE_FORBIDDEN"),
        ({"asset": "OP-EURO50-CALL", "asset_type": "derivative"}, "ASSET_TYPE_FORBIDDEN"),
        ({"counterparty": "SHADOW-BROKER-LTD"}, "COUNTERPARTY_NOT_WHITELISTED"),
        ({"requested_tool": "wire_transfer"}, "TOOL_NOT_ALLOWED"),
        ({"asset": "FR-OAT-2099"}, "ASSET_UNKNOWN"),
        ({"asset_type": "equity"}, "ASSET_TYPE_MISMATCH"),
        ({"currency": "USD"}, "CURRENCY_NOT_ALLOWED"),
        ({"amount": Decimal("150000")}, "MANDATE_MAX_AMOUNT"),
        ({"proposer_id": "rogue_agent"}, "MANDATE_UNKNOWN"),
    ],
)
def test_out_of_mandate_intent_is_blocked(
    engine: PolicyEngine, overrides: dict[str, object], rule: str
) -> None:
    result = engine.evaluate(intent(**overrides), [])
    assert result.decision.outcome is PolicyOutcome.BLOCK
    assert rule in result.decision.triggered_rules


def test_quarantined_agent_is_blocked(engine: PolicyEngine, mandates: MandateRegistry) -> None:
    mandates.quarantine("proposer")
    assert "AGENT_QUARANTINED" in engine.evaluate(intent(), []).decision.triggered_rules


def test_amount_above_autonomous_limit_is_forced_to_escalate(engine: PolicyEngine) -> None:
    result = engine.evaluate(intent(amount=Decimal("10000.01")), [])
    assert result.decision.outcome is PolicyOutcome.ESCALATE
    assert result.decision.triggered_rules == ["AUTONOMOUS_LIMIT"]
    assert engine.evaluate(intent(amount=Decimal("10000")), []).decision.outcome is PolicyOutcome.ALLOW


def test_low_trust_halves_the_autonomous_limit(engine: PolicyEngine, mandates: MandateRegistry) -> None:
    mandates.adjust_trust("proposer", TrustEvent.TAMPERING_AFTER_APPROVAL)
    assert mandates.get("proposer").trust_score == 60
    assert engine.evaluate(intent(amount=Decimal("6000")), []).decision.outcome is PolicyOutcome.ESCALATE


def test_blocked_intent_citing_flagged_source_counts_as_injection_followed(engine: PolicyEngine) -> None:
    flagged = UntrustedContent(source="news:1", content="x", flagged=True, flags=["FW_FUNDS_TRANSFER"])
    result = engine.evaluate(intent(requested_tool="wire_transfer", data_sources=["news:1"]), [flagged])
    assert result.injection_followed
    assert "INJECTION_FOLLOWED" in result.decision.triggered_rules


def test_conforming_intent_citing_flagged_source_escalates(engine: PolicyEngine) -> None:
    flagged = UntrustedContent(source="news:1", content="x", flagged=True, flags=["FW_ROLE_OVERRIDE"])
    result = engine.evaluate(intent(data_sources=["news:1"]), [flagged])
    assert result.decision.outcome is PolicyOutcome.ESCALATE
    assert "FLAGGED_SOURCE_CITED" in result.decision.triggered_rules


# --- quorum ----------------------------------------------------------------------------------------


@pytest.fixture
def quorum(policies: PolicyConfig) -> WeightedQuorum:
    return WeightedQuorum(policies.quorum, ("risk_judge", "compliance_judge"))


ALLOW = PolicyDecision(outcome=PolicyOutcome.ALLOW, policy_version="v", explanation="ok")
ESCALATE = PolicyDecision(
    outcome=PolicyOutcome.ESCALATE, triggered_rules=["AUTONOMOUS_LIMIT"], policy_version="v", explanation="x"
)


def verdict(judge: str, vote: Vote) -> JudgeVerdict:
    return JudgeVerdict(judge_id=judge, intent_id="int-1", vote=vote, confidence=0.9, justification="test")


FULL_TRUST = {"risk_judge": 100, "compliance_judge": 100}


def test_two_approvals_allow_above_unanimity_threshold(quorum: WeightedQuorum) -> None:
    votes = [verdict("risk_judge", Vote.APPROVE), verdict("compliance_judge", Vote.APPROVE)]
    assert quorum.decide(intent(), votes, FULL_TRUST, ALLOW).outcome is PolicyOutcome.ALLOW


@pytest.mark.parametrize("vote", [Vote.VETO, Vote.ABSTAIN])
def test_any_veto_or_abstain_escalates(quorum: WeightedQuorum, vote: Vote) -> None:
    votes = [verdict("risk_judge", vote), verdict("compliance_judge", Vote.APPROVE)]
    decision = quorum.decide(intent(amount=Decimal("500")), votes, FULL_TRUST, ALLOW)
    assert decision.outcome is PolicyOutcome.ESCALATE
    assert "QUORUM_VETO_OR_ABSTAIN" in decision.triggered_rules


def test_missing_judge_cannot_reach_unanimity(quorum: WeightedQuorum) -> None:
    decision = quorum.decide(intent(), [verdict("risk_judge", Vote.APPROVE)], FULL_TRUST, ALLOW)
    assert decision.outcome is PolicyOutcome.ESCALATE
    assert "QUORUM_MISSING_VERDICT" in decision.triggered_rules


def test_weighted_ratio_must_strictly_exceed_threshold_for_small_amounts(quorum: WeightedQuorum) -> None:
    small = intent(amount=Decimal("800"))
    votes = [verdict("risk_judge", Vote.APPROVE), verdict("compliance_judge", Vote.APPROVE)]
    allowed = quorum.decide(small, votes, FULL_TRUST, ALLOW)
    assert allowed.outcome is PolicyOutcome.ALLOW and allowed.weighted_ratio == 1.0
    no_weight = quorum.decide(small, votes, {"risk_judge": 0, "compliance_judge": 0}, ALLOW)
    assert no_weight.outcome is PolicyOutcome.ESCALATE
    assert "QUORUM_WEIGHTED_BELOW_THRESHOLD" in no_weight.triggered_rules


def test_policy_escalation_survives_a_unanimous_quorum(quorum: WeightedQuorum) -> None:
    votes = [verdict("risk_judge", Vote.APPROVE), verdict("compliance_judge", Vote.APPROVE)]
    decision = quorum.decide(intent(amount=Decimal("85000")), votes, FULL_TRUST, ESCALATE)
    assert decision.outcome is PolicyOutcome.ESCALATE
    assert "POLICY_FORCED_ESCALATION" in decision.triggered_rules
