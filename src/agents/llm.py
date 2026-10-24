"""Accès optionnel aux LLM (`FINGUARD_LLM=on`) ; toute panne devient un repli typé et journalisé."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "mistralai:mistral-small-latest"


class LLMUnavailableError(Exception):
    """Le LLM est désactivé, absent ou en échec ; l'agent doit utiliser ses règles."""


class StructuredModel(Protocol):
    """Modèle de chat capable de sortie structurée."""

    def with_structured_output(self, schema: type[BaseModel]) -> Any:
        """Retourne un runnable produisant une instance de `schema`."""
        ...


ModelFactory = Callable[[], StructuredModel]


def llm_enabled() -> bool:
    """Vrai si `FINGUARD_LLM=on` ; le mode script est le défaut."""
    return os.getenv("FINGUARD_LLM", "off").strip().lower() in {"on", "1", "true"}


def default_model_factory() -> StructuredModel:
    """Instancie le modèle via LangChain `init_chat_model`, température 0."""
    try:
        from langchain.chat_models import init_chat_model
    except ImportError as exc:
        raise LLMUnavailableError("paquet langchain absent") from exc
    model: StructuredModel = init_chat_model(os.getenv("FINGUARD_LLM_MODEL", DEFAULT_MODEL), temperature=0)
    return model


class StructuredLLM:
    """Appelle un modèle avec un schéma Pydantic ; ne laisse jamais remonter une erreur fournisseur."""

    def __init__(self, factory: ModelFactory | None = None, *, enabled: bool | None = None) -> None:
        self._factory = factory or default_model_factory
        self.enabled = llm_enabled() if enabled is None else enabled

    def invoke[T: BaseModel](self, schema: type[T], system: str, user: str) -> T:
        """Retourne une sortie validée ou lève `LLMUnavailableError`."""
        if not self.enabled:
            raise LLMUnavailableError("mode script (FINGUARD_LLM=off)")
        try:
            runnable = self._factory().with_structured_output(schema)
            raw = runnable.invoke([("system", system), ("user", user)])
        except LLMUnavailableError:
            raise
        except Exception as exc:  # noqa: BLE001 - frontière fournisseur : converti en repli typé
            logger.warning(
                "Appel LLM en échec", extra={"action": "llm_error", "details": {"error": type(exc).__name__}}
            )
            raise LLMUnavailableError(f"erreur fournisseur {type(exc).__name__}") from exc
        try:
            return raw if isinstance(raw, schema) else schema.model_validate(raw)
        except ValidationError as exc:
            raise LLMUnavailableError("sortie structurée invalide") from exc
