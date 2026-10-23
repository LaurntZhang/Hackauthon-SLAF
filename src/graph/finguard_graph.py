"""StateGraph FinGuard à 12 nœuds : agents (bleu) et contrôles déterministes (vert)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from src.agents.compliance_judge import ComplianceJudgeAgent
from src.agents.executor import ExecutorAgent
from src.agents.proposer import ProposerAgent
from src.agents.risk_judge import RiskJudgeAgent
from src.control.authorizations import AuthorizationRegistry
from src.control.exceptions import FinGuardError
from src.control.execution_gateway import ExecutionGateway
from src.control.firewall import AgentFirewall, RawExternalContent
from src.control.hitl import HumanSignatureVerifier, canonical_timestamp
from src.control.integrity import IntegrityEngine
from src.control.mandates import MandateRegistry, TrustEvent
from src.control.policy_config import PolicyConfig
from src.control.policy_engine import PolicyEngine
from src.control.quorum import WeightedQuorum
from src.control.risk_governor import RiskGovernor
from src.models.finguard_contracts import (
    Authorization,
    ExecutionOrder,
    ExecutionReport,
    ExecutionStatus,
    HumanAction,
    HumanDecision,
    JudgeVerdict,
    PolicyDecision,
    PolicyOutcome,
    QuorumDecision,
    TransactionIntent,
    UntrustedContent,
    Vote,
    compute_intent_hash,
)
from src.models.state import FinGuardState, RunStatus
from src.observability.audit_chain import AuditRecorder

JUDGES: tuple[str, ...] = ("risk_judge", "compliance_judge")
SIGNING_MESSAGE_FORMAT = "hitl|{thread_id}|{action}|{approver_id}|{intent_hash}|{timestamp}"


@dataclass
class GraphContext:
    """Composants injectés dans les nœuds d'un runtime."""

    runtime_id: str
    config: PolicyConfig
    recorder: AuditRecorder
    mandates: MandateRegistry
    firewall: AgentFirewall
    policy_engine: PolicyEngine
    quorum: WeightedQuorum
    authorizations: AuthorizationRegistry
    integrity: IntegrityEngine
    risk_governor: RiskGovernor
    gateway: ExecutionGateway
    verifier: HumanSignatureVerifier
    proposer: ProposerAgent
    risk_judge: RiskJudgeAgent
    compliance_judge: ComplianceJudgeAgent
    executor: ExecutorAgent


def pending_approval_payload(state: FinGuardState) -> dict[str, Any]:
    """Carte d'approbation (JSON) exposée au front ; fonction pure, rejouable à la reprise."""
    intent = TransactionIntent.model_validate(state["intent"])
    policy = state.get("policy") or {}
    quorum = state.get("quorum") or {}
    reasons = list(policy.get("triggered_rules", [])) + list(quorum.get("triggered_rules", []))
    return {
        "thread_id": state["request"]["thread_id"],
        "correlation_id": state["correlation_id"],
        "intent": state["intent"],
        "intent_hash": compute_intent_hash(intent),
        "policy": policy,
        "verdicts": state.get("verdicts", []),
        "quorum": quorum,
        "reasons": reasons,
        "allowed_actions": [a.value for a in HumanAction],
        "signing": {
            "algorithm": "HMAC-SHA256",
            "message_format": SIGNING_MESSAGE_FORMAT,
            "timestamp_format": "YYYY-MM-DDTHH:MM:SSZ (UTC, précision seconde)",
        },
    }


