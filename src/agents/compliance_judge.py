"""Juge Conformité : KYC, univers et provenance des données ; ne modifie jamais l'intention."""

from __future__ import annotations

from src.agents.judging import JudgeOutcome, RuleAssessment, judge
from src.agents.llm import StructuredLLM
from src.control.policy_config import PolicyConfig
from src.models.finguard_contracts import TransactionIntent, UntrustedContent, Vote

AGENT_ID = "compliance_judge"
MIN_RATIONALE_LENGTH = 10

SYSTEM_PROMPT = (
    "Tu es le juge Conformité du fonds Alpha. Vérifie KYC de la contrepartie, univers autorisé, "
    "justification et provenance des données. Réponds par approve, veto ou abstain avec des rule_ids."
)


class ComplianceJudgeAgent:
    """Lit la liste blanche KYC et le référentiel ; vote approve, veto ou abstain."""

    def __init__(self, llm: StructuredLLM, config: PolicyConfig) -> None:
        self._llm = llm
        self._config = config

    def assess(self, intent: TransactionIntent, untrusted: list[UntrustedContent]) -> JudgeOutcome:
        """Rend un verdict ; le repli par règles est toujours disponible."""
        return judge(
            judge_id=AGENT_ID,
            intent=intent,
            rules=self._rules(intent, untrusted),
            llm=self._llm,
            system_prompt=SYSTEM_PROMPT,
            user_prompt=intent.model_dump_json(exclude={"rationale"}),
        )

    def _rules(self, intent: TransactionIntent, untrusted: list[UntrustedContent]) -> RuleAssessment:
        vetoes: list[str] = []
        notes: list[str] = []
        if intent.counterparty not in self._config.counterparties.whitelist:
            vetoes.append("COMPLIANCE_COUNTERPARTY_KYC")
            notes.append("contrepartie absente de la liste blanche KYC")
        if intent.asset_type not in self._config.universe.allowed_asset_types:
            vetoes.append("COMPLIANCE_ASSET_UNIVERSE")
            notes.append("classe d'actif hors univers du fonds")
        if intent.requested_tool != "propose_trade":
            vetoes.append("COMPLIANCE_TOOL")
            notes.append(f"outil '{intent.requested_tool}' non prévu par la procédure")
        flagged = {c.source for c in untrusted if c.flagged}
        if flagged.intersection(intent.data_sources):
            vetoes.append("COMPLIANCE_TAINTED_SOURCE")
            notes.append("l'intention s'appuie sur une source signalée par le Firewall")
        if vetoes:
            return RuleAssessment(Vote.VETO, vetoes, 0.95, "; ".join(notes))
        if len(intent.rationale.strip()) < MIN_RATIONALE_LENGTH:
            return RuleAssessment(
                Vote.ABSTAIN, ["COMPLIANCE_RATIONALE_MISSING"], 0.6, "justification insuffisante"
            )
        return RuleAssessment(
            Vote.APPROVE, ["COMPLIANCE_OK"], 0.95, "contrepartie KYC, univers et sources conformes"
        )
