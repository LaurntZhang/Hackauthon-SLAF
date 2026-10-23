"""Invariants du graphe FinGuard (CADRAGE §4) et reprise HITL."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from typing import Any

import pytest

from src.control.exceptions import (
    ConflictError,
    GovernanceViolationError,
    InvalidSignatureError,
    NotFoundError,
)
from src.graph.graph_runtime import FinGuardSystem, GraphRuntime, SharedServices
from src.models.finguard_contracts import HumanAction, KillScope
from src.observability.langfuse_adapter import LangfuseExporter
from tests.conftest import failing_llm, proposal, signed_decision

EXPECTED_NODES = {
    "firewall",
    "proposer",
    "policy_engine",
    "risk_judge",
    "compliance_judge",
    "quorum",
    "hitl_gate",
    "authorize",
    "executor",
    "integrity_check",
    "risk_governor",
    "execution_gateway",
}


def actions(result: Any) -> list[str]:
    return [e.action for e in result.audit_trail]


def test_graph_has_the_twelve_nodes_and_no_cycle(runtime: GraphRuntime) -> None:
    drawable = runtime.graph.get_graph()
    nodes = {n for n in drawable.nodes if not n.startswith("__")}
    assert nodes == EXPECTED_NODES
    edges: dict[str, set[str]] = {}
    for edge in drawable.edges:
        edges.setdefault(edge.source, set()).add(edge.target)
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(node: str) -> None:
        assert node not in visiting, f"cycle détecté via {node}"
        if node in done:
            return
        visiting.add(node)
        for target in edges.get(node, set()):
            visit(target)
        visiting.discard(node)
        done.add(node)

    visit("__start__")


def test_nominal_transaction_executes_with_full_audit_trail(
    runtime: GraphRuntime, valid_tx: dict[str, Any]
) -> None:
    result = runtime.submit(proposal=valid_tx)
    assert result.status == "executed"
    assert result.report is not None and result.report.status.value == "filled"
    for required in (
        "intent_proposed",
        "policy_evaluated",
        "quorum_decided",
        "authorization_issued",
        "integrity_checked",
        "risk_checked",
        "order_executed",
        "transaction_completed",
    ):
        assert required in actions(result)
    for event in result.audit_trail:
        assert event.agent_id and event.action and event.timestamp.tzinfo is not None
        assert event.reasoning and event.status and event.policy_version


def test_invariant_rejection_never_reaches_executor(
    runtime: GraphRuntime, suspicious_tx: dict[str, Any]
) -> None:
    result = runtime.submit(proposal=suspicious_tx)
    assert result.status == "blocked"
    assert result.order is None and result.authorization is None
    assert "order_prepared" not in actions(result)
    assert runtime.market.fills == []


def test_scope_escape_is_blocked_and_recorded_as_infraction(runtime: GraphRuntime) -> None:
    result = runtime.submit(proposal=proposal(asset="XC-BTC-PERP", asset_type="crypto"))
    assert result.status == "blocked"
    policy_events = [e for e in result.audit_trail if e.action == "policy_evaluated"]
    assert policy_events[0].status == "block" and "ASSET_TYPE_FORBIDDEN" in policy_events[0].context["rules"]
    assert runtime.mandates.get("proposer").trust_score == 80


def test_invariant_tampered_order_is_blocked_and_never_executed(
    runtime: GraphRuntime, valid_tx: dict[str, Any]
) -> None:
    result = runtime.submit(proposal=valid_tx, simulation={"executor_tamper": {"amount": "9000"}})
    assert result.status == "blocked"
    assert result.authorization is not None
    assert runtime.authorizations.get(result.authorization.auth_id).revoked
    assert runtime.market.fills == []
    assert runtime.mandates.get("executor").trust_score == 60


def test_high_value_pauses_then_signed_approval_executes(
    runtime: GraphRuntime, high_value_tx: dict[str, Any]
) -> None:
    paused = runtime.submit(proposal=high_value_tx)
    assert paused.status == "awaiting_approval"
    assert paused.authorization is None and runtime.market.fills == []
    before = Counter(actions(paused))

    done = runtime.resume(paused.thread_id, signed_decision(paused))
    after = Counter(actions(done))
    assert done.status == "executed"
    assert done.intent == paused.intent
    assert done.human_decision is not None and done.human_decision.approver_id == "risk_officer_1"
    assert done.authorization is not None and "risk_officer_1" in done.authorization.approvers
    for action in (
        "intent_proposed",
        "policy_evaluated",
        "judge_verdict",
        "quorum_decided",
        "hitl_requested",
    ):
        assert after[action] == before[action], f"{action} rejoué à la reprise"


@pytest.mark.parametrize(
    ("action", "status"), [(HumanAction.REJECT, "rejected"), (HumanAction.REPORT, "reported")]
)
def test_human_rejection_never_reaches_executor(
    runtime: GraphRuntime, high_value_tx: dict[str, Any], action: HumanAction, status: str
) -> None:
    paused = runtime.submit(proposal=high_value_tx)
    done = runtime.resume(paused.thread_id, signed_decision(paused, action))
    assert done.status == status
    assert done.order is None and runtime.market.fills == []


def test_invalid_signature_keeps_thread_paused(runtime: GraphRuntime, high_value_tx: dict[str, Any]) -> None:
    paused = runtime.submit(proposal=high_value_tx)
    with pytest.raises(InvalidSignatureError):
        runtime.resume(paused.thread_id, signed_decision(paused, secret="forged"))
    assert runtime.get(paused.thread_id).status == "awaiting_approval"
    assert "hitl_signature_rejected" in actions(runtime.get(paused.thread_id))
    assert runtime.resume(paused.thread_id, signed_decision(paused)).status == "executed"


def test_resume_errors_are_typed(
    runtime: GraphRuntime, valid_tx: dict[str, Any], high_value_tx: dict[str, Any]
) -> None:
    executed = runtime.submit(proposal=valid_tx)
    paused = runtime.submit(proposal=high_value_tx)
    with pytest.raises(NotFoundError):
        runtime.resume("thr-unknown", signed_decision(paused))
    with pytest.raises(ConflictError):
        runtime.resume(
            executed.thread_id, signed_decision(paused).model_copy(update={"thread_id": executed.thread_id})
        )
    with pytest.raises(GovernanceViolationError):
        runtime.resume(
            paused.thread_id, signed_decision(paused).model_copy(update={"thread_id": "thr-other"})
        )


def test_kill_switch_blocks_execution_in_every_runtime(
    system: FinGuardSystem, valid_tx: dict[str, Any]
) -> None:
    system.shared.kill_switch.engage(
        scope=KillScope.GLOBAL, actor_id="ops_officer_1", is_human=True, reason="test", agent_id=None
    )
    sandbox = system.new_sandbox("kill")
    for runtime in (system.main, sandbox):
        result = runtime.submit(proposal=valid_tx)
        assert result.status == "blocked" and "Kill switch" in (result.reason or "")
        assert runtime.market.fills == []


def test_invariant_llm_outage_never_breaks_the_graph(
    make_shared: Callable[..., SharedServices], valid_tx: dict[str, Any]
) -> None:
    runtime = FinGuardSystem(make_shared(llm_factory=failing_llm)).main
    result = runtime.submit(objective="Acheter 4000 € d'OAT 2034")
    assert result.status == "executed"
    fallbacks = [e for e in result.audit_trail if e.action == "llm_fallback"]
    assert {e.agent_id for e in fallbacks} == {"proposer", "risk_judge", "compliance_judge"}


def test_invariant_langfuse_outage_never_breaks_the_graph(
    system: FinGuardSystem, valid_tx: dict[str, Any]
) -> None:
    class BrokenClient:
        def create_event(self, **_: Any) -> None:
            raise TimeoutError("langfuse down")

    degraded: list[str] = []
    exporter = LangfuseExporter(BrokenClient(), degraded.append)
    system.shared.bus.subscribe("langfuse", exporter)
    result = system.main.submit(proposal=valid_tx)
    assert result.status == "executed"
    assert not exporter.enabled and degraded == ["TimeoutError"]


def test_failing_bus_subscriber_is_isolated(system: FinGuardSystem, valid_tx: dict[str, Any]) -> None:
    def explode(_: Any) -> None:
        raise RuntimeError("boom")

    system.shared.bus.subscribe("broken", explode)
    assert system.main.submit(proposal=valid_tx).status == "executed"
    assert system.shared.bus.subscriber_failures["broken"] > 0


def test_amounts_stay_decimal_through_the_graph(runtime: GraphRuntime) -> None:
    result = runtime.submit(proposal=proposal(amount="1234.56"))
    assert result.intent is not None and str(result.intent.amount) == "1234.56"
    assert result.order is not None and str(result.order.amount) == "1234.56"
