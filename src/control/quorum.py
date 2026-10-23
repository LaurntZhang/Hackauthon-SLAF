"""Quorum pondéré : agrège les `JudgeVerdict` des juges en ALLOW ou ESCALATE."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal

from src.control.policy_config import QuorumConfig
from src.models.finguard_contracts import (
    JudgeVerdict,
    PolicyDecision,
    PolicyOutcome,
    QuorumDecision,
    TransactionIntent,
    Vote,
)


class WeightedQuorum:
    """Veto ou abstention : ESCALATE ; > seuil : unanimité ; sinon ratio pondéré > 0,70."""

    def __init__(self, config: QuorumConfig, expected_judges: tuple[str, ...]) -> None:
        self._config = config
        self._expected = expected_judges

    def decide(
        self,
        intent: TransactionIntent,
        verdicts: list[JudgeVerdict],
        trust_scores: Mapping[str, int],
        policy: PolicyDecision,
    ) -> QuorumDecision:
        """Décision du quorum ; un ESCALATE du Policy Engine est toujours conservé."""
        by_judge = {v.judge_id: v for v in verdicts if v.intent_id == intent.intent_id}
        rules: list[str] = []
        missing = [j for j in self._expected if j not in by_judge]
        if missing:
            rules.append("QUORUM_MISSING_VERDICT")

        considered = [by_judge[j] for j in self._expected if j in by_judge]
        approvals = sum(1 for v in considered if v.vote is Vote.APPROVE)
        total_weight = sum(self._weight(trust_scores, v.judge_id) for v in considered)
        approve_weight = sum(
            self._weight(trust_scores, v.judge_id) for v in considered if v.vote is Vote.APPROVE
        )
        ratio = float(approve_weight / total_weight) if total_weight > 0 else 0.0

        if any(v.vote in (Vote.VETO, Vote.ABSTAIN) for v in considered):
            rules.append("QUORUM_VETO_OR_ABSTAIN")
        elif intent.amount > self._config.unanimity_threshold:
            if approvals < self._config.required_approvals:
                rules.append("QUORUM_UNANIMITY_REQUIRED")
        elif Decimal(str(ratio)) <= self._config.weighted_threshold:
            rules.append("QUORUM_WEIGHTED_BELOW_THRESHOLD")

        if policy.outcome is PolicyOutcome.ESCALATE:
            rules.append("POLICY_FORCED_ESCALATION")

        outcome = PolicyOutcome.ESCALATE if rules else PolicyOutcome.ALLOW
        return QuorumDecision(
            outcome=outcome,
            approvals=approvals,
            required_approvals=self._config.required_approvals,
            weighted_ratio=round(ratio, 4),
            triggered_rules=rules,
            explanation=self._explain(outcome, approvals, ratio, rules),
        )

    @staticmethod
    def _weight(trust_scores: Mapping[str, int], judge_id: str) -> Decimal:
        return Decimal(trust_scores.get(judge_id, 0)) / Decimal(100)

    def _explain(self, outcome: PolicyOutcome, approvals: int, ratio: float, rules: list[str]) -> str:
        head = f"{approvals}/{len(self._expected)} approbations, ratio pondéré {ratio:.2f}"
        if outcome is PolicyOutcome.ALLOW:
            return f"{head} : quorum atteint"
        return f"{head} : escalade humaine ({', '.join(rules)})"
