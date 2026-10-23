"""Soumission et consultation des transactions."""

from __future__ import annotations

from fastapi import APIRouter, status

from src.api.dependencies import SystemDep
from src.api.errors import ERROR_RESPONSES
from src.models.api_models import TransactionRequest, TransactionResult

router = APIRouter(prefix="/transactions", tags=["transactions"], responses=ERROR_RESPONSES)


@router.post("", response_model=TransactionResult, status_code=status.HTTP_201_CREATED)
def submit_transaction(body: TransactionRequest, system: SystemDep) -> TransactionResult:
    """Soumet un objectif ou une proposition ; retourne exécuté, bloqué ou en attente HITL."""
    return system.main.submit(
        objective=body.objective,
        proposal=body.proposal.model_dump(mode="json") if body.proposal else None,
        external_content=[c.model_dump() for c in body.external_content],
        source="api",
    )


@router.get("/{thread_id}", response_model=TransactionResult)
def get_transaction(thread_id: str, system: SystemDep) -> TransactionResult:
    """État courant d'un thread (tous runtimes)."""
    return system.resolve_thread(thread_id).get(thread_id)
