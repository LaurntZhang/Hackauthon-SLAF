"""Export optionnel des `AuditEvent` vers Langfuse ; une panne ne bloque jamais le graphe."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from typing import Any, Protocol

from src.models.finguard_contracts import AuditEvent

logger = logging.getLogger(__name__)


class LangfuseClient(Protocol):
    """Sous-ensemble du client Langfuse utilisé."""

    def create_event(self, **kwargs: Any) -> Any:
        """Crée un événement de trace."""
        ...


DegradedCallback = Callable[[str], None]


class LangfuseExporter:
    """Abonné du bus ; se désactive à la première panne et le signale explicitement."""

    def __init__(self, client: LangfuseClient, on_degraded: DegradedCallback | None = None) -> None:
        self._client = client
        self._on_degraded = on_degraded
        self.enabled = True
        self.last_error: str | None = None

    def __call__(self, event: AuditEvent) -> None:
        if not self.enabled or event.action == "observability_degraded":
            return
        try:
            self._client.create_event(
                name=f"finguard.{event.action}",
                metadata={
                    "correlation_id": event.correlation_id,
                    "agent_id": event.agent_id,
                    "status": event.status,
                    "policy_version": event.policy_version,
                    "trust_score": event.trust_score,
                    "hash": event.hash,
                },
            )
        except Exception as exc:  # noqa: BLE001 - dépendance optionnelle : repli explicite et journalisé
            self.enabled = False
            self.last_error = type(exc).__name__
            logger.warning(
                "Export Langfuse désactivé après une erreur",
                extra={"action": "langfuse_degraded", "details": {"error": self.last_error}},
            )
            if self._on_degraded is not None:
                self._on_degraded(self.last_error)


def build_langfuse_client() -> LangfuseClient | None:
    """Client Langfuse si les clés et le paquet sont présents, sinon None (mode hors ligne)."""
    if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
        return None
    try:
        from langfuse import get_client
    except ImportError:
        logger.info("Paquet langfuse absent : export désactivé", extra={"action": "langfuse_disabled"})
        return None
    client: LangfuseClient = get_client()
    return client
