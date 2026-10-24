"""Vérification du journal chaîné, consultation des événements et fiches XAI."""

from __future__ import annotations

from fastapi import APIRouter, Query

from src.api.dependencies import SystemDep
from src.api.errors import ERROR_RESPONSES
from src.control.exceptions import NotFoundError
from src.models.api_models import AuditVerification
from src.models.finguard_contracts import AuditEvent, DecisionRecord
from src.observability.decision_record import build_decision_record

router = APIRouter(tags=["audit"], responses=ERROR_RESPONSES)


@router.get("/audit/verify", response_model=AuditVerification)
def verify_audit(system: SystemDep) -> AuditVerification:
    """Recalcule la chaîne de hash du fichier d'audit ; signale la première ligne fautive."""
    chain = system.shared.chain
    result = chain.verify()
    return AuditVerification(
        valid=result.valid,
        checked_lines=result.checked_lines,
        first_invalid_line=result.first_invalid_line,
        error=result.error,
        last_hash=result.last_hash,
        path=chain.path.name,
    )


@router.get("/audit/events", response_model=list[AuditEvent])
def list_audit_events(
    system: SystemDep,
    correlation_id: str | None = Query(default=None),
    since: int | None = Query(default=None, ge=0, description="séquence exclue"),
    limit: int = Query(default=500, ge=1, le=5000),
) -> list[AuditEvent]:
    """Événements d'audit, filtrables par corrélation ou séquence (timeline rejouable)."""
    events = system.shared.chain.events(correlation_id)
    if since is not None:
        events = [e for e in events if (e.sequence or 0) > since]
    return events[-limit:]


@router.get("/decisions/{correlation_id}", response_model=DecisionRecord)
def get_decision_record(correlation_id: str, system: SystemDep) -> DecisionRecord:
    """Fiche explicative reconstruite depuis le journal d'audit."""
    events = system.shared.chain.events(correlation_id)
    if not events:
        raise NotFoundError(f"Aucune décision pour {correlation_id}", rule_id="DECISION_UNKNOWN")
    return build_decision_record(correlation_id, events)
