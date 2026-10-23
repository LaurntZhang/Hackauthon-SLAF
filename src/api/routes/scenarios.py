"""Lancement des scénarios adverses S1 à S6."""

from __future__ import annotations

from fastapi import APIRouter, Query

from src.api.dependencies import SystemDep
from src.api.errors import ERROR_RESPONSES
from src.models.api_models import ScenarioInfo, ScenarioResult
from src.simulation.scenarios import list_scenarios, run_scenario

router = APIRouter(prefix="/scenarios", tags=["scenarios"], responses=ERROR_RESPONSES)


@router.get("", response_model=list[ScenarioInfo])
def get_scenarios() -> list[ScenarioInfo]:
    """Catalogue des scénarios de démo."""
    return list_scenarios()


@router.post("/{name}", response_model=ScenarioResult)
def launch_scenario(
    name: str,
    system: SystemDep,
    auto_approve: bool = Query(default=False, description="S2 : signe l'approbation avec le secret de démo"),
) -> ScenarioResult:
    """Exécute un scénario dans une sandbox isolée ; S2 reste en attente HITL sauf `auto_approve`."""
    return run_scenario(system, name, auto_approve=auto_approve)
