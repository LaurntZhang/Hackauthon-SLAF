"""Runtimes FinGuard : assemblage des composants, soumission, reprise HITL et registre des threads."""

from __future__ import annotations

import logging
import sqlite3
import threading
import uuid
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from src.agents.compliance_judge import ComplianceJudgeAgent
from src.agents.executor import ExecutorAgent
from src.agents.llm import StructuredLLM
from src.agents.proposer import ProposerAgent
from src.agents.risk_judge import RiskJudgeAgent
from src.agents.supervisor import SupervisorAgent
from src.control.authorizations import AuthorizationRegistry
from src.control.exceptions import ConflictError, FinGuardError, GovernanceViolationError, NotFoundError
from src.control.execution_gateway import ExecutionGateway
from src.control.firewall import AgentFirewall
from src.control.hitl import HumanSignatureVerifier
from src.control.integrity import IntegrityEngine
from src.control.kill_switch import KillSwitch
from src.control.mandates import MandateRegistry
from src.control.policy_config import DEFAULT_MANDATES_PATH, PolicyConfig, load_mandates
from src.control.policy_engine import PolicyEngine
from src.control.quorum import WeightedQuorum
from src.control.risk_governor import RiskGovernor
from src.graph.finguard_graph import JUDGES, GraphContext, build_finguard_graph
from src.models.api_models import PendingApproval, TransactionResult
from src.models.finguard_contracts import HumanDecision, utc_now
from src.models.state import TERMINAL_STATUSES, FinGuardState, RunStatus
from src.observability.audit_chain import AuditChain, AuditRecorder
from src.observability.event_bus import EventBus
from src.simulation.fixtures import Portfolio, instrument_types
from src.simulation.market import SimulatedMarket

logger = logging.getLogger(__name__)

Clock = Callable[[], datetime]
MAIN_RUNTIME_ID = "main"
MAX_SANDBOXES = 50


@dataclass
class SharedServices:
    """Services partagés par tous les runtimes : preuve, diffusion et arrêt humain."""

    config: PolicyConfig
    chain: AuditChain
    bus: EventBus
    recorder: AuditRecorder
    kill_switch: KillSwitch
    hitl_secret: str
    mandates_path: Path = DEFAULT_MANDATES_PATH
    clock: Clock = utc_now
    llm_factory: Callable[[], StructuredLLM] = field(default=StructuredLLM)

    @classmethod
    def create(
        cls,
        *,
        config: PolicyConfig,
        audit_path: Path,
        hitl_secret: str,
        mandates_path: Path = DEFAULT_MANDATES_PATH,
        clock: Clock = utc_now,
        llm_factory: Callable[[], StructuredLLM] = StructuredLLM,
    ) -> SharedServices:
        """Construit les services partagés à partir d'un chemin d'audit."""
        chain = AuditChain(audit_path)
        bus = EventBus()
        return cls(
            config=config,
            chain=chain,
            bus=bus,
            recorder=AuditRecorder(chain, bus),
            kill_switch=KillSwitch(clock),
            hitl_secret=hitl_secret,
            mandates_path=mandates_path,
            clock=clock,
            llm_factory=llm_factory,
        )


@dataclass
class _ThreadInfo:
    correlation_id: str
    status: str


