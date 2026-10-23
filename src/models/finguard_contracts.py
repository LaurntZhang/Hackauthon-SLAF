"""Contrats Pydantic figés : seule frontière de données entre agents, FinGuard, API et front.

Règle d'évolution : on ajoute des champs optionnels, on ne renomme ni ne supprime (CADRAGE §7).
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AssetType(StrEnum):
    """Classes d'actifs connues ; seules bond, equity et cash sont dans l'univers autorisé."""

    BOND = "bond"
    EQUITY = "equity"
    CASH = "cash"
    DERIVATIVE = "derivative"
    CRYPTO = "crypto"


class Side(StrEnum):
    """Sens de l'opération."""

    BUY = "buy"
    SELL = "sell"


class Vote(StrEnum):
    """Vote d'un juge."""

    APPROVE = "approve"
    VETO = "veto"
    ABSTAIN = "abstain"


class PolicyOutcome(StrEnum):
    """Verdict du Policy Engine et du quorum."""

    ALLOW = "ALLOW"
    ESCALATE = "ESCALATE"
    BLOCK = "BLOCK"


class HumanAction(StrEnum):
    """Décision humaine sur la carte d'approbation."""

    APPROVE = "approve"
    REJECT = "reject"
    REPORT = "report"


class ExecutionStatus(StrEnum):
    """Statut d'un ordre en sortie de passerelle."""

    FILLED = "filled"
    BLOCKED = "blocked"


class KillScope(StrEnum):
    """Portée d'un arrêt."""

    GLOBAL = "global"
    AGENT = "agent"


class AlertSeverity(StrEnum):
    """Gravité d'une alerte du superviseur."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


def utc_now() -> datetime:
    """Horodatage UTC timezone-aware."""
    return datetime.now(UTC)


class _Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, use_enum_values=False)


class AgentMandate(_Contract):
    """Mandat d'un agent : plafonds, actifs, outils, réputation, quarantaine."""

    agent_id: str = Field(min_length=1)
    role: str = Field(min_length=1)
    allowed_tools: list[str] = Field(default_factory=list)
    allowed_assets: list[AssetType] = Field(default_factory=list)
    max_amount: Decimal = Field(ge=0)
    trust_score: int = Field(default=100, ge=0, le=100)
    quarantined: bool = False
    expires_at: datetime
    mission: str | None = None
    context: str | None = None
    output: str | None = None
    escalation: str | None = None


class UntrustedContent(_Contract):
    """Contenu externe encapsulé : donnée, jamais instruction."""

    source: str = Field(min_length=1)
    content: str
    flagged: bool = False
    flags: list[str] = Field(default_factory=list)


class TransactionIntent(_Contract):
    """Intention de transaction émise par le Proposer ; ce n'est jamais un ordre."""

    intent_id: str = Field(min_length=1)
    correlation_id: str = Field(min_length=1)
    proposer_id: str = Field(min_length=1)
    asset: str = Field(min_length=1)
    asset_type: AssetType
    side: Side
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    counterparty: str = Field(min_length=1)
    rationale: str = Field(min_length=1, max_length=2000)
    confidence: float = Field(ge=0.0, le=1.0)
    data_sources: list[str] = Field(default_factory=list)
    requested_tool: str = "propose_trade"

    @field_validator("amount", mode="before")
    @classmethod
    def _reject_float(cls, value: Any) -> Any:
        if isinstance(value, float):
            raise ValueError("amount doit être un Decimal ou une chaîne, jamais un float")
        return value


class JudgeVerdict(_Contract):
    """Vote structuré d'un juge."""

    judge_id: str = Field(min_length=1)
    intent_id: str = Field(min_length=1)
    vote: Vote
    rule_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    justification: str = Field(min_length=1)
    fallback_used: bool = False


class PolicyDecision(_Contract):
    """Verdict du Policy Engine."""

    outcome: PolicyOutcome
    triggered_rules: list[str] = Field(default_factory=list)
    policy_version: str
    explanation: str


class QuorumDecision(_Contract):
    """Résultat agrégé du quorum pondéré."""

    outcome: PolicyOutcome
    approvals: int = Field(ge=0)
    required_approvals: int = Field(ge=0)
    weighted_ratio: float = Field(ge=0.0, le=1.0)
    triggered_rules: list[str] = Field(default_factory=list)
    explanation: str


