"""Application FastAPI ManAgent / FinGuard : `uvicorn src.api.main:app`."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.dependencies import build_system_from_env
from src.api.errors import register_error_handlers
from src.api.routes import approvals, audit, controls, events, scenarios, transactions
from src.graph.graph_runtime import FinGuardSystem
from src.observability.logging_config import configure_logging

API_VERSION = "0.1.0"


def create_app(system: FinGuardSystem | None = None) -> FastAPI:
    """Fabrique l'application ; un système peut être injecté pour les tests."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging()
        if getattr(app.state, "system", None) is None:
            app.state.system = build_system_from_env()
        yield

    app = FastAPI(
        title="ManAgent — FinGuard Control Plane",
        version=API_VERSION,
        description=(
            "Les agents proposent, les règles décident, l'humain tranche, et tout est prouvé. "
            "Plan de contrôle déterministe entre agents IA et marché simulé."
        ),
        lifespan=lifespan,
    )
    origins = os.getenv("FINGUARD_CORS_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Last-Event-ID"],
    )
    app.state.system = system
    register_error_handlers(app)
    for module in (transactions, approvals, controls, scenarios, audit, events):
        app.include_router(module.router)

    @app.get("/", tags=["meta"])
    def index() -> dict[str, Any]:
        """Métadonnées de l'API ; le front React Native (src/front) consomme les routes ci-dessous."""
        return {
            "service": "ManAgent — FinGuard Control Plane",
            "version": API_VERSION,
            "docs": "/docs",
            "health": "/health",
        }

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        """Sonde de vivacité."""
        return {"status": "ok"}

    return app


app = create_app()
