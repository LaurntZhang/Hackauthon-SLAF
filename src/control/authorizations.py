"""Registre d'autorisations : liées au SHA-256 de l'intention, expirables, révocables, à usage unique."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

from src.control.exceptions import IntegrityError, NotFoundError
from src.control.policy_config import AuthorizationConfig
from src.models.finguard_contracts import Authorization, TransactionIntent, compute_intent_hash, utc_now

Clock = Callable[[], datetime]


class AuthorizationRegistry:
    """Source de vérité des autorisations ; l'état du graphe n'en est qu'une copie."""

    def __init__(self, config: AuthorizationConfig, clock: Clock = utc_now) -> None:
        self._ttl = timedelta(seconds=config.ttl_seconds)
        self._clock = clock
        self._lock = threading.RLock()
        self._items: dict[str, Authorization] = {}
        self._consumed: set[str] = set()

    def issue(
        self, intent: TransactionIntent, approvers: list[str], *, human_approved: bool
    ) -> Authorization:
        """Crée une autorisation pour le montant exact de l'intention."""
        authorization = Authorization(
            auth_id=f"auth-{uuid.uuid4().hex[:12]}",
            intent_id=intent.intent_id,
            intent_hash=compute_intent_hash(intent),
            max_amount=intent.amount,
            approvers=approvers,
            expires_at=self._clock() + self._ttl,
            revoked=False,
            human_approved=human_approved,
        )
        with self._lock:
            self._items[authorization.auth_id] = authorization
        return authorization

    def get(self, auth_id: str) -> Authorization:
        """Autorisation enregistrée, quel que soit son état."""
        with self._lock:
            authorization = self._items.get(auth_id)
        if authorization is None:
            raise NotFoundError(f"Autorisation inconnue: {auth_id}", rule_id="AUTH_UNKNOWN")
        return authorization

    def revoke(self, auth_id: str) -> Authorization:
        """Révoque une autorisation (idempotent)."""
        with self._lock:
            revoked = self.get(auth_id).model_copy(update={"revoked": True})
            self._items[auth_id] = revoked
        return revoked

    def require_valid(self, auth_id: str) -> Authorization:
        """Retourne l'autorisation si elle est connue, non révoquée, non expirée et non consommée."""
        with self._lock:
            authorization = self._items.get(auth_id)
            consumed = auth_id in self._consumed
        if authorization is None:
            raise IntegrityError(f"Autorisation inconnue: {auth_id}", rule_id="AUTH_UNKNOWN")
        if authorization.revoked:
            raise IntegrityError("Autorisation révoquée", rule_id="AUTH_REVOKED")
        if authorization.expires_at <= self._clock():
            raise IntegrityError("Autorisation expirée", rule_id="AUTH_EXPIRED")
        if consumed:
            raise IntegrityError("Autorisation déjà utilisée", rule_id="AUTH_ALREADY_USED")
        return authorization

    def consume(self, auth_id: str) -> Authorization:
        """Valide puis marque l'autorisation comme utilisée (rejeu impossible)."""
        with self._lock:
            authorization = self.require_valid(auth_id)
            self._consumed.add(auth_id)
        return authorization
