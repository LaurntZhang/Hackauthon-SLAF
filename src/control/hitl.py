"""Signatures HMAC des décisions humaines (HITL) et des commandes d'opérateur."""

from __future__ import annotations

import hashlib
import hmac
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from src.control.exceptions import GovernanceViolationError, InvalidSignatureError
from src.control.policy_config import HitlConfig
from src.models.finguard_contracts import HumanAction, HumanDecision, utc_now

Clock = Callable[[], datetime]
DEMO_SECRET = "managent-demo-secret-not-for-production"  # noqa: S105


def canonical_timestamp(value: datetime) -> str:
    """Horodatage signé : UTC, précision seconde, suffixe Z (ex. 2026-10-23T20:15:00Z)."""
    if value.tzinfo is None:
        raise InvalidSignatureError("Horodatage sans fuseau horaire", rule_id="SIGNATURE_NAIVE_TIMESTAMP")
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def approval_message(
    *, thread_id: str, action: HumanAction | str, approver_id: str, intent_hash: str, timestamp: datetime
) -> str:
    """Message signé d'une décision HITL ; il lie la signature au hash exact de l'intention."""
    return "|".join(
        ["hitl", thread_id, str(action), approver_id, intent_hash, canonical_timestamp(timestamp)]
    )


def control_message(*, command: str, target: str, operator_id: str, timestamp: datetime) -> str:
    """Message signé d'une commande d'opérateur (réarmement, levée de quarantaine, kill switch)."""
    return "|".join(["control", command, target, operator_id, canonical_timestamp(timestamp)])


def sign(secret: str, message: str) -> str:
    """Signature HMAC-SHA256 hexadécimale."""
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


class HumanSignatureVerifier:
    """Vérifie l'identité déclarée, la fraîcheur et la signature HMAC."""

    def __init__(self, config: HitlConfig, secret: str, clock: Clock = utc_now) -> None:
        self._config = config
        self._secret = secret
        self._clock = clock

    @property
    def uses_demo_secret(self) -> bool:
        """Vrai si le secret de démonstration est utilisé."""
        return self._secret == DEMO_SECRET

    def verify_approval(self, decision: HumanDecision, intent_hash: str) -> None:
        """Lève une erreur typée si la décision HITL n'est pas recevable."""
        if decision.approver_id not in self._config.approvers:
            raise GovernanceViolationError(
                f"'{decision.approver_id}' n'est pas un approbateur habilité", rule_id="HITL_UNKNOWN_APPROVER"
            )
        self._check_fresh(decision.timestamp)
        expected = sign(
            self._secret,
            approval_message(
                thread_id=decision.thread_id,
                action=decision.action,
                approver_id=decision.approver_id,
                intent_hash=intent_hash,
                timestamp=decision.timestamp,
            ),
        )
        if not hmac.compare_digest(expected, decision.signature):
            raise InvalidSignatureError(
                "Signature HITL invalide pour cette intention", rule_id="HITL_BAD_SIGNATURE"
            )

    def verify_control(
        self, *, command: str, target: str, operator_id: str, timestamp: datetime, signature: str
    ) -> None:
        """Vérifie une commande d'opérateur humain signée."""
        if operator_id not in self._config.operators:
            raise GovernanceViolationError(
                f"'{operator_id}' n'est pas un opérateur habilité", rule_id="CONTROL_UNKNOWN_OPERATOR"
            )
        self._check_fresh(timestamp)
        expected = sign(
            self._secret,
            control_message(command=command, target=target, operator_id=operator_id, timestamp=timestamp),
        )
        if not hmac.compare_digest(expected, signature):
            raise InvalidSignatureError("Signature d'opérateur invalide", rule_id="CONTROL_BAD_SIGNATURE")

    def _check_fresh(self, timestamp: datetime) -> None:
        if timestamp.tzinfo is None:
            raise InvalidSignatureError("Horodatage sans fuseau horaire", rule_id="SIGNATURE_NAIVE_TIMESTAMP")
        age = self._clock() - timestamp
        max_age = timedelta(seconds=self._config.max_signature_age_seconds)
        if age > max_age or age < -timedelta(seconds=30):
            raise InvalidSignatureError("Signature expirée ou datée du futur", rule_id="SIGNATURE_EXPIRED")
