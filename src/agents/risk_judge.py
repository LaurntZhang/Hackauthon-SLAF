"""Juge Risque : concentration, taille de position et cohérence vendeuse ; ne modifie jamais l'intention."""

from __future__ import annotations

from src.agents.judging import JudgeOutcome, RuleAssessment, judge
from src.agents.llm import StructuredLLM
from src.control.policy_config import PolicyConfig
from src.models.finguard_contracts import AssetType, Side, TransactionIntent, Vote
from src.simulation.fixtures import INSTRUMENTS, Portfolio

AGENT_ID = "risk_judge"
MIN_CONFIDENCE = 0.6

SYSTEM_PROMPT = (
    "Tu es le juge Risque du fonds Alpha (profil prudent). Évalue l'intention : concentration émetteur "
    "et secteur, taille de position, volatilité. Réponds par approve, veto ou abstain avec des rule_ids."
)


class RiskJudgeAgent:
    """Lit les expositions ; vote approve, veto ou abstain."""

    def __init__(self, llm: StructuredLLM, portfolio: Portfolio, config: PolicyConfig) -> None:
        self._llm = llm
        self._portfolio = portfolio
        self._limits = config.limits

    def assess(self, intent: TransactionIntent) -> JudgeOutcome:
        """Rend un verdict ; le repli par règles est toujours disponible."""
        rules = self._rules(intent)
        return judge(
            judge_id=AGENT_ID,
            intent=intent,
            rules=rules,
            llm=self._llm,
            system_prompt=SYSTEM_PROMPT,
            user_prompt=intent.model_dump_json(exclude={"rationale"}),
        )

    def _rules(self, intent: TransactionIntent) -> RuleAssessment:
        instrument = INSTRUMENTS.get(intent.asset)
        if instrument is None:
            return RuleAssessment(
                Vote.VETO, ["RISK_UNKNOWN_ASSET"], 0.99, "actif absent du référentiel de risque"
            )
        if intent.confidence < MIN_CONFIDENCE:
            return RuleAssessment(
                Vote.ABSTAIN,
                ["RISK_LOW_PROPOSER_CONFIDENCE"],
                0.5,
                "confiance du Proposer trop faible pour juger",
            )

        vetoes: list[str] = []
        notes: list[str] = []
        if intent.side is Side.SELL:
            held = self._portfolio.position(intent.asset)
            if intent.amount > held:
                vetoes.append("RISK_SHORT_SELL")
                notes.append(f"vente de {intent.amount} € pour {held} € détenus")
        elif instrument.asset_type is not AssetType.CASH:
            issuer = self._portfolio.issuer_exposure(instrument.issuer, intent.amount)
            sector = self._portfolio.sector_exposure(instrument.sector, intent.amount)
            if issuer > self._limits.max_issuer_exposure:
                vetoes.append("RISK_ISSUER_CONCENTRATION")
                notes.append(f"exposition émetteur {issuer:.2%} > {self._limits.max_issuer_exposure:.0%}")
            if sector > self._limits.max_sector_exposure:
                vetoes.append("RISK_SECTOR_CONCENTRATION")
                notes.append(f"exposition secteur {sector:.2%} > {self._limits.max_sector_exposure:.0%}")
            if (
                instrument.asset_type is AssetType.EQUITY
                and intent.amount > self._limits.autonomous_max_amount
            ):
                vetoes.append("RISK_LARGE_EQUITY_POSITION")
                notes.append(
                    f"achat actions de {intent.amount} € au-delà du seuil autonome : volatilité incompatible "
                    "avec le profil prudent sans validation humaine"
                )

        if vetoes:
            return RuleAssessment(Vote.VETO, vetoes, 0.9, "; ".join(notes))
        return RuleAssessment(
            Vote.APPROVE, ["RISK_WITHIN_LIMITS"], 0.9, "expositions et taille dans les limites"
        )
