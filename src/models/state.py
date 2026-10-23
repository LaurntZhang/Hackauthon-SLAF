"""État LangGraph du graphe FinGuard ; les valeurs sont des dicts JSON issus des contrats."""

from __future__ import annotations

import operator
from enum import StrEnum
from typing import Annotated, Any, TypedDict


class RunStatus(StrEnum):
    """Statut d'un thread de transaction."""

    PROCESSING = "processing"
    AWAITING_APPROVAL = "awaiting_approval"
    EXECUTED = "executed"
    BLOCKED = "blocked"
    REJECTED = "rejected"
    REPORTED = "reported"


TERMINAL_STATUSES: frozenset[str] = frozenset(
    {RunStatus.EXECUTED, RunStatus.BLOCKED, RunStatus.REJECTED, RunStatus.REPORTED}
)


class FinGuardState(TypedDict, total=False):
    """État partagé par les 12 nœuds ; `verdicts` et `audit_trail` sont cumulatifs."""

    request: dict[str, Any]
    correlation_id: str
    untrusted: list[dict[str, Any]]
    intent: dict[str, Any] | None
    policy: dict[str, Any] | None
    verdicts: Annotated[list[dict[str, Any]], operator.add]
    quorum: dict[str, Any] | None
    human_decision: dict[str, Any] | None
    authorization: dict[str, Any] | None
    order: dict[str, Any] | None
    report: dict[str, Any] | None
    status: str
    reason: str | None
    audit_trail: Annotated[list[dict[str, Any]], operator.add]
