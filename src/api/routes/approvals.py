"""Cartes d'approbation HITL et reprise signée."""

from __future__ import annotations

from fastapi import APIRouter

from src.api.dependencies import SystemDep
from src.api.errors import ERROR_RESPONSES
from src.models.api_models import ApprovalRequest, PendingApproval, TransactionResult
from src.models.finguard_contracts import HumanDecision

router = APIRouter(prefix="/approvals", tags=["approvals"], responses=ERROR_RESPONSES)


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
