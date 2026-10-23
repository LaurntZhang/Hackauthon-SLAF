"""Traduction des erreurs métier typées en réponses HTTP explicites."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.control.exceptions import (
    ConfigurationError,
    ConflictError,
    FinGuardError,
    GovernanceViolationError,
    IntegrityError,
    KillSwitchActiveError,
    NotFoundError,
    PolicyLimitExceededError,
)
from src.models.api_models import ErrorResponse

logger = logging.getLogger(__name__)

STATUS_BY_ERROR: list[tuple[type[FinGuardError], int]] = [
    (NotFoundError, 404),
    (GovernanceViolationError, 403),
    (ConflictError, 409),
    (IntegrityError, 409),
    (KillSwitchActiveError, 423),
    (PolicyLimitExceededError, 422),
    (ConfigurationError, 500),
]

ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    code: {"model": ErrorResponse} for code in (403, 404, 409, 422, 423)
}


def status_for(exc: FinGuardError) -> int:
    """Code HTTP associé à une erreur métier."""
    for error_type, status in STATUS_BY_ERROR:
        if isinstance(exc, error_type):
            return status
    return 400


async def finguard_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Réponse JSON typée ; aucune erreur métier n'est masquée en 200."""
    assert isinstance(exc, FinGuardError)
    status = status_for(exc)
    logger.info(
        "Erreur métier",
        extra={
            "action": exc.code,
            "details": {"status": status, "rule_id": exc.rule_id, "path": request.url.path},
        },
    )
    body = ErrorResponse(error=exc.code, message=exc.message, rule_id=exc.rule_id)
    return JSONResponse(status_code=status, content=body.model_dump())


def register_error_handlers(app: FastAPI) -> None:
    """Installe les gestionnaires d'erreurs métier."""
    app.add_exception_handler(FinGuardError, finguard_error_handler)
