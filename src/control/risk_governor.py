"""Risk Governor : budget, fréquence, saucissonnage et circuit breaker à réarmement humain."""

from __future__ import annotations

import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from src.control.exceptions import ConflictError, FinGuardError, GovernanceViolationError
from src.control.kill_switch import KillSwitch
from src.control.policy_config import PolicyConfig
from src.models.finguard_contracts import ExecutionOrder, utc_now

Clock = Callable[[], datetime]
RATE_WINDOW = timedelta(seconds=60)


@dataclass(frozen=True)
class _AcceptedOrder:
    at: datetime
    proposer_id: str
    asset: str
    amount: Decimal
    human_approved: bool


@dataclass(frozen=True)
class GovernorResult:
    """Résultat du contrôle ; `breaker_opened_now` signale une ouverture à journaliser."""

    ok: bool
    rule_ids: list[str]
    reason: str
    breaker_opened_now: bool = False


@dataclass(frozen=True)
class BreakerState:
    """État du circuit breaker."""

    open: bool
    reason: str | None
    opened_at: datetime | None
    consecutive_rejections: int
    orders_last_minute: int


class RiskGovernor:
    """Contrôle les cumuls et la fréquence ; le disjoncteur reste ouvert jusqu'au réarmement humain."""

    def __init__(
        self,
        config: PolicyConfig,
        kill_switch: KillSwitch,
        limit_factor: Callable[[str], Decimal],
        clock: Clock = utc_now,
    ) -> None:
        self._cfg = config.risk_governor
        self._autonomous_limit = config.limits.autonomous_max_amount
        self._kill_switch = kill_switch
        self._limit_factor = limit_factor
        self._clock = clock
        self._lock = threading.RLock()
        self._accepted: deque[_AcceptedOrder] = deque()
        self._daily: dict[tuple[date, str], Decimal] = {}
        self._consecutive_rejections = 0
        self._open = False
        self._open_reason: str | None = None
        self._opened_at: datetime | None = None

    def check(self, order: ExecutionOrder, *, proposer_id: str, human_approved: bool) -> GovernorResult:
        """Contrôle l'ordre ; l'enregistre comme accepté si tout est conforme."""
        now = self._clock()
        try:
            self._kill_switch.require_clear([proposer_id, order.executor_id])
        except FinGuardError as exc:
            return GovernorResult(False, [exc.rule_id or exc.code], exc.message)

        with self._lock:
            if self._open:
                return GovernorResult(
                    False, ["CIRCUIT_BREAKER_OPEN"], f"circuit breaker ouvert : {self._open_reason}"
                )
            self._prune(now)

            if len(self._accepted_since(now - RATE_WINDOW)) + 1 > self._cfg.max_orders_per_minute:
                reason = f"plus de {self._cfg.max_orders_per_minute} ordres par minute pour le système"
                self._trip(reason, now)
                return GovernorResult(False, ["RATE_LIMIT_EXCEEDED"], reason, breaker_opened_now=True)

            limit = self._autonomous_limit * self._limit_factor(proposer_id)
            if not human_approved and order.amount <= limit:
                window_start = now - timedelta(seconds=self._cfg.structuring_window_seconds)
                same_asset = sum(
                    (
                        o.amount
                        for o in self._accepted_since(window_start)
                        if o.proposer_id == proposer_id and o.asset == order.asset and not o.human_approved
                    ),
                    Decimal(0),
                )
                if same_asset + order.amount > limit:
                    reason = (
                        f"saucissonnage : cumul {same_asset + order.amount} € sur {order.asset} "
                        f"au-delà du seuil autonome {limit} €"
                    )
                    self._trip(reason, now)
                    return GovernorResult(False, ["STRUCTURING_DETECTED"], reason, breaker_opened_now=True)

            day_key = (now.date(), proposer_id)
            spent = self._daily.get(day_key, Decimal(0))
            if not human_approved and spent + order.amount > self._cfg.daily_budget_per_agent:
                return GovernorResult(
                    False,
                    ["DAILY_BUDGET_EXCEEDED"],
                    f"budget journalier autonome dépassé pour {proposer_id} ({spent + order.amount} €)",
                )

            self._accepted.append(_AcceptedOrder(now, proposer_id, order.asset, order.amount, human_approved))
            if not human_approved:
                self._daily[day_key] = spent + order.amount
            return GovernorResult(True, [], "cumul, fréquence et kill switch conformes")

    def record_outcome(self, *, rejected: bool) -> bool:
        """Compte les rejets consécutifs ; retourne True si le disjoncteur vient de s'ouvrir."""
        with self._lock:
            if not rejected:
                self._consecutive_rejections = 0
                return False
            self._consecutive_rejections += 1
            if self._consecutive_rejections > self._cfg.max_consecutive_rejections and not self._open:
                self._trip(
                    f"plus de {self._cfg.max_consecutive_rejections} rejets consécutifs", self._clock()
                )
                return True
            return False

    def rearm(self, *, actor_id: str, is_human: bool) -> None:
        """Referme le disjoncteur ; action réservée à un humain."""
        if not is_human:
            raise GovernanceViolationError(
                f"'{actor_id}' ne peut pas réarmer le circuit breaker", rule_id="BREAKER_REARM_HUMAN_ONLY"
            )
        with self._lock:
            if not self._open:
                raise ConflictError("Le circuit breaker n'est pas ouvert", rule_id="BREAKER_NOT_OPEN")
            self._open = False
            self._open_reason = None
            self._opened_at = None
            self._consecutive_rejections = 0
            self._accepted.clear()

    def state(self) -> BreakerState:
        """État courant du disjoncteur."""
        with self._lock:
            now = self._clock()
            self._prune(now)
            return BreakerState(
                self._open,
                self._open_reason,
                self._opened_at,
                self._consecutive_rejections,
                len(self._accepted_since(now - RATE_WINDOW)),
            )

    def _trip(self, reason: str, now: datetime) -> None:
        self._open = True
        self._open_reason = reason
        self._opened_at = now

    def _prune(self, now: datetime) -> None:
        horizon = now - max(RATE_WINDOW, timedelta(seconds=self._cfg.structuring_window_seconds))
        while self._accepted and self._accepted[0].at < horizon:
            self._accepted.popleft()

    def _accepted_since(self, start: datetime) -> list[_AcceptedOrder]:
        return [o for o in self._accepted if o.at >= start]
