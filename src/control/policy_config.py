"""Chargement typé de `config/policies.yaml` et `config/mandates.yaml`."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from src.control.exceptions import ConfigurationError
from src.models.finguard_contracts import AgentMandate, AssetType

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
DEFAULT_POLICIES_PATH = CONFIG_DIR / "policies.yaml"
DEFAULT_MANDATES_PATH = CONFIG_DIR / "mandates.yaml"


class _Cfg(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FundConfig(_Cfg):
    name: str
    aum: Decimal = Field(gt=0)
    currency: str


class UniverseConfig(_Cfg):
    allowed_asset_types: list[AssetType]
    forbidden_asset_types: list[AssetType]
    allowed_currencies: list[str]


class LimitsConfig(_Cfg):
    autonomous_max_amount: Decimal = Field(gt=0)
    max_sector_exposure: Decimal = Field(gt=0, le=1)
    max_issuer_exposure: Decimal = Field(gt=0, le=1)


class CounterpartiesConfig(_Cfg):
    whitelist: list[str]


class QuorumConfig(_Cfg):
    unanimity_threshold: Decimal = Field(ge=0)
    required_approvals: int = Field(ge=1)
    weighted_threshold: Decimal = Field(gt=0, le=1)


class TrustDeltas(_Cfg):
    compliant_action: int
    blocked_out_of_mandate: int
    injection_followed: int
    tampering_after_approval: int


class TrustConfig(_Cfg):
    initial: int = Field(ge=0, le=100)
    ceiling: int = Field(ge=0, le=100)
    halve_limit_below: int
    quarantine_below: int
    deltas: TrustDeltas


class RiskGovernorConfig(_Cfg):
    daily_budget_per_agent: Decimal = Field(gt=0)
    daily_budget_scope: str
    max_orders_per_minute: int = Field(ge=1)
    max_consecutive_rejections: int = Field(ge=1)
    structuring_window_seconds: int = Field(ge=1)


class AuthorizationConfig(_Cfg):
    ttl_seconds: int = Field(ge=1)


class HitlConfig(_Cfg):
    signature_algorithm: str
    max_signature_age_seconds: int = Field(ge=1)
    approvers: list[str]
    operators: list[str]


class FirewallPattern(_Cfg):
    id: str
    regex: str


class FirewallConfig(_Cfg):
    patterns: list[FirewallPattern]


class PolicyConfig(_Cfg):
    """Règles versionnées ; `version` est inscrite dans chaque AuditEvent."""

    version: str
    fund: FundConfig
    universe: UniverseConfig
    limits: LimitsConfig
    counterparties: CounterpartiesConfig
    quorum: QuorumConfig
    trust: TrustConfig
    risk_governor: RiskGovernorConfig
    authorization: AuthorizationConfig
    hitl: HitlConfig
    firewall: FirewallConfig


class MandateEntry(_Cfg):
    agent_id: str
    role: str
    mission: str | None = None
    context: str | None = None
    allowed_tools: list[str]
    allowed_assets: list[AssetType]
    max_amount: Decimal = Field(ge=0)
    output: str | None = None
    escalation: str | None = None
    expires_at: datetime


class MandatesFile(_Cfg):
    version: str
    agents: list[MandateEntry]


def _read_yaml(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return yaml.safe_load(handle)
    except OSError as exc:
        raise ConfigurationError(f"Lecture impossible de {path.name}: {exc.strerror}") from exc
    except yaml.YAMLError as exc:
        raise ConfigurationError(f"YAML invalide dans {path.name}") from exc


def load_policies(path: Path = DEFAULT_POLICIES_PATH) -> PolicyConfig:
    """Charge et valide les règles FinGuard."""
    try:
        return PolicyConfig.model_validate(_read_yaml(path))
    except ValidationError as exc:
        raise ConfigurationError(f"policies.yaml invalide: {exc.error_count()} erreur(s)") from exc


def load_mandates(path: Path = DEFAULT_MANDATES_PATH, *, initial_trust: int = 100) -> list[AgentMandate]:
    """Charge les mandats déclarés et les convertit en `AgentMandate`."""
    try:
        parsed = MandatesFile.model_validate(_read_yaml(path))
    except ValidationError as exc:
        raise ConfigurationError(f"mandates.yaml invalide: {exc.error_count()} erreur(s)") from exc
    return [
        AgentMandate(
            agent_id=entry.agent_id,
            role=entry.role,
            allowed_tools=list(entry.allowed_tools),
            allowed_assets=list(entry.allowed_assets),
            max_amount=entry.max_amount,
            trust_score=initial_trust,
            quarantined=False,
            expires_at=entry.expires_at,
            mission=entry.mission,
            context=entry.context,
            output=entry.output,
            escalation=entry.escalation,
        )
        for entry in parsed.agents
    ]
