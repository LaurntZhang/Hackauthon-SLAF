"""Exceptions typées du plan de contrôle ; aucune n'est avalée silencieusement."""

from __future__ import annotations


class FinGuardError(Exception):
    """Base des erreurs métier FinGuard."""

    code = "finguard_error"

    def __init__(self, message: str, *, rule_id: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.rule_id = rule_id


class GovernanceViolationError(FinGuardError):
    """Action interdite par la gouvernance (droits, mandat, signature, rôle)."""

    code = "governance_violation"


class InvalidSignatureError(GovernanceViolationError):
    """Signature HMAC absente, expirée ou invalide."""

    code = "invalid_signature"


class PolicyLimitExceededError(FinGuardError):
    """Limite quantitative dépassée (budget, fréquence, plafond)."""

    code = "policy_limit_exceeded"


class CircuitBreakerOpenError(PolicyLimitExceededError):
    """Le circuit breaker est ouvert jusqu'au réarmement humain."""

    code = "circuit_breaker_open"


class IntegrityError(FinGuardError):
    """L'ordre ne correspond pas à l'autorisation ou l'autorisation n'est plus valide."""

    code = "integrity_error"


class KillSwitchActiveError(FinGuardError):
    """Le kill switch bloque l'exécution."""

    code = "kill_switch_active"


class NotFoundError(FinGuardError):
    """Ressource inconnue (thread, autorisation, agent, scénario)."""

    code = "not_found"


class ConflictError(FinGuardError):
    """Opération incompatible avec l'état courant."""

    code = "conflict"


class ConfigurationError(FinGuardError):
    """Configuration de politique ou de mandat invalide."""

    code = "configuration_error"
