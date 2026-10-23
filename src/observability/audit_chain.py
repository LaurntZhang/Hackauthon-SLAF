"""Journal d'audit chaîné (JSONL) : chaque ligne porte `prev_hash` et `hash`, voir `verify_chain()`."""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from src.control.firewall import redact_sensitive
from src.models.finguard_contracts import AuditEvent, utc_now
from src.observability.event_bus import EventBus

logger = logging.getLogger(__name__)

GENESIS_HASH = "0" * 64
REDACTED = "[REDACTED]"
SENSITIVE_KEYS = frozenset(
    {"signature", "secret", "api_key", "apikey", "token", "password", "prompt", "iban"}
)


def sanitize(value: Any) -> Any:
    """Masque les clés sensibles et les IBAN avant toute écriture d'audit ou de log."""
    if isinstance(value, dict):
        return {k: REDACTED if str(k).lower() in SENSITIVE_KEYS else sanitize(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [sanitize(v) for v in value]
    if isinstance(value, str):
        return redact_sensitive(value)
    return value


def compute_event_hash(payload_without_hash: dict[str, Any]) -> str:
    """SHA-256 du JSON canonique d'une ligne, champ `hash` exclu."""
    canonical = json.dumps(payload_without_hash, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ChainVerification:
    """Résultat de `verify_chain()` ; `first_invalid_line` est 1-indexée."""

    valid: bool
    checked_lines: int
    first_invalid_line: int | None
    error: str | None
    last_hash: str


def verify_chain(path: Path) -> ChainVerification:
    """Recalcule chaque hash et vérifie le chaînage ; s'arrête à la première ligne fautive."""
    if not path.exists():
        return ChainVerification(True, 0, None, None, GENESIS_HASH)
    previous = GENESIS_HASH
    count = 0
    with path.open(encoding="utf-8") as handle:
        for number, raw in enumerate(handle, start=1):
            line = raw.strip()
            if not line:
                continue
            count += 1
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                return ChainVerification(False, count, number, "ligne JSON illisible", previous)
            if not isinstance(record, dict) or "hash" not in record:
                return ChainVerification(False, count, number, "champ hash absent", previous)
            stored_hash = record.pop("hash")
            if record.get("prev_hash") != previous:
                return ChainVerification(
                    False, count, number, "prev_hash ne correspond pas à la ligne précédente", previous
                )
            if compute_event_hash(record) != stored_hash:
                return ChainVerification(
                    False, count, number, "contenu modifié : hash recalculé différent", previous
                )
            previous = stored_hash
    return ChainVerification(True, count, None, None, previous)


class AuditChain:
    """Journal en insertion seule ; source de vérité indépendante de Langfuse."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._events: list[AuditEvent] = []
        self._last_hash = GENESIS_HASH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._load_existing()

    def append(
        self,
        *,
        correlation_id: str,
        agent_id: str,
        action: str,
        reasoning: str,
        status: str,
        policy_version: str,
        trust_score: int | None = None,
        context: dict[str, Any] | None = None,
        runtime_id: str | None = None,
    ) -> AuditEvent:
        """Ajoute une ligne chaînée ; une erreur d'écriture remonte (fail closed)."""
        with self._lock:
            payload: dict[str, Any] = {
                "timestamp": utc_now().isoformat(),
                "correlation_id": correlation_id,
                "agent_id": agent_id,
                "action": action,
                "reasoning": redact_sensitive(reasoning),
                "status": status,
                "policy_version": policy_version,
                "trust_score": trust_score,
                "context": sanitize(context or {}),
                "prev_hash": self._last_hash,
                "runtime_id": runtime_id,
                "sequence": len(self._events) + 1,
            }
            payload = json.loads(json.dumps(payload, default=str))
            payload["hash"] = compute_event_hash(payload)
            event = AuditEvent.model_validate(payload)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
            self._events.append(event)
            self._last_hash = event.hash
            return event

    def events(self, correlation_id: str | None = None) -> list[AuditEvent]:
        """Événements en mémoire, filtrés par corrélation si demandé."""
        with self._lock:
            if correlation_id is None:
                return list(self._events)
            return [e for e in self._events if e.correlation_id == correlation_id]

    def verify(self) -> ChainVerification:
        """Vérifie le fichier sur disque (et non la copie mémoire)."""
        with self._lock:
            return verify_chain(self.path)

    def _load_existing(self) -> None:
        if not self.path.exists():
            return
        with self.path.open(encoding="utf-8") as handle:
            for raw in handle:
                line = raw.strip()
                if not line:
                    continue
                try:
                    event = AuditEvent.model_validate_json(line)
                except ValidationError:
                    logger.warning(
                        "Ligne d'audit illisible au chargement", extra={"action": "audit_load_skip"}
                    )
                    continue
                self._events.append(event)
                self._last_hash = event.hash


class AuditRecorder:
    """Écrit dans le journal chaîné puis publie sur le bus."""

    def __init__(self, chain: AuditChain, bus: EventBus) -> None:
        self.chain = chain
        self.bus = bus

    def record(
        self,
        *,
        correlation_id: str,
        agent_id: str,
        action: str,
        reasoning: str,
        status: str,
        policy_version: str,
        trust_score: int | None = None,
        context: dict[str, Any] | None = None,
        runtime_id: str | None = None,
    ) -> AuditEvent:
        """Journalise qui, quoi, quand, pourquoi et statut, puis diffuse l'événement."""
        event = self.chain.append(
            correlation_id=correlation_id,
            agent_id=agent_id,
            action=action,
            reasoning=reasoning,
            status=status,
            policy_version=policy_version,
            trust_score=trust_score,
            context=context,
            runtime_id=runtime_id,
        )
        self.bus.publish(event)
        return event
