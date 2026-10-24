"""Marché simulé déterministe ; seule la passerelle d'exécution en détient une référence."""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import datetime

from src.models.finguard_contracts import ExecutionOrder, ExecutionReport, ExecutionStatus, Side, utc_now
from src.simulation.fixtures import INSTRUMENTS, Portfolio

Clock = Callable[[], datetime]


class SimulatedMarket:
    """Remplit chaque ordre au prix de référence et met à jour le portefeuille."""

    def __init__(self, portfolio: Portfolio, clock: Clock = utc_now) -> None:
        self._portfolio = portfolio
        self._clock = clock
        self._lock = threading.Lock()
        self.fills: list[ExecutionReport] = []

    def execute(self, order: ExecutionOrder) -> ExecutionReport:
        """Exécute l'ordre ; un actif inconnu est refusé par le marché."""
        instrument = INSTRUMENTS.get(order.asset)
        if instrument is None:
            return ExecutionReport(
                order_id=order.order_id, status=ExecutionStatus.BLOCKED, reason="actif inconnu du marché"
            )
        signed = order.amount if order.side is Side.BUY else -order.amount
        with self._lock:
            self._portfolio.apply_fill(order.asset, signed)
            report = ExecutionReport(
                order_id=order.order_id,
                status=ExecutionStatus.FILLED,
                reason="exécuté sur le marché simulé",
                fill_price=instrument.price,
                executed_at=self._clock(),
            )
            self.fills.append(report)
        return report
