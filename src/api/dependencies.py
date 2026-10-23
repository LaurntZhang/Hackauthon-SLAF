"""Construction du système FinGuard depuis l'environnement et injection dans les routes."""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, Request

from src.control.hitl import DEMO_SECRET
from src.control.policy_config import DEFAULT_MANDATES_PATH, DEFAULT_POLICIES_PATH, load_policies
from src.graph.graph_runtime import FinGuardSystem, GraphRuntime, SharedServices, sqlite_checkpointer
from src.observability.langfuse_adapter import LangfuseExporter, build_langfuse_client

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]


def build_system_from_env() -> FinGuardSystem:
    """Assemble le système : audit JSONL, checkpoints SQLite, secret HITL, Langfuse optionnel."""
    config = load_policies(Path(os.getenv("FINGUARD_POLICIES", str(DEFAULT_POLICIES_PATH))))
    secret = os.getenv("FINGUARD_HITL_SECRET", DEMO_SECRET)
    if secret == DEMO_SECRET:
        logger.warning("Secret HITL de démonstration utilisé", extra={"action": "demo_secret_in_use"})
    shared = SharedServices.create(
        config=config,
        audit_path=Path(os.getenv("FINGUARD_AUDIT_PATH", str(ROOT / "logs" / "audit.jsonl"))),
        hitl_secret=secret,
        mandates_path=Path(os.getenv("FINGUARD_MANDATES", str(DEFAULT_MANDATES_PATH))),
    )
    checkpoint = os.getenv("FINGUARD_CHECKPOINT_DB", str(ROOT / "data" / "checkpoints.sqlite"))
    checkpointer = None if checkpoint == "memory" else sqlite_checkpointer(Path(checkpoint))
    system = FinGuardSystem(shared, main_checkpointer=checkpointer)
    attach_langfuse(system)
    return system


def attach_langfuse(system: FinGuardSystem) -> LangfuseExporter | None:
    """Abonne l'export Langfuse si configuré ; une panne est journalisée dans l'audit."""
    client = build_langfuse_client()
    if client is None:
        return None
    shared = system.shared

    def on_degraded(error: str) -> None:
        shared.recorder.record(
            correlation_id=f"obs-{uuid.uuid4().hex[:8]}",
            agent_id="finguard.observability",
            action="observability_degraded",
            reasoning=f"export Langfuse désactivé ({error}) ; le journal chaîné reste la source de vérité",
            status="degraded",
            policy_version=shared.config.version,
        )

    exporter = LangfuseExporter(client, on_degraded)
    shared.bus.subscribe("langfuse", exporter)
    return exporter


def get_system(request: Request) -> FinGuardSystem:
    """Système FinGuard attaché à l'application."""
    system: FinGuardSystem = request.app.state.system
    return system


SystemDep = Annotated[FinGuardSystem, Depends(get_system)]


def record_control(
    runtime: GraphRuntime, *, actor_id: str, action: str, reasoning: str, status: str, context: dict[str, Any]
) -> str:
    """Journalise une commande humaine sur le plan de contrôle ; retourne son identifiant."""
    correlation_id = f"ctl-{uuid.uuid4().hex[:12]}"
    runtime.shared.recorder.record(
        correlation_id=correlation_id,
        agent_id=actor_id,
        action=action,
        reasoning=reasoning,
        status=status,
        policy_version=runtime.config.version,
        context=context,
        runtime_id=runtime.runtime_id,
    )
    return correlation_id
