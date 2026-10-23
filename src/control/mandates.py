"""Mandats et Trust Score : plafonds effectifs, réputation et quarantaine."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from src.control.exceptions import ConflictError, GovernanceViolationError, NotFoundError
from src.control.policy_config import TrustConfig
from src.models.finguard_contracts import AgentMandate


class TrustEvent(StrEnum):
    """Événements qui font varier le Trust Score (CADRAGE §4)."""

    COMPLIANT_ACTION = "compliant_action"
    BLOCKED_OUT_OF_MANDATE = "blocked_out_of_mandate"
    INJECTION_FOLLOWED = "injection_followed"
    TAMPERING_AFTER_APPROVAL = "tampering_after_approval"


@dataclass(frozen=True)
class TrustChange:
    """Variation de confiance appliquée à un agent, à journaliser par l'appelant."""

    agent_id: str
    event: TrustEvent
    previous: int
    current: int
    quarantined_now: bool


class MandateRegistry:
    """Registre en mémoire des mandats ; seul un humain lève une quarantaine."""

    def __init__(self, mandates: list[AgentMandate], trust: TrustConfig) -> None:
        self._trust = trust
        self._lock = threading.RLock()
        self._mandates: dict[str, AgentMandate] = {m.agent_id: m for m in mandates}

    def get(self, agent_id: str) -> AgentMandate:
        """Mandat déclaré courant (trust et quarantaine inclus)."""
        with self._lock:
            mandate = self._mandates.get(agent_id)
        if mandate is None:
            raise NotFoundError(f"Aucun mandat pour l'agent '{agent_id}'", rule_id="MANDATE_UNKNOWN")
        return mandate

    def has(self, agent_id: str) -> bool:
        """Indique si l'agent a déclaré un mandat."""
        with self._lock:
            return agent_id in self._mandates

    def all(self) -> list[AgentMandate]:
        """Tous les mandats, triés par identifiant."""
        with self._lock:
            return [self._mandates[k] for k in sorted(self._mandates)]

    def effective(self, agent_id: str) -> AgentMandate:
        """Mandat effectif : plafond divisé par deux sous le seuil de confiance."""
        mandate = self.get(agent_id)
        if mandate.trust_score < self._trust.halve_limit_below:
            return mandate.model_copy(update={"max_amount": mandate.max_amount / Decimal(2)})
        return mandate

    def limit_factor(self, agent_id: str) -> Decimal:
        """Facteur appliqué aux plafonds de l'agent (1 ou 1/2)."""
        mandate = self.get(agent_id)
        return Decimal("0.5") if mandate.trust_score < self._trust.halve_limit_below else Decimal(1)

    def adjust_trust(self, agent_id: str, event: TrustEvent) -> TrustChange:
        """Applique la variation prévue ; met en quarantaine sous le seuil bas."""
        delta = getattr(self._trust.deltas, event.value)
        with self._lock:
            mandate = self.get(agent_id)
            current = max(0, min(self._trust.ceiling, mandate.trust_score + delta))
            quarantine = current < self._trust.quarantine_below
            quarantined_now = quarantine and not mandate.quarantined
            self._mandates[agent_id] = mandate.model_copy(
                update={"trust_score": current, "quarantined": mandate.quarantined or quarantine}
            )
        return TrustChange(agent_id, event, mandate.trust_score, current, quarantined_now)

    def quarantine(self, agent_id: str) -> bool:
        """Met l'agent en quarantaine (lecture seule) ; retourne False s'il l'était déjà."""
        with self._lock:
            mandate = self.get(agent_id)
            if mandate.quarantined:
                return False
            self._mandates[agent_id] = mandate.model_copy(update={"quarantined": True})
            return True

    def release_quarantine(self, agent_id: str, *, released_by: str, is_human: bool) -> AgentMandate:
        """Lève la quarantaine ; la confiance est remontée au seuil de quarantaine au minimum."""
        if not is_human:
            raise GovernanceViolationError(
                f"'{released_by}' ne peut pas lever une quarantaine : action réservée à un humain",
                rule_id="QUARANTINE_HUMAN_ONLY",
            )
        with self._lock:
            mandate = self.get(agent_id)
            if not mandate.quarantined:
                raise ConflictError(
                    f"L'agent '{agent_id}' n'est pas en quarantaine", rule_id="QUARANTINE_NOT_ACTIVE"
                )
            released = mandate.model_copy(
                update={
                    "quarantined": False,
                    "trust_score": max(mandate.trust_score, self._trust.quarantine_below),
                }
            )
            self._mandates[agent_id] = released
        return released
