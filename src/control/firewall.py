"""Agent Firewall : encapsule les entrées externes et signale les injections, sans LLM."""

from __future__ import annotations

import re
from dataclasses import dataclass

from src.control.policy_config import FirewallConfig
from src.models.finguard_contracts import UntrustedContent

IBAN_PATTERN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b")
IBAN_PLACEHOLDER = "[IBAN_REDACTED]"
MAX_CONTENT_LENGTH = 4000


def redact_sensitive(text: str) -> str:
    """Masque les IBAN dans un texte destiné aux agents ou aux logs."""
    return IBAN_PATTERN.sub(IBAN_PLACEHOLDER, text)


@dataclass(frozen=True)
class RawExternalContent:
    """Contenu externe brut avant passage par le Firewall."""

    source: str
    content: str


class AgentFirewall:
    """Encapsule chaque contenu externe en `UntrustedContent` et le marque si suspect."""

    def __init__(self, config: FirewallConfig) -> None:
        self._patterns = [(p.id, re.compile(p.regex)) for p in config.patterns]

    def inspect(self, item: RawExternalContent) -> UntrustedContent:
        """Analyse un contenu ; le texte retourné est tronqué et expurgé des IBAN."""
        raw = item.content[:MAX_CONTENT_LENGTH]
        flags = [pattern_id for pattern_id, regex in self._patterns if regex.search(raw)]
        return UntrustedContent(
            source=item.source,
            content=redact_sensitive(raw),
            flagged=bool(flags),
            flags=flags,
        )

    def inspect_all(self, items: list[RawExternalContent]) -> list[UntrustedContent]:
        """Analyse une liste de contenus externes."""
        return [self.inspect(item) for item in items]
