"""Application FastAPI ManAgent / FinGuard : `uvicorn src.api.main:app`."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.api.dependencies import build_system_from_env
from src.api.errors import register_error_handlers
from src.api.routes import approvals, audit, controls, events, scenarios, transactions
from src.graph.graph_runtime import FinGuardSystem
from src.observability.logging_config import configure_logging

API_VERSION = "0.1.0"
STATIC_DIR = Path(__file__).with_name("static")


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
    app.state.system = system
    register_error_handlers(app)
    for module in (transactions, approvals, controls, scenarios, audit, events):
        app.include_router(module.router)

    app.mount("/css", StaticFiles(directory=STATIC_DIR / "css"), name="dashboard-css")
    app.mount("/js", StaticFiles(directory=STATIC_DIR / "js"), name="dashboard-js")

    @app.get("/approval", include_in_schema=False)
    @app.get("/approval.html", include_in_schema=False)
    def approval_page() -> FileResponse:
        return FileResponse(STATIC_DIR / "approval.html")

    @app.get("/", tags=["meta"])
    def index() -> FileResponse:
        """Sert la tour de contrôle web ; l'API reste disponible sous ses routes habituelles."""
        return FileResponse(STATIC_DIR / "dashboard.html")

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        """Sonde de vivacité."""
        return {"status": "ok"}

    return app


app = create_app()
