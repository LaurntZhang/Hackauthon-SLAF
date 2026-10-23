"""Contrats HTTP exposés au front (OpenAPI) ; construits sur `finguard_contracts`."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.models.finguard_contracts import (
    AgentMandate,
    AssetType,
    AuditEvent,
    Authorization,
    ExecutionOrder,
    ExecutionReport,
    HumanAction,
    HumanDecision,
    JudgeVerdict,
    KillScope,
    PolicyDecision,
    QuorumDecision,
    Side,
    TransactionIntent,
    UntrustedContent,
)

RunStatusLiteral = Literal["processing", "awaiting_approval", "executed", "blocked", "rejected", "reported"]


class _Api(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExternalContentIn(_Api):
    """Contenu externe (news, document) qui passera par le Firewall."""

    source: str = Field(min_length=1, max_length=120, examples=["news:feed-42"])
    content: str = Field(min_length=1, max_length=4000)


class ProposalIn(_Api):
    """Proposition structurée (sinon le Proposer interprète `objective`)."""

    asset: str = Field(min_length=1, max_length=60, examples=["FR-OAT-2034"])
    asset_type: AssetType
    side: Side
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2, examples=["4000"])
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    counterparty: str = Field(min_length=1, max_length=60, examples=["BNP-SECURITIES-SIM"])
    rationale: str = Field(min_length=1, max_length=2000)
    confidence: float = Field(default=0.85, ge=0, le=1)


class TransactionRequest(_Api):
    """Soumission d'un objectif ou d'une transaction."""

    objective: str | None = Field(default=None, max_length=1000, examples=["Acheter 4 000 € d'OAT 2034"])
    proposal: ProposalIn | None = None
    external_content: list[ExternalContentIn] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _objective_or_proposal(self) -> TransactionRequest:
        if not self.objective and self.proposal is None:
            raise ValueError("objective ou proposal est requis")
        return self


class SigningInfo(_Api):
    """Comment signer la décision humaine (HMAC-SHA256)."""

    algorithm: str
    message_format: str
    timestamp_format: str


class PendingApproval(_Api):
    """Carte d'approbation HITL."""

    thread_id: str
    correlation_id: str
    intent: TransactionIntent
    intent_hash: str
    policy: PolicyDecision | None = None
    verdicts: list[JudgeVerdict] = Field(default_factory=list)
    quorum: QuorumDecision | None = None
    reasons: list[str] = Field(default_factory=list)
    allowed_actions: list[HumanAction]
    signing: SigningInfo
    runtime_id: str | None = None


class TransactionResult(_Api):
    """État d'un thread de transaction après soumission, reprise ou consultation."""

    thread_id: str
    correlation_id: str
    runtime_id: str
    status: RunStatusLiteral
    reason: str | None = None
    untrusted: list[UntrustedContent] = Field(default_factory=list)
    intent: TransactionIntent | None = None
    policy: PolicyDecision | None = None
    verdicts: list[JudgeVerdict] = Field(default_factory=list)
    quorum: QuorumDecision | None = None
    human_decision: HumanDecision | None = None
    authorization: Authorization | None = None
    order: ExecutionOrder | None = None
    report: ExecutionReport | None = None
    pending_approval: PendingApproval | None = None
    audit_trail: list[AuditEvent] = Field(default_factory=list)


class ApprovalRequest(_Api):
    """Décision humaine signée ; `thread_id` est porté par l'URL."""

    action: HumanAction
    approver_id: str = Field(min_length=1, max_length=60)
    signature: str = Field(pattern=r"^[0-9a-f]{64}$")
    timestamp: datetime
    comment: str | None = Field(default=None, max_length=500)


class SignedControlRequest(_Api):
    """Commande d'opérateur humain signée (HMAC)."""

    operator_id: str = Field(min_length=1, max_length=60)
    signature: str = Field(pattern=r"^[0-9a-f]{64}$")
    timestamp: datetime
    reason: str = Field(min_length=1, max_length=500)
    runtime_id: str = Field(default="main", max_length=80)


class KillSwitchRequest(_Api):
    """Arrêt ou réarmement ; l'arrêt est immédiat, le réarmement exige une signature."""

    action: Literal["engage", "release"]
    scope: KillScope
    agent_id: str | None = Field(default=None, max_length=60)
    operator_id: str = Field(min_length=1, max_length=60)
    reason: str = Field(min_length=1, max_length=500)
    signature: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    timestamp: datetime | None = None

    @model_validator(mode="after")
    def _agent_for_agent_scope(self) -> KillSwitchRequest:
        if self.scope is KillScope.AGENT and not self.agent_id:
            raise ValueError("agent_id est requis pour un arrêt ciblé")
        return self


class StopInfo(_Api):
    """Arrêt actif."""

    actor_id: str
    reason: str
    engaged_at: datetime


class KillSwitchState(_Api):
    """État du kill switch."""

    global_engaged: bool
    global_stop: StopInfo | None = None
    stopped_agents: dict[str, StopInfo] = Field(default_factory=dict)


class CircuitBreakerState(_Api):
    """État du circuit breaker d'un runtime."""

    runtime_id: str
    open: bool
    reason: str | None = None
    opened_at: datetime | None = None
    consecutive_rejections: int
    orders_last_minute: int


class ControlsState(_Api):
    """Vue synthétique de la tour de contrôle."""

    policy_version: str
    kill_switch: KillSwitchState
    circuit_breaker: CircuitBreakerState
    agents: list[AgentMandate]
    llm_mode: Literal["on", "off"]
    demo_secret_in_use: bool


class AuditVerification(_Api):
    """Résultat de `verify_chain()`."""

    valid: bool
    checked_lines: int
    first_invalid_line: int | None = None
    error: str | None = None
    last_hash: str
    path: str


class ScenarioInfo(_Api):
    """Description d'un scénario de démo."""

    name: str
    code: str
    title: str
    expected: str


class ScenarioResult(_Api):
    """Résultat d'un scénario exécuté dans un runtime isolé."""

    name: str
    code: str
    title: str
    expected: str
    passed: bool
    runtime_id: str
    steps: list[TransactionResult] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(_Api):
    """Erreur métier typée."""

    error: str
    message: str
    rule_id: str | None = None
