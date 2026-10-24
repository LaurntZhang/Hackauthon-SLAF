"""Kill switch : arrêt global (humain seul) ou par agent ; le superviseur ne demande qu'une quarantaine."""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime

from src.control.exceptions import ConflictError, GovernanceViolationError, KillSwitchActiveError
from src.control.mandates import MandateRegistry
from src.models.finguard_contracts import KillRequest, KillScope, utc_now

Clock = Callable[[], datetime]


@dataclass(frozen=True)
class StopRecord:
    """Trace d'un arrêt actif."""

    actor_id: str
    reason: str
    engaged_at: datetime


@dataclass(frozen=True)
class KillSwitchSnapshot:
    """État courant du kill switch."""

    global_engaged: bool
    global_stop: StopRecord | None
    stopped_agents: dict[str, StopRecord]


class KillSwitch:
    """État d'arrêt partagé par tous les runtimes ; toute commande est journalisée par l'appelant."""

    def __init__(self, clock: Clock = utc_now) -> None:
        self._clock = clock
        self._lock = threading.RLock()
        self._global: StopRecord | None = None
        self._agents: dict[str, StopRecord] = {}

    def engage(
        self, *, scope: KillScope, actor_id: str, is_human: bool, reason: str, agent_id: str | None
    ) -> None:
        """Engage un arrêt ; seul un humain peut couper globalement."""
        if scope is KillScope.GLOBAL and not is_human:
            raise GovernanceViolationError(
                "Seul un humain peut déclencher le kill switch global", rule_id="KILL_GLOBAL_HUMAN_ONLY"
            )
        record = StopRecord(actor_id=actor_id, reason=reason, engaged_at=self._clock())
        with self._lock:
            if scope is KillScope.GLOBAL:
                self._global = record
            else:
                self._agents[self._require_agent(agent_id)] = record

    def release(self, *, scope: KillScope, actor_id: str, is_human: bool, agent_id: str | None) -> None:
        """Lève un arrêt ; action réservée à un humain."""
        if not is_human:
            raise GovernanceViolationError(
                f"'{actor_id}' ne peut pas lever un arrêt : action réservée à un humain",
                rule_id="KILL_RELEASE_HUMAN_ONLY",
            )
        with self._lock:
            if scope is KillScope.GLOBAL:
                if self._global is None:
                    raise ConflictError("Le kill switch global n'est pas engagé", rule_id="KILL_NOT_ENGAGED")
                self._global = None
                return
            target = self._require_agent(agent_id)
            if target not in self._agents:
                raise ConflictError(f"Aucun arrêt actif pour '{target}'", rule_id="KILL_NOT_ENGAGED")
            del self._agents[target]

    def handle_kill_request(self, request: KillRequest, mandates: MandateRegistry) -> bool:
        """Traite une `KillRequest` du superviseur : quarantaine d'agent uniquement."""
        if request.scope is not KillScope.AGENT:
            raise GovernanceViolationError(
                "Le superviseur ne peut demander qu'une quarantaine d'agent", rule_id="KILL_GLOBAL_HUMAN_ONLY"
            )
        return mandates.quarantine(self._require_agent(request.target_agent_id))

    def require_clear(self, agent_ids: Iterable[str]) -> None:
        """Lève `KillSwitchActiveError` si un arrêt concerne l'exécution."""
        with self._lock:
            if self._global is not None:
                raise KillSwitchActiveError(
                    f"Kill switch global engagé par {self._global.actor_id}", rule_id="KILL_SWITCH_GLOBAL"
                )
            stopped = [a for a in agent_ids if a in self._agents]
        if stopped:
            raise KillSwitchActiveError(
                f"Agent(s) arrêté(s) : {', '.join(stopped)}", rule_id="KILL_SWITCH_AGENT"
            )

    def snapshot(self) -> KillSwitchSnapshot:
        """Copie de l'état courant."""
        with self._lock:
            return KillSwitchSnapshot(self._global is not None, self._global, dict(self._agents))

    @staticmethod
    def _require_agent(agent_id: str | None) -> str:
        if not agent_id:
            raise GovernanceViolationError(
                "agent_id requis pour un arrêt ciblé", rule_id="KILL_AGENT_REQUIRED"
            )
        return agent_id
