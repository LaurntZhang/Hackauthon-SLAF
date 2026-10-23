"""Logs JSON structurés : timestamp, level, agent_id, action, details, correlation_id."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

_STRUCTURED_KEYS = ("agent_id", "action", "details", "correlation_id")


class JsonFormatter(logging.Formatter):
    """Sérialise chaque enregistrement en une ligne JSON."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in _STRUCTURED_KEYS:
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """Installe le formateur JSON sur le logger racine (idempotent)."""
    root = logging.getLogger()
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level)
