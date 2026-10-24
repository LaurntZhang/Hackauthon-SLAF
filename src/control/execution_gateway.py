"""Passerelle d'exécution : seul accès au marché simulé, dernière ligne de défense."""

from __future__ import annotations

import hmac
from typing import Protocol

from src.control.authorizations import AuthorizationRegistry
from src.control.exceptions import IntegrityError
from src.control.kill_switch import KillSwitch
from src.models.finguard_contracts import ExecutionOrder, ExecutionReport, compute_order_hash


class MarketPort(Protocol):
    """Marché cible ; seule la passerelle en détient une référence."""

    def execute(self, order: ExecutionOrder) -> ExecutionReport:
        """Exécute un ordre déjà contrôlé."""
        ...


class ExecutionGateway:
    """Revérifie kill switch et autorisation, consomme l'autorisation, puis transmet au marché."""

    def __init__(
        self, authorizations: AuthorizationRegistry, kill_switch: KillSwitch, market: MarketPort
    ) -> None:
        self._authorizations = authorizations
        self._kill_switch = kill_switch
        self._market = market

    def execute(self, order: ExecutionOrder, *, proposer_id: str) -> ExecutionReport:
        """Exécute l'ordre ou lève une erreur typée ; aucun ordre sans `Authorization` valide."""
        self._kill_switch.require_clear([proposer_id, order.executor_id])
        authorization = self._authorizations.require_valid(order.auth_id)
        if not hmac.compare_digest(compute_order_hash(order), authorization.intent_hash):
            raise IntegrityError("Ordre différent de l'autorisation", rule_id="GATEWAY_HASH_MISMATCH")
        if order.amount > authorization.max_amount:
            raise IntegrityError("Montant supérieur à l'autorisation", rule_id="GATEWAY_AMOUNT_ABOVE_AUTH")
        self._authorizations.consume(order.auth_id)
        return self._market.execute(order)
