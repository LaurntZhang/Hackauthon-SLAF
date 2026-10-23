"""Un test par scénario de démo S1 à S6 (CADRAGE §9)."""

from __future__ import annotations

from src.graph.graph_runtime import FinGuardSystem
from src.observability.audit_chain import verify_chain
from src.simulation.scenarios import run_scenario


def test_s1_nominal_executes_without_pause(system: FinGuardSystem) -> None:
    result = run_scenario(system, "nominal")
    assert result.passed
    step = result.steps[0]
    assert step.status == "executed" and step.pending_approval is None


def test_s2_veto_waits_for_human_then_executes_when_signed(system: FinGuardSystem) -> None:
    pending = run_scenario(system, "veto_hitl")
    assert pending.passed and pending.steps[0].status == "awaiting_approval"
    approved = run_scenario(system, "veto_hitl", auto_approve=True)
    assert approved.passed and approved.steps[-1].status == "executed"


def test_s3_tampering_is_blocked_and_executor_loses_trust(system: FinGuardSystem) -> None:
    result = run_scenario(system, "tampering")
    assert result.passed
    assert result.details == {"executor_trust": 60, "market_fills": 0}


def test_s4_injection_is_flagged_blocked_and_quarantined(system: FinGuardSystem) -> None:
    result = run_scenario(system, "injection")
    assert result.passed
    assert result.details["proposer_quarantined"] and result.details["iban_redacted"]
    actions = [e.action for e in result.steps[0].audit_trail]
    assert (
        actions.index("content_flagged")
        < actions.index("policy_evaluated")
        < actions.index("agent_quarantined")
    )


def test_s5_salami_opens_breaker_and_supervisor_alerts(system: FinGuardSystem) -> None:
    result = run_scenario(system, "salami")
    assert result.passed
    assert result.details["executed_orders"] == 10 and result.details["blocked_orders"] == 2
    assert result.details["supervisor_alerts"]


def test_s6_tampered_audit_line_is_detected(system: FinGuardSystem) -> None:
    run_scenario(system, "nominal")
    result = run_scenario(system, "audit_tamper")
    assert result.passed
    assert result.details["detected_line"] == result.details["tampered_line"]
    assert verify_chain(system.shared.chain.path).valid


def test_scenarios_are_isolated_from_the_main_runtime(system: FinGuardSystem) -> None:
    run_scenario(system, "injection")
    run_scenario(system, "salami")
    assert not system.main.mandates.get("proposer").quarantined
    assert not system.main.risk_governor.state().open