class GraphRuntime:
    """Un plan de contrôle complet (mandats, autorisations, disjoncteur, marché) et son graphe."""

    def __init__(
        self,
        *,
        runtime_id: str,
        shared: SharedServices,
        checkpointer: BaseCheckpointSaver[Any] | None = None,
    ) -> None:
        self.runtime_id = runtime_id
        self.shared = shared
        config = shared.config
        clock = shared.clock
        self.config = config
        self.mandates = MandateRegistry(
            load_mandates(shared.mandates_path, initial_trust=config.trust.initial), config.trust
        )
        self.portfolio = Portfolio(config.fund.aum)
        self.market = SimulatedMarket(self.portfolio, clock)
        self.authorizations = AuthorizationRegistry(config.authorization, clock)
        self.risk_governor = RiskGovernor(config, shared.kill_switch, self.mandates.limit_factor, clock)
        self.verifier = HumanSignatureVerifier(config.hitl, shared.hitl_secret, clock)
        llm = shared.llm_factory()
        self.llm_enabled = llm.enabled
        self.context = GraphContext(
            runtime_id=runtime_id,
            config=config,
            recorder=shared.recorder,
            mandates=self.mandates,
            firewall=AgentFirewall(config.firewall),
            policy_engine=PolicyEngine(config, self.mandates, instrument_types(), clock),
            quorum=WeightedQuorum(config.quorum, JUDGES),
            authorizations=self.authorizations,
            integrity=IntegrityEngine(self.authorizations, self.mandates),
            risk_governor=self.risk_governor,
            gateway=ExecutionGateway(self.authorizations, shared.kill_switch, self.market),
            verifier=self.verifier,
            proposer=ProposerAgent(llm, default_counterparty=config.counterparties.whitelist[0]),
            risk_judge=RiskJudgeAgent(llm, self.portfolio, config),
            compliance_judge=ComplianceJudgeAgent(llm, config),
            executor=ExecutorAgent(),
        )
        self._checkpointer = checkpointer or InMemorySaver()
        self.graph = build_finguard_graph(self.context, self._checkpointer)
        self.supervisor = SupervisorAgent(
            runtime_id=runtime_id,
            recorder=shared.recorder,
            kill_switch=shared.kill_switch,
            mandates=self.mandates,
            policy_version=config.version,
        )
        self._subscriber_name = f"supervisor:{runtime_id}"
        shared.bus.subscribe(self._subscriber_name, self.supervisor)
        self._lock = threading.RLock()
        self._threads: dict[str, _ThreadInfo] = {}

    def close(self) -> None:
        """Désabonne le superviseur du bus partagé."""
        self.shared.bus.unsubscribe(self._subscriber_name)

    # --- soumission et reprise ---------------------------------------------------------------------

    def submit(
        self,
        *,
        objective: str | None = None,
        proposal: dict[str, Any] | None = None,
        external_content: list[dict[str, str]] | None = None,
        simulation: dict[str, Any] | None = None,
        source: str = "api",
    ) -> TransactionResult:
        """Lance un thread ; retourne après exécution, blocage ou pause HITL."""
        thread_id = f"thr-{uuid.uuid4().hex[:12]}"
        correlation_id = f"cor-{uuid.uuid4().hex[:12]}"
        request = {
            "thread_id": thread_id,
            "objective": objective,
            "proposal": proposal,
            "external_content": external_content or [],
            "simulation": simulation or {},
            "source": source,
        }
        with self._lock:
            self._threads[thread_id] = _ThreadInfo(correlation_id, RunStatus.PROCESSING.value)
            self._record(
                correlation_id,
                "transaction_received",
                f"soumission via {source}",
                RunStatus.PROCESSING.value,
                {
                    "thread_id": thread_id,
                    "objective": (objective or "")[:200],
                    "has_proposal": proposal is not None,
                },
            )
            initial: FinGuardState = {
                "request": request,
                "correlation_id": correlation_id,
                "verdicts": [],
                "audit_trail": [],
                "status": RunStatus.PROCESSING.value,
                "reason": None,
            }
            result = self.graph.invoke(initial, self._config(thread_id))
            return self._finalize(thread_id, result)

    def resume(self, thread_id: str, decision: HumanDecision) -> TransactionResult:
        """Vérifie la signature puis reprend le thread par `Command(resume=...)`."""
        with self._lock:
            pending = self._pending_payload(thread_id)
            if decision.thread_id != thread_id:
                raise GovernanceViolationError(
                    "Décision émise pour un autre thread", rule_id="HITL_THREAD_MISMATCH"
                )
            correlation_id = str(pending["correlation_id"])
            try:
                self.verifier.verify_approval(decision, str(pending["intent_hash"]))
            except FinGuardError as exc:
                self._record(
                    correlation_id,
                    "hitl_signature_rejected",
                    f"décision refusée pour {decision.approver_id} : {exc.message}",
                    "denied",
                    {"rules": [exc.rule_id], "approver_id": decision.approver_id},
                )
                raise
            result = self.graph.invoke(
                Command(resume=decision.model_dump(mode="json")), self._config(thread_id)
            )
            return self._finalize(thread_id, result)

    # --- consultation ------------------------------------------------------------------------------

    def has_thread(self, thread_id: str) -> bool:
        """Vrai si le thread existe dans ce runtime (mémoire ou checkpoint)."""
        if thread_id in self._threads:
            return True
        return bool(self.graph.get_state(self._config(thread_id)).values)

    def get(self, thread_id: str) -> TransactionResult:
        """État courant d'un thread, sans effet de bord."""
        snapshot = self.graph.get_state(self._config(thread_id))
        if not snapshot.values:
            raise NotFoundError(f"Thread inconnu : {thread_id}", rule_id="THREAD_UNKNOWN")
        pending = snapshot.interrupts[0].value if snapshot.interrupts else None
        return self._result(thread_id, dict(snapshot.values), pending)

    def pending_approvals(self) -> list[PendingApproval]:
        """Cartes d'approbation en attente dans ce runtime."""
        cards: list[PendingApproval] = []
        for thread_id, info in list(self._threads.items()):
            if info.status != RunStatus.AWAITING_APPROVAL:
                continue
            snapshot = self.graph.get_state(self._config(thread_id))
            if snapshot.interrupts:
                cards.append(
                    PendingApproval.model_validate(
                        {**snapshot.interrupts[0].value, "runtime_id": self.runtime_id}
                    )
                )
        return cards

    def pending_payload(self, thread_id: str) -> dict[str, Any]:
        """Charge utile de la carte d'approbation d'un thread en pause."""
        return self._pending_payload(thread_id)

    # --- interne -----------------------------------------------------------------------------------

    def _pending_payload(self, thread_id: str) -> dict[str, Any]:
        snapshot = self.graph.get_state(self._config(thread_id))
        if not snapshot.values:
            raise NotFoundError(f"Thread inconnu : {thread_id}", rule_id="THREAD_UNKNOWN")
        if not snapshot.interrupts:
            raise ConflictError(
                f"Le thread {thread_id} n'attend pas de validation (statut {snapshot.values.get('status')})",
                rule_id="THREAD_NOT_AWAITING_APPROVAL",
            )
        payload: dict[str, Any] = snapshot.interrupts[0].value
        return payload

    def _finalize(self, thread_id: str, result: dict[str, Any]) -> TransactionResult:
        interrupts = result.get("__interrupt__") or []
        values = {k: v for k, v in result.items() if k != "__interrupt__"}
        correlation_id = str(values["correlation_id"])
        if interrupts:
            self._threads[thread_id] = _ThreadInfo(correlation_id, RunStatus.AWAITING_APPROVAL.value)
            return self._result(thread_id, values, interrupts[0].value)

        status = str(values.get("status") or RunStatus.BLOCKED.value)
        if status not in TERMINAL_STATUSES:
            status = RunStatus.BLOCKED.value
            values["reason"] = values.get("reason") or "graphe terminé sans statut final"
        values["status"] = status
        self._threads[thread_id] = _ThreadInfo(correlation_id, status)
        if self.risk_governor.record_outcome(rejected=status != RunStatus.EXECUTED):
            self._record(
                correlation_id,
                "circuit_breaker_opened",
                f"plus de {self.config.risk_governor.max_consecutive_rejections} rejets consécutifs",
                "open",
                {"rules": ["CONSECUTIVE_REJECTIONS"]},
                agent_id="finguard.risk_governor",
            )
        self._record(
            correlation_id,
            "transaction_completed",
            values.get("reason") or "transaction exécutée",
            status,
            {"thread_id": thread_id},
        )
        return self._result(thread_id, values, None)

    def _result(
        self, thread_id: str, values: dict[str, Any], pending: dict[str, Any] | None
    ) -> TransactionResult:
        correlation_id = str(values["correlation_id"])
        status = (
            RunStatus.AWAITING_APPROVAL.value
            if pending
            else str(values.get("status") or RunStatus.PROCESSING.value)
        )
        return TransactionResult.model_validate(
            {
                "thread_id": thread_id,
                "correlation_id": correlation_id,
                "runtime_id": self.runtime_id,
                "status": status,
                "reason": values.get("reason"),
                "untrusted": values.get("untrusted") or [],
                "intent": values.get("intent"),
                "policy": values.get("policy"),
                "verdicts": values.get("verdicts") or [],
                "quorum": values.get("quorum"),
                "human_decision": values.get("human_decision"),
                "authorization": values.get("authorization"),
                "order": values.get("order"),
                "report": values.get("report"),
                "pending_approval": {**pending, "runtime_id": self.runtime_id} if pending else None,
                "audit_trail": [e.model_dump(mode="json") for e in self.shared.chain.events(correlation_id)],
            }
        )

    def _record(
        self,
        correlation_id: str,
        action: str,
        reasoning: str,
        status: str,
        context: dict[str, Any],
        agent_id: str = "finguard.runtime",
    ) -> None:
        self.shared.recorder.record(
            correlation_id=correlation_id,
            agent_id=agent_id,
            action=action,
            reasoning=reasoning,
            status=status,
            policy_version=self.config.version,
            context=context,
            runtime_id=self.runtime_id,
        )

    @staticmethod
    def _config(thread_id: str) -> Any:
        return {"configurable": {"thread_id": thread_id}}


