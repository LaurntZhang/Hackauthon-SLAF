"""Kill switch, circuit breaker, quarantaines et état de la tour de contrôle (humains uniquement)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from src.api.dependencies import SystemDep, record_control
from src.api.errors import ERROR_RESPONSES
from src.control.exceptions import GovernanceViolationError, InvalidSignatureError
from src.control.kill_switch import KillSwitch, StopRecord
from src.graph.graph_runtime import MAIN_RUNTIME_ID, GraphRuntime
from src.models.api_models import (
    CircuitBreakerState,
    ControlsState,
    KillSwitchRequest,
    KillSwitchState,
    SignedControlRequest,
    StopInfo,
)
from src.models.finguard_contracts import AgentMandate

router = APIRouter(tags=["controls"], responses=ERROR_RESPONSES)


def _stop(record: StopRecord) -> StopInfo:
    return StopInfo(actor_id=record.actor_id, reason=record.reason, engaged_at=record.engaged_at)


def kill_switch_state(kill_switch: KillSwitch) -> KillSwitchState:
    """Vue API du kill switch."""
    snap = kill_switch.snapshot()
    return KillSwitchState(
        global_engaged=snap.global_engaged,
        global_stop=_stop(snap.global_stop) if snap.global_stop else None,
        stopped_agents={agent: _stop(rec) for agent, rec in snap.stopped_agents.items()},
    )


def breaker_state(runtime: GraphRuntime) -> CircuitBreakerState:
    """Vue API du circuit breaker d'un runtime."""
    state = runtime.risk_governor.state()
    return CircuitBreakerState(
        runtime_id=runtime.runtime_id,
        open=state.open,
        reason=state.reason,
        opened_at=state.opened_at,
        consecutive_rejections=state.consecutive_rejections,
        orders_last_minute=state.orders_last_minute,
    )


def _verify_signed(runtime: GraphRuntime, body: SignedControlRequest, command: str, target: str) -> None:
    try:
        runtime.verifier.verify_control(
            command=command,
            target=target,
            operator_id=body.operator_id,
            timestamp=body.timestamp,
            signature=body.signature,
        )
    except GovernanceViolationError as exc:
        record_control(
            runtime,
            actor_id=body.operator_id,
            action="control_denied",
            reasoning=f"{command} refusé : {exc.message}",
            status="denied",
            context={"command": command, "target": target, "rules": [exc.rule_id]},
        )
        raise


@router.get("/kill-switch", response_model=KillSwitchState)
def get_kill_switch(system: SystemDep) -> KillSwitchState:
    """État du kill switch (partagé par tous les runtimes)."""
    return kill_switch_state(system.shared.kill_switch)


@router.post("/kill-switch", response_model=KillSwitchState)
def operate_kill_switch(body: KillSwitchRequest, system: SystemDep) -> KillSwitchState:
    """Arrêt immédiat par un opérateur habilité ; le réarmement exige une signature HMAC."""
    runtime = system.main
    operators = runtime.config.hitl.operators
    target = f"{body.scope.value}:{body.agent_id or '*'}"
    if body.operator_id not in operators:
        raise GovernanceViolationError(
            f"'{body.operator_id}' n'est pas un opérateur habilité", rule_id="CONTROL_UNKNOWN_OPERATOR"
        )

    if body.action == "engage":
        system.shared.kill_switch.engage(
            scope=body.scope,
            actor_id=body.operator_id,
            is_human=True,
            reason=body.reason,
            agent_id=body.agent_id,
        )
        record_control(
            runtime,
            actor_id=body.operator_id,
            action="kill_switch_engaged",
            reasoning=body.reason,
            status="engaged",
            context={"scope": body.scope.value, "agent_id": body.agent_id},
        )
        return kill_switch_state(system.shared.kill_switch)

    if body.signature is None or body.timestamp is None:
        raise InvalidSignatureError(
            "Le réarmement exige signature et timestamp", rule_id="CONTROL_SIGNATURE_REQUIRED"
        )
    signed = SignedControlRequest(
        operator_id=body.operator_id, signature=body.signature, timestamp=body.timestamp, reason=body.reason
    )
    _verify_signed(runtime, signed, "kill_switch.release", target)
    system.shared.kill_switch.release(
        scope=body.scope, actor_id=body.operator_id, is_human=True, agent_id=body.agent_id
    )
    record_control(
        runtime,
        actor_id=body.operator_id,
        action="kill_switch_released",
        reasoning=body.reason,
        status="released",
        context={"scope": body.scope.value, "agent_id": body.agent_id, "signature_verified": True},
    )
    return kill_switch_state(system.shared.kill_switch)


@router.post("/controls/circuit-breaker/rearm", response_model=CircuitBreakerState)
def rearm_circuit_breaker(body: SignedControlRequest, system: SystemDep) -> CircuitBreakerState:
    """Réarme le circuit breaker d'un runtime (signature `circuit_breaker.rearm`, cible runtime_id)."""
    runtime = system.runtime(body.runtime_id)
    _verify_signed(runtime, body, "circuit_breaker.rearm", runtime.runtime_id)
    runtime.risk_governor.rearm(actor_id=body.operator_id, is_human=True)
    record_control(
        runtime,
        actor_id=body.operator_id,
        action="circuit_breaker_rearmed",
        reasoning=body.reason,
        status="closed",
        context={"signature_verified": True},
    )
    return breaker_state(runtime)


@router.post("/controls/quarantine/{agent_id}/release", response_model=AgentMandate)
def release_quarantine(agent_id: str, body: SignedControlRequest, system: SystemDep) -> AgentMandate:
    """Lève la quarantaine d'un agent (signature `quarantine.release`, cible agent_id)."""
    runtime = system.runtime(body.runtime_id)
    _verify_signed(runtime, body, "quarantine.release", agent_id)
    mandate = runtime.mandates.release_quarantine(agent_id, released_by=body.operator_id, is_human=True)
    record_control(
        runtime,
        actor_id=body.operator_id,
        action="quarantine_released",
        reasoning=body.reason,
        status="released",
        context={"agent_id": agent_id, "trust_score": mandate.trust_score, "signature_verified": True},
    )
    return mandate


@router.get("/controls/state", response_model=ControlsState)
def controls_state(system: SystemDep, runtime_id: str = Query(default=MAIN_RUNTIME_ID)) -> ControlsState:
    """Kill switch, circuit breaker, mandats et trust scores d'un runtime."""
    runtime = system.runtime(runtime_id)
    return ControlsState(
        policy_version=runtime.config.version,
        kill_switch=kill_switch_state(system.shared.kill_switch),
        circuit_breaker=breaker_state(runtime),
        agents=runtime.mandates.all(),
        llm_mode="on" if runtime.llm_enabled else "off",
        demo_secret_in_use=runtime.verifier.uses_demo_secret,
    )


@router.get("/agents", response_model=list[AgentMandate])
def list_agents(system: SystemDep, runtime_id: str = Query(default=MAIN_RUNTIME_ID)) -> list[AgentMandate]:
    """Mandats effectifs déclarés (trust score et quarantaine inclus)."""
    return system.runtime(runtime_id).mandates.all()
