"""Policy Engine : vérifie une intention contre le mandat et les règles versionnées."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime

from src.control.mandates import MandateRegistry
from src.control.policy_config import PolicyConfig
from src.models.finguard_contracts import (
    AssetType,
    PolicyDecision,
    PolicyOutcome,
    TransactionIntent,
    UntrustedContent,
    utc_now,
)

Clock = Callable[[], datetime]

RULE_EXPLANATIONS: dict[str, str] = {
    "MANDATE_UNKNOWN": "l'agent n'a déclaré aucun mandat",
    "AGENT_QUARANTINED": "l'agent est en quarantaine (lecture seule)",
    "MANDATE_EXPIRED": "le mandat de l'agent a expiré",
    "TOOL_NOT_ALLOWED": "l'outil demandé n'est pas autorisé par le mandat",
    "ASSET_TYPE_FORBIDDEN": "la classe d'actif est hors de l'univers autorisé",
    "ASSET_TYPE_NOT_IN_MANDATE": "la classe d'actif n'est pas couverte par le mandat",
    "ASSET_UNKNOWN": "l'actif est absent du référentiel",
    "ASSET_TYPE_MISMATCH": "la classe déclarée ne correspond pas au référentiel",
    "CURRENCY_NOT_ALLOWED": "la devise n'est pas autorisée",
    "COUNTERPARTY_NOT_WHITELISTED": "la contrepartie n'est pas sur la liste blanche KYC",
    "MANDATE_MAX_AMOUNT": "le montant dépasse le plafond effectif du mandat",
    "INJECTION_FOLLOWED": "l'intention s'appuie sur un contenu signalé par le Firewall",
    "AUTONOMOUS_LIMIT": "le montant dépasse le seuil autonome : validation humaine obligatoire",
    "FLAGGED_SOURCE_CITED": "l'intention cite une source signalée : validation humaine obligatoire",
}


@dataclass(frozen=True)
class PolicyEvaluation:
    """Décision du Policy Engine et faits utiles au Trust Score."""

    decision: PolicyDecision
    injection_followed: bool
    blocked_out_of_mandate: bool


class PolicyEngine:
    """Applique les règles figées : BLOCK, puis ESCALATE, sinon ALLOW."""

    def __init__(
        self,
        config: PolicyConfig,
        mandates: MandateRegistry,
        instruments: Mapping[str, AssetType],
        clock: Clock = utc_now,
    ) -> None:
        self._config = config
        self._mandates = mandates
        self._instruments = instruments
        self._clock = clock

    def evaluate(self, intent: TransactionIntent, untrusted: list[UntrustedContent]) -> PolicyEvaluation:
        """Évalue l'intention ; aucune exception pour un résultat métier normal."""
        blocks = self._blocking_rules(intent)
        flagged_sources = {c.source for c in untrusted if c.flagged}
        cites_flagged = bool(flagged_sources.intersection(intent.data_sources))

        if blocks:
            injection_followed = cites_flagged
            if injection_followed:
                blocks.append("INJECTION_FOLLOWED")
            return PolicyEvaluation(
                decision=self._decision(PolicyOutcome.BLOCK, blocks),
                injection_followed=injection_followed,
                blocked_out_of_mandate=blocks != ["MANDATE_UNKNOWN"],
            )

        escalations: list[str] = []
        factor = self._mandates.limit_factor(intent.proposer_id)
        if intent.amount > self._config.limits.autonomous_max_amount * factor:
            escalations.append("AUTONOMOUS_LIMIT")
        if cites_flagged:
            escalations.append("FLAGGED_SOURCE_CITED")
        if escalations:
            return PolicyEvaluation(self._decision(PolicyOutcome.ESCALATE, escalations), False, False)
        return PolicyEvaluation(self._decision(PolicyOutcome.ALLOW, []), False, False)

    def _blocking_rules(self, intent: TransactionIntent) -> list[str]:
        if not self._mandates.has(intent.proposer_id):
            return ["MANDATE_UNKNOWN"]
        mandate = self._mandates.effective(intent.proposer_id)
        universe = self._config.universe
        rules: list[str] = []
        if mandate.quarantined:
            rules.append("AGENT_QUARANTINED")
        if mandate.expires_at <= self._clock():
            rules.append("MANDATE_EXPIRED")
        if intent.requested_tool not in mandate.allowed_tools:
            rules.append("TOOL_NOT_ALLOWED")
        if intent.asset_type in universe.forbidden_asset_types or (
            intent.asset_type not in universe.allowed_asset_types
        ):
            rules.append("ASSET_TYPE_FORBIDDEN")
        elif intent.asset_type not in mandate.allowed_assets:
            rules.append("ASSET_TYPE_NOT_IN_MANDATE")
        known_type = self._instruments.get(intent.asset)
        if known_type is None:
            rules.append("ASSET_UNKNOWN")
        elif known_type != intent.asset_type:
            rules.append("ASSET_TYPE_MISMATCH")
        if intent.currency not in universe.allowed_currencies:
            rules.append("CURRENCY_NOT_ALLOWED")
        if intent.counterparty not in self._config.counterparties.whitelist:
            rules.append("COUNTERPARTY_NOT_WHITELISTED")
        if intent.amount > mandate.max_amount:
            rules.append("MANDATE_MAX_AMOUNT")
        return rules

    def _decision(self, outcome: PolicyOutcome, rules: list[str]) -> PolicyDecision:
        if rules:
            explanation = "; ".join(RULE_EXPLANATIONS.get(rule, rule) for rule in rules)
        else:
            explanation = "intention conforme au mandat et aux règles ; passage au quorum"
        return PolicyDecision(
            outcome=outcome,
            triggered_rules=rules,
            policy_version=self._config.version,
            explanation=explanation,
        )
