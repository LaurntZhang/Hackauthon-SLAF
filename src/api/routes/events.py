"""Flux SSE des `AuditEvent` pour la tour de contrôle."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from src.api.dependencies import SystemDep
from src.models.finguard_contracts import AuditEvent

router = APIRouter(tags=["events"])

HEARTBEAT_SECONDS = 15.0


def format_sse(event: AuditEvent) -> str:
    """Trame SSE : `id` = séquence, `event` = action, `data` = AuditEvent JSON."""
    return f"id: {event.sequence}\nevent: {event.action}\ndata: {event.model_dump_json()}\n\n"


@router.get(
    "/events",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": "Flux SSE d'AuditEvent"}},
)
async def stream_events(
    request: Request,
    system: SystemDep,
    since: int | None = Query(default=None, ge=0, description="rejoue les événements après cette séquence"),
    replay: bool = Query(default=False, description="rejoue le tampon récent avant le direct"),
    follow: bool = Query(default=True, description="false : rejoue puis ferme le flux"),
    runtime_id: str | None = Query(default=None, description="filtre optionnel par runtime"),
) -> StreamingResponse:
    """Diffuse les événements en direct, avec rejeu optionnel."""
    bus = system.shared.bus
    header_since = request.headers.get("last-event-id")
    if since is None and header_since and header_since.isdigit():
        since = int(header_since)

    def keep(event: AuditEvent) -> bool:
        return runtime_id is None or event.runtime_id == runtime_id

    async def generator() -> AsyncIterator[str]:
        queue = bus.subscribe_async(asyncio.get_running_loop()) if follow else None
        try:
            if replay or since is not None:
                for event in bus.replay(since):
                    if keep(event):
                        yield format_sse(event)
            if queue is None:
                return
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                if keep(event):
                    yield format_sse(event)
        finally:
            if queue is not None:
                bus.unsubscribe_async(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
