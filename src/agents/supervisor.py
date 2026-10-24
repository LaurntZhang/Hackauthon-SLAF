"""Superviseur méta-agent : lit le bus, alerte, demande une quarantaine ; ne vote ni n'exécute."""

from __future__ import annotations

import uuid
from typing import Any

from src.control.exceptions import GovernanceViolationError
from src.control.kill_switch import KillSwitch
from src.control.mandates import MandateRegistry
from src.models.finguard_contracts import Alert, AlertSeverity, AuditEvent, KillRequest, KillScope
from src.observability.audit_chain import AuditRecorder

AGENT_ID = "supervisor"
IGNORED_ACTIONS = frozenset({"alert", "kill_request", "kill_request_denied", "agent_quarantined"})


class SupervisorAgent:
    """Abonné synchrone du bus, limité aux événements de son runtime."""

    def __init__(
        self,
        *,
        runtime_id: str,
        recorder: AuditRecorder,
        kill_switch: KillSwitch,
        mandates: MandateRegistry,
        policy_version: str,
    ) -> None:
        self._runtime_id = runtime_id
        self._recorder = recorder
        self._kill_switch = kill_switch
        self._mandates = mandates
        self._policy_version = policy_version
        self.alerts: list[Alert] = []

    def __call__(self, event: AuditEvent) -> None:
        if (
            event.runtime_id != self._runtime_id
            or event.agent_id == AGENT_ID
            or event.action in IGNORED_ACTIONS
        ):
            return
        rules = event.context.get("rules", []) or []
        if event.action == "policy_evaluated" and "INJECTION_FOLLOWED" in rules:
            target = str(event.context.get("proposer_id") or "proposer")
            self._alert(
                event,
                AlertSeverity.CRITICAL,
                f"injection suivie par '{target}' : demande de quarantaine",
                target,
            )
            self._request_quarantine(event, target, "injection suivie : outil interdit demandé")
        elif event.action == "circuit_breaker_opened":
            self._alert(event, AlertSeverity.CRITICAL, f"circuit breaker ouvert : {event.reasoning}", None)
        elif (
            event.action == "integrity_checked"
            and event.status == "blocked"
            and event.context.get("tampering")
        ):
            self._alert(
                event,
                AlertSeverity.CRITICAL,
                "ordre modifié après approbation",
                event.context.get("executor_id"),
            )
        elif event.action == "content_flagged":
            self._alert(
                event, AlertSeverity.WARNING, f"contenu externe suspect ({event.context.get('source')})", None
            )
        elif event.action == "trust_updated" and event.context.get("quarantined_now"):
            agent = event.context.get("agent_id")
            self._alert(
                event, AlertSeverity.CRITICAL, f"'{agent}' passe en quarantaine (trust < seuil)", agent
            )

    def _alert(self, event: AuditEvent, severity: AlertSeverity, message: str, agent: Any) -> None:
        alert = Alert(
            alert_id=f"alr-{uuid.uuid4().hex[:10]}",
            raised_by=AGENT_ID,
            severity=severity,
            message=message,
            correlation_id=event.correlation_id,
            related_agent_id=str(agent) if agent else None,
        )
        self.alerts.append(alert)
        self._record(
            event.correlation_id, "alert", message, severity.value, {"alert": alert.model_dump(mode="json")}
        )

    def _request_quarantine(self, event: AuditEvent, target: str, reason: str) -> None:
        request = KillRequest(
            request_id=f"kreq-{uuid.uuid4().hex[:10]}",
            requested_by=AGENT_ID,
            scope=KillScope.AGENT,
            target_agent_id=target,
            reason=reason,
            correlation_id=event.correlation_id,
        )
        self._record(
            event.correlation_id,
            "kill_request",
            reason,
            "requested",
            {"kill_request": request.model_dump(mode="json")},
        )
        try:
            applied = self._kill_switch.handle_kill_request(request, self._mandates)
        except GovernanceViolationError as exc:
            self._record(
                event.correlation_id, "kill_request_denied", exc.message, "denied", {"rules": [exc.rule_id]}
            )
            return
        if applied:
            self._record(
                event.correlation_id,
                "agent_quarantined",
                f"'{target}' mis en quarantaine (lecture seule) sur demande du superviseur ; "
                "levée réservée à un humain",
                "quarantined",
                {"agent_id": target, "requested_by": AGENT_ID},
            )

    def _record(
        self, correlation_id: str, action: str, reasoning: str, status: str, context: dict[str, Any]
    ) -> None:
        self._recorder.record(
            correlation_id=correlation_id,
            agent_id=AGENT_ID,
            action=action,
            reasoning=reasoning,
            status=status,
            policy_version=self._policy_version,
            trust_score=self._mandates.get(AGENT_ID).trust_score if self._mandates.has(AGENT_ID) else None,
            context=context,
            runtime_id=self._runtime_id,
        )
