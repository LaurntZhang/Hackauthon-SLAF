"""Socle commun des juges : règles déterministes en plancher, LLM optionnel par-dessus."""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field

from src.agents.llm import LLMUnavailableError, StructuredLLM
from src.models.finguard_contracts import JudgeVerdict, TransactionIntent, Vote

VOTE_SEVERITY = {Vote.APPROVE: 0, Vote.ABSTAIN: 1, Vote.VETO: 2}


class JudgeDraft(BaseModel):
    """Sortie structurée attendue du LLM juge."""

    vote: Vote
    rule_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    justification: str


@dataclass(frozen=True)
class RuleAssessment:
    """Évaluation par règles : vote, règles déclenchées, justification."""

    vote: Vote
    rule_ids: list[str]
    confidence: float
    justification: str


@dataclass(frozen=True)
class JudgeOutcome:
    """Verdict et motif de repli éventuel (à journaliser)."""

    verdict: JudgeVerdict
    fallback_reason: str | None


def judge(
    *,
    judge_id: str,
    intent: TransactionIntent,
    rules: RuleAssessment,
    llm: StructuredLLM,
    system_prompt: str,
    user_prompt: str,
) -> JudgeOutcome:
    """Combine règles et LLM : le vote le plus restrictif l'emporte, le LLM ne lève jamais un veto."""
    fallback_reason: str | None = None
    draft: JudgeDraft | None = None
    if llm.enabled:
        try:
            draft = llm.invoke(JudgeDraft, system_prompt, user_prompt)
        except LLMUnavailableError as exc:
            fallback_reason = str(exc)

    if draft is None:
        verdict = JudgeVerdict(
            judge_id=judge_id,
            intent_id=intent.intent_id,
            vote=rules.vote,
            rule_ids=rules.rule_ids,
            confidence=rules.confidence,
            justification=rules.justification,
            fallback_used=fallback_reason is not None,
        )
        return JudgeOutcome(verdict, fallback_reason)

    final_vote = max(rules.vote, draft.vote, key=lambda v: VOTE_SEVERITY[v])
    verdict = JudgeVerdict(
        judge_id=judge_id,
        intent_id=intent.intent_id,
        vote=final_vote,
        rule_ids=sorted(set(rules.rule_ids) | set(draft.rule_ids)),
        confidence=min(rules.confidence, draft.confidence),
        justification=f"{rules.justification} | LLM : {draft.justification[:300]}",
        fallback_used=False,
    )
    return JudgeOutcome(verdict, None)