class HumanDecision(_Contract):
    """Décision humaine signée (HMAC) qui reprend un thread en pause."""

    thread_id: str = Field(min_length=1)
    action: HumanAction
    approver_id: str = Field(min_length=1)
    signature: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")
    timestamp: datetime
    comment: str | None = Field(default=None, max_length=500)


class Authorization(_Contract):
    """Autorisation liée au SHA-256 exact de l'intention approuvée."""

    auth_id: str = Field(min_length=1)
    intent_id: str = Field(min_length=1)
    intent_hash: str = Field(min_length=64, max_length=64)
    max_amount: Decimal = Field(gt=0)
    approvers: list[str] = Field(min_length=1)
    expires_at: datetime
    revoked: bool = False
    human_approved: bool = False


class ExecutionOrder(_Contract):
    """Ordre préparé par l'Exécuteur, contrôlé avant tout accès au marché."""

    order_id: str = Field(min_length=1)
    auth_id: str = Field(min_length=1)
    executor_id: str = Field(min_length=1)
    asset: str = Field(min_length=1)
    side: Side
    amount: Decimal = Field(gt=0)
    counterparty: str = Field(min_length=1)
    asset_type: AssetType | None = None
    currency: str | None = None


class ExecutionReport(_Contract):
    """Résultat de la passerelle d'exécution."""

    order_id: str
    status: ExecutionStatus
    reason: str | None = None
    fill_price: Decimal | None = None
    executed_at: datetime | None = None


class AuditEvent(_Contract):
    """Ligne du journal d'audit chaîné : qui, quoi, quand (UTC), pourquoi, statut."""

    timestamp: datetime
    correlation_id: str
    agent_id: str
    action: str
    reasoning: str
    status: str
    policy_version: str
    trust_score: int | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    prev_hash: str
    hash: str
    runtime_id: str | None = None
    sequence: int | None = None


class DecisionRecord(_Contract):
    """Fiche XAI lisible d'une décision."""

    correlation_id: str
    summary: str
    factors: list[str] = Field(default_factory=list)
    votes: list[JudgeVerdict] = Field(default_factory=list)
    rules: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    path: list[str] = Field(default_factory=list)
    final_status: str | None = None


class Alert(_Contract):
    """Alerte émise par le superviseur méta-agent."""

    alert_id: str
    raised_by: str
    severity: AlertSeverity
    message: str
    correlation_id: str | None = None
    related_agent_id: str | None = None


class KillRequest(_Contract):
    """Demande d'arrêt émise par le superviseur ; il ne peut demander qu'une quarantaine d'agent."""

    request_id: str
    requested_by: str
    scope: KillScope
    target_agent_id: str | None = None
    reason: str
    correlation_id: str | None = None


INTENT_HASH_FIELDS: tuple[str, ...] = ("asset", "asset_type", "side", "amount", "currency", "counterparty")


def _canonical_amount(amount: Decimal) -> str:
    normalized = amount.normalize()
    return format(normalized, "f")


def canonical_trade_payload(
    *,
    asset: str,
    asset_type: AssetType | str | None,
    side: Side | str,
    amount: Decimal,
    currency: str | None,
    counterparty: str,
) -> str:
    """JSON canonique (clés triées) des champs liés par le hash d'intention."""
    payload = {
        "asset": asset,
        "asset_type": str(asset_type) if asset_type is not None else None,
        "side": str(side),
        "amount": _canonical_amount(amount),
        "currency": currency,
        "counterparty": counterparty,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_intent_hash(intent: TransactionIntent) -> str:
    """SHA-256 du JSON canonique des champs économiques de l'intention."""
    payload = canonical_trade_payload(
        asset=intent.asset,
        asset_type=intent.asset_type,
        side=intent.side,
        amount=intent.amount,
        currency=intent.currency,
        counterparty=intent.counterparty,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_order_hash(order: ExecutionOrder) -> str:
    """SHA-256 de l'ordre calculé sur les mêmes champs que l'intention."""
    payload = canonical_trade_payload(
        asset=order.asset,
        asset_type=order.asset_type,
        side=order.side,
        amount=order.amount,
        currency=order.currency,
        counterparty=order.counterparty,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
