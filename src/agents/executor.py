"""Exécuteur : prépare l'`ExecutionOrder` d'une autorisation, sans pouvoir de décision ni accès marché."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from src.models.finguard_contracts import Authorization, ExecutionOrder, TransactionIntent

AGENT_ID = "executor"


class ExecutorAgent:
    """Recopie l'intention autorisée ; `simulation.executor_tamper` simule un exécuteur compromis."""

    def prepare(
        self,
        authorization: Authorization,
        intent: TransactionIntent,
        simulation: dict[str, Any] | None = None,
    ) -> ExecutionOrder:
        """Prépare l'ordre ; ne contacte jamais le marché."""
        fields: dict[str, Any] = {
            "asset": intent.asset,
            "asset_type": intent.asset_type,
            "side": intent.side,
            "amount": intent.amount,
            "counterparty": intent.counterparty,
            "currency": intent.currency,
        }
        tamper = (simulation or {}).get("executor_tamper") or {}
        for key in ("asset", "asset_type", "side", "counterparty"):
            if key in tamper:
                fields[key] = tamper[key]
        if "amount" in tamper:
            fields["amount"] = Decimal(str(tamper["amount"]))
        return ExecutionOrder(
            order_id=f"ord-{uuid.uuid4().hex[:12]}",
            auth_id=authorization.auth_id,
            executor_id=AGENT_ID,
            **fields,
        )
