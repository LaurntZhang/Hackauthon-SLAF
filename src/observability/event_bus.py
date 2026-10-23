"""Bus d'événements : diffuse les `AuditEvent` au superviseur, à Langfuse et aux flux SSE."""

from __future__ import annotations

import asyncio
import logging
import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

from src.models.finguard_contracts import AuditEvent

logger = logging.getLogger(__name__)

Subscriber = Callable[[AuditEvent], None]
REPLAY_BUFFER_SIZE = 5000
SSE_QUEUE_SIZE = 1000


@dataclass
class _AsyncSubscription:
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue[AuditEvent]


class EventBus:
    """Diffusion synchrone et sans réentrance ; une panne d'abonné n'interrompt jamais l'émetteur."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._subscribers: list[tuple[str, Subscriber]] = []
        self._async: list[_AsyncSubscription] = []
        self._pending: deque[AuditEvent] = deque()
        self._dispatching = False
        self._replay: deque[AuditEvent] = deque(maxlen=REPLAY_BUFFER_SIZE)
        self.subscriber_failures: dict[str, int] = {}

    def subscribe(self, name: str, callback: Subscriber) -> None:
        """Abonne un consommateur synchrone (superviseur, export Langfuse)."""
        with self._lock:
            self._subscribers.append((name, callback))

    def unsubscribe(self, name: str) -> None:
        """Retire un consommateur synchrone."""
        with self._lock:
            self._subscribers = [(n, cb) for n, cb in self._subscribers if n != name]

    def subscribe_async(self, loop: asyncio.AbstractEventLoop) -> asyncio.Queue[AuditEvent]:
        """Crée une file asyncio alimentée depuis n'importe quel thread (flux SSE)."""
        queue: asyncio.Queue[AuditEvent] = asyncio.Queue(maxsize=SSE_QUEUE_SIZE)
        with self._lock:
            self._async.append(_AsyncSubscription(loop, queue))
        return queue

    def unsubscribe_async(self, queue: asyncio.Queue[AuditEvent]) -> None:
        """Retire une file SSE."""
        with self._lock:
            self._async = [s for s in self._async if s.queue is not queue]

    def replay(self, since_sequence: int | None = None) -> list[AuditEvent]:
        """Événements récents, éventuellement après une séquence donnée."""
        with self._lock:
            events = list(self._replay)
        if since_sequence is None:
            return events
        return [e for e in events if e.sequence is not None and e.sequence > since_sequence]

    def publish(self, event: AuditEvent) -> None:
        """Publie un événement ; les publications faites pendant une diffusion sont mises en file."""
        with self._lock:
            self._pending.append(event)
            if self._dispatching:
                return
            self._dispatching = True
        try:
            while True:
                with self._lock:
                    if not self._pending:
                        self._dispatching = False
                        return
                    current = self._pending.popleft()
                    self._replay.append(current)
                    subscribers = list(self._subscribers)
                    async_subs = list(self._async)
                for name, callback in subscribers:
                    self._deliver(name, callback, current)
                for sub in async_subs:
                    self._deliver_async(sub, current)
        except BaseException:
            with self._lock:
                self._dispatching = False
            raise

    def _deliver(self, name: str, callback: Subscriber, event: AuditEvent) -> None:
        try:
            callback(event)
        except Exception:  # noqa: BLE001 - un abonné défaillant est isolé et journalisé, jamais ignoré
            self.subscriber_failures[name] = self.subscriber_failures.get(name, 0) + 1
            logger.exception(
                "Abonné du bus en échec",
                extra={
                    "agent_id": name,
                    "action": "subscriber_failed",
                    "correlation_id": event.correlation_id,
                },
            )

    def _deliver_async(self, sub: _AsyncSubscription, event: AuditEvent) -> None:
        def _put() -> None:
            if sub.queue.full():
                sub.queue.get_nowait()
                logger.warning(
                    "File SSE saturée : événement le plus ancien abandonné", extra={"action": "sse_drop"}
                )
            sub.queue.put_nowait(event)

        try:
            sub.loop.call_soon_threadsafe(_put)
        except RuntimeError:
            self.unsubscribe_async(sub.queue)
