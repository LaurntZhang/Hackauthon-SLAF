"""Fiche XAI : reconstruit une décision lisible à partir du seul journal d'audit."""

from __future__ import annotations

from pydantic import ValidationError

from src.models.finguard_contracts import AuditEvent, DecisionRecord, JudgeVerdict

LOW_CONFIDENCE = 0.8

STATUS_LABELS = {
    "executed": "exécutée",
    "blocked": "bloquée",
    "rejected": "rejetée par l'humain",
    "reported": "rejetée et signalée par l'humain",
    "awaiting_approval": "en attente de validation humaine",
    "processing": "en cours",
}


def build_decision_record(correlation_id: str, events: list[AuditEvent]) -> DecisionRecord:
    """Construit la fiche : facteurs, votes, règles, incertitudes et chemin suivi."""
    ordered = sorted(events, key=lambda e: e.sequence or 0)
    path: list[str] = []
    rules: list[str] = []
    factors: list[str] = []
    uncertainties: list[str] = []
    votes: list[JudgeVerdict] = []
    final_status: str | None = None
    intent_summary: str | None = None
    final_reason: str | None = None

    for event in ordered:
        if not path or path[-1] != event.action:
            path.append(event.action)
        for rule in event.context.get("rules", []) or []:
            if isinstance(rule, str) and rule not in rules:
                rules.append(rule)

        if event.action == "intent_proposed":
            intent = event.context.get("intent", {})
            intent_summary = (
                f"{intent.get('side', '?')} {intent.get('amount', '?')} {intent.get('currency', '')} "
                f"de {intent.get('asset', '?')} ({intent.get('asset_type', '?')}) "
                f"via {intent.get('counterparty', '?')}"
            )
            factors.append(f"Intention : {intent_summary}")
            if intent.get("rationale"):
                factors.append(f"Justification du Proposer : {intent['rationale']}")
        elif event.action in ("policy_evaluated", "quorum_decided", "integrity_checked", "risk_checked"):
            factors.append(f"{event.agent_id} : {event.reasoning}")
        elif event.action == "judge_verdict":
            try:
                verdict = JudgeVerdict.model_validate(event.context.get("verdict", {}))
            except ValidationError:
                uncertainties.append(f"verdict illisible de {event.agent_id}")
                continue
            votes.append(verdict)
            if verdict.confidence < LOW_CONFIDENCE:
                uncertainties.append(f"{verdict.judge_id} : confiance {verdict.confidence:.2f}")
            if verdict.vote.value == "abstain":
                uncertainties.append(f"{verdict.judge_id} s'est abstenu")
            if verdict.fallback_used:
                uncertainties.append(f"{verdict.judge_id} a utilisé le repli déterministe")
        elif event.action == "content_flagged":
            uncertainties.append(f"contenu externe signalé ({', '.join(event.context.get('flags', []))})")
        elif event.action == "llm_fallback":
            uncertainties.append(f"{event.agent_id} : repli sans LLM ({event.reasoning})")
        elif event.action == "human_decision":
            factors.append(f"Décision humaine : {event.reasoning}")
        elif event.action == "transaction_completed":
            final_status = event.status
            final_reason = event.reasoning

    label = STATUS_LABELS.get(final_status or "", final_status or "inconnue")
    summary = f"Transaction {label}"
    if intent_summary:
        summary += f" — {intent_summary}"
    if final_reason:
        summary += f". Motif : {final_reason}"
    return DecisionRecord(
        correlation_id=correlation_id,
        summary=summary,
        factors=factors,
        votes=votes,
        rules=rules,
        uncertainties=uncertainties,
        path=path,
        final_status=final_status,
    )