def sqlite_checkpointer(path: Path) -> BaseCheckpointSaver[Any]:
    """Checkpointer SQLite pour la reprise HITL après redémarrage."""
    from langgraph.checkpoint.sqlite import SqliteSaver

    path.parent.mkdir(parents=True, exist_ok=True)
    return SqliteSaver(sqlite3.connect(str(path), check_same_thread=False))


class FinGuardSystem:
    """Runtime principal et sandboxes de scénarios, sur la même preuve et le même kill switch."""

    def __init__(
        self, shared: SharedServices, main_checkpointer: BaseCheckpointSaver[Any] | None = None
    ) -> None:
        self.shared = shared
        self.main = GraphRuntime(runtime_id=MAIN_RUNTIME_ID, shared=shared, checkpointer=main_checkpointer)
        self._sandboxes: OrderedDict[str, GraphRuntime] = OrderedDict()
        self._lock = threading.Lock()

    def new_sandbox(self, label: str) -> GraphRuntime:
        """Crée un runtime isolé (mandats, disjoncteur, marché neufs) pour un scénario."""
        runtime = GraphRuntime(runtime_id=f"scenario:{label}:{uuid.uuid4().hex[:6]}", shared=self.shared)
        with self._lock:
            self._sandboxes[runtime.runtime_id] = runtime
            while len(self._sandboxes) > MAX_SANDBOXES:
                _, oldest = self._sandboxes.popitem(last=False)
                oldest.close()
        return runtime

    def runtime(self, runtime_id: str) -> GraphRuntime:
        """Runtime par identifiant."""
        if runtime_id == MAIN_RUNTIME_ID:
            return self.main
        with self._lock:
            runtime = self._sandboxes.get(runtime_id)
        if runtime is None:
            raise NotFoundError(f"Runtime inconnu : {runtime_id}", rule_id="RUNTIME_UNKNOWN")
        return runtime

    def runtimes(self) -> list[GraphRuntime]:
        """Tous les runtimes actifs."""
        with self._lock:
            return [self.main, *self._sandboxes.values()]

    def resolve_thread(self, thread_id: str) -> GraphRuntime:
        """Runtime qui porte un thread donné."""
        with self._lock:
            sandboxes = list(self._sandboxes.values())
        for runtime in sandboxes:
            if runtime.has_thread(thread_id):
                return runtime
        if self.main.has_thread(thread_id):
            return self.main
        raise NotFoundError(f"Thread inconnu : {thread_id}", rule_id="THREAD_UNKNOWN")
