"""Integrity Engine : un ordre doit correspondre exactement à l'intention autorisée."""

from __future__ import annotations

import hmac
from dataclasses import dataclass

from src.control.authorizations import AuthorizationRegistry
from src.control.exceptions import FinGuardError
from src.control.mandates import MandateRegistry
from src.models.finguard_contracts import ExecutionOrder, compute_order_hash


@dataclass(frozen=True)
class IntegrityResult:
    """Résultat du contrôle d'intégrité."""

    ok: bool
    rule_ids: list[str]
    reason: str
    order_hash: str
    tampering: bool


class IntegrityEngine:
    """Compare le hash de l'ordre au hash de l'intention lié à l'autorisation."""

    def __init__(self, authorizations: AuthorizationRegistry, mandates: MandateRegistry) -> None:
        self._authorizations = authorizations
        self._mandates = mandates

    def check(self, order: ExecutionOrder) -> IntegrityResult:
        """Contrôle l'ordre ; ne modifie jamais l'ordre."""
        order_hash = compute_order_hash(order)
        try:
            authorization = self._authorizations.require_valid(order.auth_id)
        except FinGuardError as exc:
            return IntegrityResult(False, [exc.rule_id or exc.code], exc.message, order_hash, False)

        rules: list[str] = []
        if not hmac.compare_digest(order_hash, authorization.intent_hash):
            rules.append("INTEGRITY_HASH_MISMATCH")
        if order.amount > authorization.max_amount:
            rules.append("INTEGRITY_AMOUNT_ABOVE_AUTHORIZATION")
        if not self._mandates.has(order.executor_id) or (
            "prepare_order" not in self._mandates.get(order.executor_id).allowed_tools
        ):
            rules.append("INTEGRITY_EXECUTOR_NOT_MANDATED")
        elif self._mandates.get(order.executor_id).quarantined:
            rules.append("INTEGRITY_EXECUTOR_QUARANTINED")

        if rules:
            tampering = "INTEGRITY_HASH_MISMATCH" in rules or "INTEGRITY_AMOUNT_ABOVE_AUTHORIZATION" in rules
            reason = "l'ordre diffère de l'intention approuvée" if tampering else "exécuteur non habilité"
            return IntegrityResult(False, rules, reason, order_hash, tampering)
        return IntegrityResult(True, [], "ordre identique à l'intention autorisée", order_hash, False)