class FinGuardNodes:
    """Implémentation des nœuds ; chaque décision est journalisée (qui, quoi, quand, pourquoi, statut)."""

    def __init__(self, ctx: GraphContext) -> None:
        self.ctx = ctx

    # --- utilitaires -------------------------------------------------------------------------------

    def _audit(
        self,
        state: FinGuardState,
        agent_id: str,
        action: str,
        reasoning: str,
        status: str,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        mandates = self.ctx.mandates
        event = self.ctx.recorder.record(
            correlation_id=state["correlation_id"],
            agent_id=agent_id,
            action=action,
            reasoning=reasoning,
            status=status,
            policy_version=self.ctx.config.version,
            trust_score=mandates.get(agent_id).trust_score if mandates.has(agent_id) else None,
            context=context,
            runtime_id=self.ctx.runtime_id,
        )
        return event.model_dump(mode="json")

    def _trust(self, state: FinGuardState, agent_id: str, event: TrustEvent) -> list[dict[str, Any]]:
        if not self.ctx.mandates.has(agent_id):
            return []
        change = self.ctx.mandates.adjust_trust(agent_id, event)
        trail = [
            self._audit(
                state,
                "finguard.mandates",
                "trust_updated",
                f"trust de {agent_id} : {change.previous} → {change.current} ({event.value})",
                "updated",
                {
                    "agent_id": agent_id,
                    "event": event.value,
                    "previous": change.previous,
                    "current": change.current,
                    "quarantined_now": change.quarantined_now,
                },
            )
        ]
        if change.quarantined_now:
            trail.append(
                self._audit(
                    state,
                    "finguard.mandates",
                    "agent_quarantined",
                    f"{agent_id} en quarantaine : trust {change.current} sous le seuil",
                    "quarantined",
                    {"agent_id": agent_id},
                )
            )
        return trail

    def _block(self, reason: str, trail: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
        return {"status": RunStatus.BLOCKED.value, "reason": reason, "audit_trail": trail, **extra}

    @staticmethod
    def _untrusted(state: FinGuardState) -> list[UntrustedContent]:
        return [UntrustedContent.model_validate(c) for c in state.get("untrusted", [])]

    @staticmethod
    def _intent(state: FinGuardState) -> TransactionIntent:
        return TransactionIntent.model_validate(state["intent"])

    # --- nœuds -------------------------------------------------------------------------------------

    def firewall(self, state: FinGuardState) -> dict[str, Any]:
        raw = [
            RawExternalContent(source=str(item["source"]), content=str(item["content"]))
            for item in state["request"].get("external_content", []) or []
        ]
        inspected = self.ctx.firewall.inspect_all(raw)
        trail = [
            self._audit(
                state,
                "finguard.firewall",
                "content_flagged",
                f"contenu '{c.source}' encapsulé comme donnée non fiable : {', '.join(c.flags)}",
                "flagged",
                {"source": c.source, "flags": c.flags},
            )
            for c in inspected
            if c.flagged
        ]
        trail.append(
            self._audit(
                state,
                "finguard.firewall",
                "content_inspected",
                f"{len(inspected)} contenu(s) externe(s) encapsulé(s), {len(trail)} signalé(s)",
                "ok",
                {"sources": [c.source for c in inspected]},
            )
        )
        return {
            "untrusted": [c.model_dump(mode="json") for c in inspected],
            "status": RunStatus.PROCESSING.value,
            "audit_trail": trail,
        }

    def proposer(self, state: FinGuardState) -> dict[str, Any]:
        outcome = self.ctx.proposer.propose(
            correlation_id=state["correlation_id"], request=state["request"], untrusted=self._untrusted(state)
        )
        trail: list[dict[str, Any]] = []
        if outcome.fallback_reason:
            trail.append(self._audit(state, "proposer", "llm_fallback", outcome.fallback_reason, "fallback"))
        if outcome.intent is None:
            trail.append(self._audit(state, "proposer", "intent_not_produced", outcome.reason, "blocked"))
            return self._block(outcome.reason, trail, intent=None)
        intent_json = outcome.intent.model_dump(mode="json")
        trail.append(
            self._audit(
                state, "proposer", "intent_proposed", outcome.reason, "proposed", {"intent": intent_json}
            )
        )
        return {"intent": intent_json, "audit_trail": trail}

    def policy_engine(self, state: FinGuardState) -> dict[str, Any]:
        intent = self._intent(state)
        evaluation = self.ctx.policy_engine.evaluate(intent, self._untrusted(state))
        decision = evaluation.decision
        trail = [
            self._audit(
                state,
                "finguard.policy_engine",
                "policy_evaluated",
                f"{decision.outcome.value} : {decision.explanation}",
                decision.outcome.value.lower(),
                {"rules": decision.triggered_rules, "proposer_id": intent.proposer_id},
            )
        ]
        update: dict[str, Any] = {"policy": decision.model_dump(mode="json")}
        if decision.outcome is PolicyOutcome.BLOCK:
            if evaluation.blocked_out_of_mandate:
                trail += self._trust(state, intent.proposer_id, TrustEvent.BLOCKED_OUT_OF_MANDATE)
            if evaluation.injection_followed:
                trail += self._trust(state, intent.proposer_id, TrustEvent.INJECTION_FOLLOWED)
            return self._block(decision.explanation, trail, **update)
        return {**update, "audit_trail": trail}

    def _judge_update(
        self, state: FinGuardState, judge_id: str, verdict: JudgeVerdict, fallback: str | None
    ) -> dict[str, Any]:
        trail: list[dict[str, Any]] = []
        if fallback:
            trail.append(self._audit(state, judge_id, "llm_fallback", fallback, "fallback"))
        trail.append(
            self._audit(
                state,
                judge_id,
                "judge_verdict",
                f"{verdict.vote.value} : {verdict.justification}",
                verdict.vote.value,
                {"verdict": verdict.model_dump(mode="json"), "rules": verdict.rule_ids},
            )
        )
        return {"verdicts": [verdict.model_dump(mode="json")], "audit_trail": trail}

    def risk_judge(self, state: FinGuardState) -> dict[str, Any]:
        outcome = self.ctx.risk_judge.assess(self._intent(state))
        return self._judge_update(state, "risk_judge", outcome.verdict, outcome.fallback_reason)

    def compliance_judge(self, state: FinGuardState) -> dict[str, Any]:
        outcome = self.ctx.compliance_judge.assess(self._intent(state), self._untrusted(state))
        return self._judge_update(state, "compliance_judge", outcome.verdict, outcome.fallback_reason)

    def quorum(self, state: FinGuardState) -> dict[str, Any]:
        intent = self._intent(state)
        verdicts = [JudgeVerdict.model_validate(v) for v in state.get("verdicts", [])]
        trust = {j: self.ctx.mandates.get(j).trust_score for j in JUDGES if self.ctx.mandates.has(j)}
        policy = PolicyDecision.model_validate(state["policy"])
        decision = self.ctx.quorum.decide(intent, verdicts, trust, policy)
        trail = [
            self._audit(
                state,
                "finguard.quorum",
                "quorum_decided",
                decision.explanation,
                decision.outcome.value.lower(),
                {
                    "rules": decision.triggered_rules,
                    "approvals": decision.approvals,
                    "ratio": decision.weighted_ratio,
                },
            )
        ]
        update: dict[str, Any] = {"quorum": decision.model_dump(mode="json")}
        if decision.outcome is PolicyOutcome.ESCALATE:
            trail.append(
                self._audit(
                    state,
                    "finguard.hitl_gate",
                    "hitl_requested",
                    "validation humaine signée requise avant toute autorisation",
                    RunStatus.AWAITING_APPROVAL.value,
                    {"intent_hash": compute_intent_hash(intent), "rules": decision.triggered_rules},
                )
            )
            update["status"] = RunStatus.AWAITING_APPROVAL.value
        return {**update, "audit_trail": trail}

    def hitl_gate(self, state: FinGuardState) -> dict[str, Any]:
        payload = pending_approval_payload(state)
        raw = interrupt(payload)
        decision = HumanDecision.model_validate(raw)
        try:
            self.ctx.verifier.verify_approval(decision, payload["intent_hash"])
        except FinGuardError as exc:
            trail = [
                self._audit(
                    state,
                    "finguard.hitl_gate",
                    "human_decision",
                    exc.message,
                    "invalid",
                    {"rules": [exc.rule_id]},
                )
            ]
            return {"status": RunStatus.REJECTED.value, "reason": exc.message, "audit_trail": trail}

        context = {
            "approver_id": decision.approver_id,
            "action": decision.action.value,
            "signature_verified": True,
            "signed_at": canonical_timestamp(decision.timestamp),
            "comment": decision.comment,
        }
        reasoning = f"{decision.action.value} par {decision.approver_id} (signature HMAC vérifiée)"
        trail = [
            self._audit(
                state, "finguard.hitl_gate", "human_decision", reasoning, decision.action.value, context
            )
        ]
        update: dict[str, Any] = {"human_decision": decision.model_dump(mode="json"), "audit_trail": trail}
        if decision.action is HumanAction.APPROVE:
            return {**update, "status": RunStatus.PROCESSING.value}
        status = RunStatus.REJECTED if decision.action is HumanAction.REJECT else RunStatus.REPORTED
        return {**update, "status": status.value, "reason": f"décision humaine : {decision.action.value}"}

    def authorize(self, state: FinGuardState) -> dict[str, Any]:
        intent = self._intent(state)
        verdicts = [JudgeVerdict.model_validate(v) for v in state.get("verdicts", [])]
        approvers = [v.judge_id for v in verdicts if v.vote is Vote.APPROVE]
        human = state.get("human_decision")
        human_approved = bool(human and human.get("action") == HumanAction.APPROVE.value)
        if human_approved and human is not None:
            approvers.append(str(human["approver_id"]))
        authorization = self.ctx.authorizations.issue(intent, approvers, human_approved=human_approved)
        trail = [
            self._audit(
                state,
                "finguard.authorizations",
                "authorization_issued",
                f"autorisation {authorization.auth_id} liée au hash de l'intention, "
                f"expire à {authorization.expires_at:%H:%M:%S} UTC",
                "issued",
                {
                    "auth_id": authorization.auth_id,
                    "intent_hash": authorization.intent_hash,
                    "approvers": authorization.approvers,
                    "human_approved": human_approved,
                },
            )
        ]
        return {"authorization": authorization.model_dump(mode="json"), "audit_trail": trail}

    def executor(self, state: FinGuardState) -> dict[str, Any]:
        authorization = Authorization.model_validate(state["authorization"])
        order = self.ctx.executor.prepare(
            authorization, self._intent(state), state["request"].get("simulation")
        )
        order_json = order.model_dump(mode="json")
        trail = [
            self._audit(
                state,
                "executor",
                "order_prepared",
                f"ordre {order.order_id} préparé",
                "prepared",
                {"order": order_json},
            )
        ]
        return {"order": order_json, "audit_trail": trail}

    def integrity_check(self, state: FinGuardState) -> dict[str, Any]:
        order = ExecutionOrder.model_validate(state["order"])
        authorization = Authorization.model_validate(state["authorization"])
        result = self.ctx.integrity.check(order)
        trail = [
            self._audit(
                state,
                "finguard.integrity",
                "integrity_checked",
                result.reason,
                "ok" if result.ok else "blocked",
                {
                    "rules": result.rule_ids,
                    "tampering": result.tampering,
                    "order_hash": result.order_hash,
                    "intent_hash": authorization.intent_hash,
                    "executor_id": order.executor_id,
                },
            )
        ]
        if result.ok:
            return {"audit_trail": trail}
        self.ctx.authorizations.revoke(authorization.auth_id)
        if result.tampering:
            trail += self._trust(state, order.executor_id, TrustEvent.TAMPERING_AFTER_APPROVAL)
        report = ExecutionReport(
            order_id=order.order_id, status=ExecutionStatus.BLOCKED, reason=result.reason
        )
        return self._block(
            f"Integrity Engine : {result.reason} ({', '.join(result.rule_ids)})",
            trail,
            report=report.model_dump(mode="json"),
        )

    def risk_governor(self, state: FinGuardState) -> dict[str, Any]:
        order = ExecutionOrder.model_validate(state["order"])
        intent = self._intent(state)
        authorization = Authorization.model_validate(state["authorization"])
        result = self.ctx.risk_governor.check(
            order, proposer_id=intent.proposer_id, human_approved=authorization.human_approved
        )
        trail = [
            self._audit(
                state,
                "finguard.risk_governor",
                "risk_checked",
                result.reason,
                "ok" if result.ok else "blocked",
                {"rules": result.rule_ids},
            )
        ]
        if result.breaker_opened_now:
            trail.append(
                self._audit(
                    state,
                    "finguard.risk_governor",
                    "circuit_breaker_opened",
                    result.reason,
                    "open",
                    {"rules": result.rule_ids},
                )
            )
        if result.ok:
            return {"audit_trail": trail}
        self.ctx.authorizations.revoke(authorization.auth_id)
        report = ExecutionReport(
            order_id=order.order_id, status=ExecutionStatus.BLOCKED, reason=result.reason
        )
        return self._block(f"Risk Governor : {result.reason}", trail, report=report.model_dump(mode="json"))

    def execution_gateway(self, state: FinGuardState) -> dict[str, Any]:
        order = ExecutionOrder.model_validate(state["order"])
        intent = self._intent(state)
        try:
            report = self.ctx.gateway.execute(order, proposer_id=intent.proposer_id)
        except FinGuardError as exc:
            report = ExecutionReport(
                order_id=order.order_id, status=ExecutionStatus.BLOCKED, reason=exc.message
            )
            trail = [
                self._audit(
                    state,
                    "finguard.execution_gateway",
                    "execution_blocked",
                    exc.message,
                    "blocked",
                    {"rules": [exc.rule_id]},
                )
            ]
            return self._block(f"Passerelle : {exc.message}", trail, report=report.model_dump(mode="json"))

        if report.status is not ExecutionStatus.FILLED:
            reason = report.reason or "refus du marché"
            trail = [self._audit(state, "finguard.execution_gateway", "execution_blocked", reason, "blocked")]
            return self._block(reason, trail, report=report.model_dump(mode="json"))

        trail = [
            self._audit(
                state,
                "finguard.execution_gateway",
                "order_executed",
                f"{order.side.value} {order.amount} € de {order.asset} exécuté au prix {report.fill_price}",
                "filled",
                {"order_id": order.order_id, "auth_id": order.auth_id},
            )
        ]
        trail += self._trust(state, intent.proposer_id, TrustEvent.COMPLIANT_ACTION)
        trail += self._trust(state, order.executor_id, TrustEvent.COMPLIANT_ACTION)
        return {
            "report": report.model_dump(mode="json"),
            "status": RunStatus.EXECUTED.value,
            "reason": None,
            "audit_trail": trail,
        }


def _continue_or_end(next_node: str) -> Any:
    def route(state: FinGuardState) -> str:
        return (
            END
            if state.get("status") in (RunStatus.BLOCKED, RunStatus.REJECTED, RunStatus.REPORTED)
            else next_node
        )

    return route


def _after_policy(state: FinGuardState) -> list[str] | str:
    if state.get("status") == RunStatus.BLOCKED:
        return END
    return list(JUDGES)


def _after_quorum(state: FinGuardState) -> Literal["hitl_gate", "authorize"]:
    quorum = QuorumDecision.model_validate(state["quorum"])
    return "hitl_gate" if quorum.outcome is PolicyOutcome.ESCALATE else "authorize"


def build_finguard_graph(
    ctx: GraphContext, checkpointer: BaseCheckpointSaver[Any]
) -> CompiledStateGraph[Any, Any, Any, Any]:
    """Assemble et compile le graphe ; le checkpointer est requis pour `interrupt()`."""
    nodes = FinGuardNodes(ctx)
    graph = StateGraph(FinGuardState)
    graph.add_node("firewall", nodes.firewall)
    graph.add_node("proposer", nodes.proposer)
    graph.add_node("policy_engine", nodes.policy_engine)
    graph.add_node("risk_judge", nodes.risk_judge)
    graph.add_node("compliance_judge", nodes.compliance_judge)
    graph.add_node("quorum", nodes.quorum)
    graph.add_node("hitl_gate", nodes.hitl_gate)
    graph.add_node("authorize", nodes.authorize)
    graph.add_node("executor", nodes.executor)
    graph.add_node("integrity_check", nodes.integrity_check)
    graph.add_node("risk_governor", nodes.risk_governor)
    graph.add_node("execution_gateway", nodes.execution_gateway)

    graph.add_edge(START, "firewall")
    graph.add_edge("firewall", "proposer")
    graph.add_conditional_edges("proposer", _continue_or_end("policy_engine"), ["policy_engine", END])
    graph.add_conditional_edges("policy_engine", _after_policy, [*JUDGES, END])
    graph.add_edge(list(JUDGES), "quorum")
    graph.add_conditional_edges("quorum", _after_quorum, ["hitl_gate", "authorize"])
    graph.add_conditional_edges("hitl_gate", _continue_or_end("authorize"), ["authorize", END])
    graph.add_edge("authorize", "executor")
    graph.add_edge("executor", "integrity_check")
    graph.add_conditional_edges("integrity_check", _continue_or_end("risk_governor"), ["risk_governor", END])
    graph.add_conditional_edges(
        "risk_governor", _continue_or_end("execution_gateway"), ["execution_gateway", END]
    )
    graph.add_edge("execution_gateway", END)
    return graph.compile(checkpointer=checkpointer)
