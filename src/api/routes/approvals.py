"""Cartes d'approbation HITL et reprise signée."""

from __future__ import annotations

import os
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from src.api.dependencies import SystemDep
from src.api.errors import ERROR_RESPONSES
from src.models.api_models import ApprovalRequest, PendingApproval, TransactionResult
from src.control.hitl import DEMO_SECRET, approval_message, sign
from src.models.finguard_contracts import HumanAction, HumanDecision

router = APIRouter(prefix="/approvals", tags=["approvals"], responses=ERROR_RESPONSES)


class DemoApprovalRequest(BaseModel):
    """Parcours local de démonstration : le secret HMAC reste côté serveur."""

    model_config = ConfigDict(extra="forbid")
    action: HumanAction
    pin: str = Field(pattern=r"^\d{4}$")


@router.get("", response_model=list[PendingApproval])
def list_pending_approvals(system: SystemDep) -> list[PendingApproval]:
    """Toutes les décisions humaines en attente."""
    return [card for runtime in system.runtimes() for card in runtime.pending_approvals()]


@router.get("/{thread_id}", response_model=PendingApproval)
def get_pending_approval(thread_id: str, system: SystemDep) -> PendingApproval:
    """Carte d'approbation d'un thread (404 inconnu, 409 s'il n'attend rien)."""
    runtime = system.resolve_thread(thread_id)
    return PendingApproval.model_validate(
        {**runtime.pending_payload(thread_id), "runtime_id": runtime.runtime_id}
    )


@router.post("/{thread_id}", response_model=TransactionResult)
def submit_approval(thread_id: str, body: ApprovalRequest, system: SystemDep) -> TransactionResult:
    """Reprend le thread avec une `HumanDecision` signée (403 si signature invalide)."""
    decision = HumanDecision(thread_id=thread_id, **body.model_dump())
    return system.resolve_thread(thread_id).resume(thread_id, decision)


@router.post("/{thread_id}/demo", response_model=TransactionResult)
def submit_demo_approval(thread_id: str, body: DemoApprovalRequest, system: SystemDep) -> TransactionResult:
    """Signe côté serveur une décision pour la démo locale, sans exposer le HMAC au navigateur."""
    runtime = system.resolve_thread(thread_id)
    if not runtime.verifier.uses_demo_secret:
        raise HTTPException(status_code=409, detail="Le parcours PIN est désactivé hors secret de démonstration.")
    if body.pin != os.getenv("FINGUARD_DEMO_PIN", "1234"):
        raise HTTPException(status_code=403, detail="Code de démonstration incorrect.")
    if body.action not in (HumanAction.APPROVE, HumanAction.REJECT):
        raise HTTPException(status_code=422, detail="Action HITL non autorisée.")
    pending = runtime.pending_payload(thread_id)
    approver_id = "risk_officer_1"
    timestamp = datetime.now(UTC).replace(microsecond=0)
    message = approval_message(
        thread_id=thread_id,
        action=body.action,
        approver_id=approver_id,
        intent_hash=pending["intent_hash"],
        timestamp=timestamp,
    )
    decision = HumanDecision(
        thread_id=thread_id,
        action=body.action,
        approver_id=approver_id,
        timestamp=timestamp,
        signature=sign(DEMO_SECRET, message),
    )
    return runtime.resume(thread_id, decision)
