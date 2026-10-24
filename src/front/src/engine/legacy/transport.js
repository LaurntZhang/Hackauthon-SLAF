/*
 * ManAgent — transports de la tour de contrôle.
 *
 * SimTransport : simulateur local (défaut, hors ligne).
 * LiveTransport : API FastAPI du cadrage §8 (lot L4), activé par ?mode=live.
 *   POST /transactions · POST /approvals/{thread_id} · POST /kill-switch · POST /scenarios/{name}
 *   GET /events (SSE d'AuditEvent) · GET /audit/verify · GET /decisions/{correlation_id}
 * Le dashboard n'a aucun droit propre : il relaie des décisions humaines que l'API vérifie.
 */
(function (root) {
  'use strict';
  const MA = (root.ManAgent = root.ManAgent || {});

  class SimTransport {
    constructor(store) {
      this.mode = 'sim';
      this.store = store;
      this.sim = new MA.Simulator({
        onEvent: (event) => store.ingest(event),
        onTamper: (info) => store.applyTamper(info),
      });
    }

    get busy() {
      return this.sim.busy;
    }

    runScenario(key) {
      return this.sim.runScenario(key);
    }

    submitObjective(spec) {
      return this.sim.submitObjective(spec);
    }

    async decide(threadId, decision) {
      return this.sim.decideHitl(threadId, decision);
    }

    async requestReport(threadId) {
      return this.sim.requestReport(threadId);
    }

    async killSwitch(engage) {
      if (engage) this.sim.engageKillSwitch();
      else this.sim.releaseKillSwitch();
    }

    async liftQuarantine(agentId) {
      this.sim.liftQuarantine(agentId);
    }

    async resetBreaker() {
      this.sim.resetBreaker();
    }

    async verify() {
      return this.sim.verifyChain();
    }

    async tamper() {
      return this.sim.tamperAudit();
    }

    async restore() {
      return this.sim.restoreAudit();
    }

    async reset() {
      this.sim.reset();
      this.store.reset();
    }

    setFast(fast) {
      this.sim.setFast(fast);
    }
  }

  class LiveTransport {
    constructor(store, base = '') {
      this.mode = 'live';
      this.store = store;
      this.base = base;
      this.busy = false;
      this.runtimeId = 'main';
      this.ready = typeof window === 'undefined' ? Promise.resolve() : this.hydrate().then(() => this.connect());
      this.ready.catch(() => {});
      this.pendingPoll = typeof window === 'undefined' ? null : setInterval(() => this.syncPending(), 2000);
    }

    async syncPending() {
      try {
        const pending = await this.request('GET', '/approvals');
        const card = pending[0] ? this.normalizeCard(pending[0]) : null;
        if (card?.runtime_id) this.runtimeId = card.runtime_id;
        const current = this.store.pending;
        if ((current && current.thread_id) !== (card && card.thread_id)) {
          this.store.pending = card ? { thread_id: card.thread_id, corr: card.correlation_id, card } : null;
          if (card) {
            const tx = this.store.txs.get(card.correlation_id);
            if (tx) tx.hitl = { card, status: 'pending', requestedAt: card.requested_at };
          }
          this.pendingThreadId = card && card.thread_id;
          this.store.mark('pending');
        }
      } catch (err) {
        console.warn('[ManAgent] synchronisation HITL indisponible', err);
      }
    }

    async hydrate() {
      try {
        const [controls, rawPending, audit, events] = await Promise.all([
          this.request('GET', '/controls/state'),
          this.request('GET', '/approvals'),
          this.request('GET', '/audit/verify'),
          this.request('GET', '/audit/events?limit=5000'),
        ]);
        const pending = rawPending.map(card => this.normalizeCard(card));
        this.store.reset();
        this.pendingThreadId = pending[0] && pending[0].thread_id;
        if (pending[0]?.runtime_id) this.runtimeId = pending[0].runtime_id;
        for (const sourceEvent of events) {
          const event = this.normalizeEvent(sourceEvent);
          if (event.action === 'hitl.requested') {
            const card = pending.find((item) => item.correlation_id === event.correlation_id);
            if (card) {
              event.context.card = this.normalizeCard(card, event.timestamp);
              this.pendingThreadId = card.thread_id;
            }
          }
          this.store.ingest(event);
        }
        this.store.kill = {
          global: controls.kill_switch.global_engaged,
          by: controls.kill_switch.global_stop && controls.kill_switch.global_stop.actor_id,
          at: controls.kill_switch.global_stop && controls.kill_switch.global_stop.engaged_at,
        };
        this.store.risk.breaker = controls.circuit_breaker.open ? 'open' : 'closed';
        const hasScenarioRiskSnapshot = this.store.events.some((event) => event.action === 'risk.checked' && event.context?.snapshot);
        if (!hasScenarioRiskSnapshot) this.store.risk.freq = controls.circuit_breaker.orders_last_minute;
        this.store.risk.rejects = controls.circuit_breaker.consecutive_rejections;
        this.store.agents = Object.fromEntries(controls.agents.map((agent) => [agent.agent_id, {
          trust: agent.trust_score, quarantined: agent.quarantined,
        }]));
        this.store.setVerification(audit);
        if (pending.length) {
          const card = this.normalizeCard(pending[0]);
          this.pendingThreadId = card.thread_id;
          this.store.pending = { thread_id: card.thread_id, corr: card.correlation_id, card };
        }
        const latest = [...events].reverse().find(e => e.runtime_id);
        this.runtimeId = pending[0]?.runtime_id || latest?.runtime_id || 'main';
        await this.syncControls();
        this.store.mark('all');
      } catch (err) {
        this.store.setConnection('État initial indisponible : ' + err.message);
        throw err;
      }
    }

    connect() {
      if (typeof window === 'undefined') return;
      if (!globalThis.EventSource) { this.store.setConnection('SSE indisponible : utilisez le web'); return; }
      this.source = new globalThis.EventSource(this.base + '/events?replay=true');
      this.source.onopen = () => this.store.setConnection('connecté');
      this.source.onerror = () => this.store.setConnection('reconnexion…');
      const actions = [
        'transaction_received', 'transaction_completed', 'content_flagged', 'content_inspected',
        'intent_proposed', 'policy_evaluated', 'judge_verdict',
        'quorum_decided', 'hitl_requested', 'human_decision', 'authorization_issued', 'order_prepared',
        'integrity_checked', 'risk_checked', 'circuit_breaker_opened', 'execution_blocked', 'order_executed',
        'trust_updated', 'agent_quarantined', 'kill_switch_engaged', 'kill_switch_released',
        'circuit_breaker_rearmed', 'quarantine_released', 'control_denied', 'supervisor_alert',
        'llm_fallback', 'intent_not_produced', 'hitl_signature_rejected', 'observability_degraded',
      ];
      const receive = async (message) => {
        let parsed;
        try {
          parsed = JSON.parse(message.data);
        } catch (err) {
          if (err instanceof SyntaxError) {
            this.store.reportInvalid('JSON illisible sur le flux SSE', message.data);
            return;
          }
          throw err;
        }
        if (this.store.eventHashes.has(parsed.hash)) return;
        const event = this.normalizeEvent(parsed);
        if (event.action === 'hitl.requested') {
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const pending = await this.request('GET', '/approvals');
              const card = pending.find((item) => item.correlation_id === event.correlation_id);
              if (card) {
                event.context.card = this.normalizeCard(card, event.timestamp);
                this.pendingThreadId = card.thread_id;
                break;
              }
            } catch (err) {
              console.warn('[ManAgent] approbations en attente indisponibles', err);
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        this.store.ingest(event);
        if (parsed.action === 'transaction_completed') {
          try {
            const audit = await this.request('GET', '/audit/verify');
            this.store.setVerification(audit);
          } catch (err) {
            console.warn('[ManAgent] vérification du journal indisponible', err);
          }
        }
        if (event.action === 'hitl.decided') this.pendingThreadId = null;
      };
      let queue = Promise.resolve();
      const enqueue = (message) => { queue = queue.then(() => receive(message)).catch((err) => this.store.setConnection(err.message)); };
      for (const action of actions) this.source.addEventListener(action, enqueue);
      this.source.onmessage = enqueue;
    }

    dispose() {
      clearInterval(this.pendingPoll);
      this.source?.close();
    }

    normalizeCard(card, requestedAt) {
      const timestamp = requestedAt || this.store.events.find(e => e.action === 'hitl.requested' && e.correlation_id === card.correlation_id)?.timestamp;
      return { ...card, asset_label: MA.fmt.assetLabel(card.intent.asset), requested_at: timestamp || null };
    }

    normalizeEvent(parsed) {
      const aliases = {
        kill_switch_engaged: 'killswitch.engaged', kill_switch_released: 'killswitch.released',
        circuit_breaker_rearmed: 'breaker.reset', quarantine_released: 'agent.released', supervisor_alert: 'supervisor.alert',
        transaction_received: 'transaction.received', transaction_completed: 'transaction.completed',
        content_flagged: 'firewall.scanned', content_inspected: 'firewall.scanned', intent_proposed: 'intent.proposed',
        policy_evaluated: 'policy.evaluated', judge_verdict: 'judge.voted', quorum_decided: 'quorum.decided',
        hitl_requested: 'hitl.requested', human_decision: 'hitl.decided', authorization_issued: 'authorization.created',
        order_prepared: 'order.prepared', integrity_checked: 'integrity.checked', risk_checked: 'risk.checked',
        circuit_breaker_opened: 'breaker.opened', execution_blocked: 'transaction.blocked',
        order_executed: 'execution.filled', trust_updated: 'trust.updated', agent_quarantined: 'agent.quarantined',
      };
      const event = { ...parsed, rawEvent: parsed, action: aliases[parsed.action] || parsed.action, context: { ...(parsed.context || {}) } };
      if (event.action === 'transaction.completed' && ['blocked', 'rejected', 'reported'].includes(event.status)) {
        const tx = this.store.txs.get(event.correlation_id);
        event.action = 'transaction.blocked';
        event.context.stage = tx?.policy?.outcome === 'BLOCK' ? 'policy' : tx?.hitl?.status === 'rejected' ? 'hitl' : tx?.integrity?.ok === false ? 'integrity' : 'governor';
        event.context.triggered_rules = tx?.policy?.triggered_rules || [];
      }
      if (event.action === 'policy.evaluated') {
        event.status = ({ allow: 'ALLOW', escalate: 'ESCALATE', block: 'BLOCK' })[event.status] || event.status;
        event.context.triggered_rules = event.context.rules || [];
      }
      if (event.action === 'quorum.decided') {
        const votes = this.store.txs.get(event.correlation_id)?.verdicts.length || 0;
        const approvals = event.context.approvals ?? 0;
        const required = event.context.required ?? event.context.required_approvals ?? votes;
        const ratio = event.context.ratio ?? event.context.weighted_ratio;
        event.status = ({ allow: 'ALLOW', escalate: 'ESCALATE', block: 'BLOCK' })[event.status] || event.status;
        event.context.quorum = {
          outcome: event.status, approvals, required, required_approvals: required,
          ratio, weighted_ratio: ratio,
        };
      }
      if (event.action === 'trust.updated') {
        event.context.agent = event.context.agent_id;
        event.context.after = event.context.current;
      }
      if (event.action === 'agent.quarantined' || event.action === 'agent.released') event.context.agent = event.context.agent_id;
      if (event.action === 'risk.checked') {
        const source = event.context.snapshot || {};
        const fallback = this.deriveRiskSnapshot(event);
        const numeric = (value, fallbackValue) => {
          if (value === null || value === undefined || value === '') return fallbackValue;
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : fallbackValue;
        };
        event.context.snapshot = {
          ...fallback,
          ...source,
          daily_cumul: numeric(source.daily_cumul, fallback.daily_cumul),
          orders_last_minute: numeric(source.orders_last_minute, fallback.orders_last_minute),
          human_approved_cumul: numeric(source.human_approved_cumul, fallback.human_approved_cumul),
          freq_limit: numeric(source.freq_limit, fallback.freq_limit),
        };
      }
      if (event.action === 'authorization.created') event.context.authorization = event.context.authorization || event.context;
      if (event.action === 'hitl.decided') {
        event.status = event.status === 'approve' ? 'approved' : 'rejected';
        event.context.decision = { ...event.context, timestamp: event.timestamp, thread_id: event.context.thread_id || this.store.txs.get(event.correlation_id)?.hitl?.card?.thread_id || this.pendingThreadId };
      }
      return event;
    }

    deriveRiskSnapshot(current) {
      const events = [...this.store.events, current];
      const related = events.filter((event) => event.runtime_id === current.runtime_id);
      const intents = related.filter((event) => event.action === 'intent.proposed');
      const proposer = intents.find((event) => event.correlation_id === current.correlation_id)?.context?.intent?.proposer_id;
      const accepted = related.filter((event) => event.action === 'risk.checked' && event.status === 'ok');
      const orderFor = (correlationId) => related.find((event) => event.action === 'order.prepared' && event.correlation_id === correlationId)?.context?.order;
      const authorizationFor = (correlationId) => related.find((event) => event.action === 'authorization.created' && event.correlation_id === correlationId)?.context;
      const amountFor = (event) => Number(orderFor(event.correlation_id)?.amount || 0);
      const approvedFor = (event) => authorizationFor(event.correlation_id)?.human_approved === true;
      const currentTime = Date.parse(current.timestamp);
      const currentDay = Number.isFinite(currentTime) ? new Date(currentTime).toISOString().slice(0, 10) : null;
      const sameDay = accepted.filter((event) => {
        const time = Date.parse(event.timestamp);
        const eventProposer = intents.find((intent) => intent.correlation_id === event.correlation_id)?.context?.intent?.proposer_id;
        return currentDay && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === currentDay && (!proposer || eventProposer === proposer);
      });
      const inWindow = accepted.filter((event) => {
        const time = Date.parse(event.timestamp);
        return Number.isFinite(time) && Number.isFinite(currentTime) && time <= currentTime && time >= currentTime - 60_000;
      });
      return {
        daily_cumul: sameDay.reduce((sum, event) => sum + (approvedFor(event) ? 0 : amountFor(event)), 0),
        orders_last_minute: inWindow.length,
        human_approved_cumul: sameDay.reduce((sum, event) => sum + (approvedFor(event) ? amountFor(event) : 0), 0),
        freq_limit: this.store.risk.freqLimit,
      };
    }

    async request(method, path, body) {
      const response = await fetch(this.base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const type = response.headers.get('content-type') || '';
      const payload = type.includes('json') ? await response.json() : null;
      if (!response.ok) throw new Error(payload && (payload.detail || payload.message) ? JSON.stringify(payload.detail || payload.message) : `${method} ${path} : HTTP ${response.status}`);
      return payload;
    }

    runScenario(key) {
      return this.ready.then(async () => {
        const result = await this.request('POST', `/scenarios/${encodeURIComponent(key)}`);
        this.runtimeId = result.runtime_id;
        await this.syncPending();
        await this.syncControls();
        return result;
      });
    }

    submitObjective(spec) {
      const asset = MA.config.ASSETS[spec.asset];
      const counterparties = {
        'Banque Horizon BFI': 'BNP-SECURITIES-SIM',
        'Apex Capital Partners': 'SG-CIB-SIM',
        'Nexus Trading Ltd': 'EXANE-SIM',
      };
      return this.ready.then(async () => {
        const result = await this.request('POST', '/transactions', {
        proposal: {
          asset: spec.asset === 'OAT-10A' ? 'FR-OAT-2034' : spec.asset,
          asset_type: asset ? asset.type : 'equity',
          side: spec.side,
          amount: String(spec.amount),
          counterparty: counterparties[spec.counterparty] || spec.counterparty,
          rationale: `Opération initiée depuis la tour de contrôle (${spec.side} ${spec.asset}).`,
          confidence: 0.85,
        },
        });
        this.runtimeId = result.runtime_id;
        await this.syncPending();
        await this.syncControls();
        return result;
      });
    }

    async decide(threadId, decision) {
      try {
        const result = await this.request('POST', `/approvals/${encodeURIComponent(threadId)}/demo`, {
          action: decision.action,
          pin: decision.pin,
        });
        await this.syncPending();
        return { ok: true, signature: result.human_decision?.signature };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    async requestReport(threadId) {
      const card = await this.request('GET', `/approvals/${encodeURIComponent(threadId)}`);
      return this.request('GET', `/decisions/${encodeURIComponent(card.correlation_id)}`);
    }

    killSwitch(engage) {
      if (!engage) return this.demoControl('release_kill');
      return this.request('POST', '/kill-switch', {
        action: 'engage', scope: 'global', operator_id: 'risk_officer_1',
        reason: 'Arrêt demandé depuis la tour de contrôle.',
      });
    }

    liftQuarantine(agentId) {
      return this.demoControl('release_quarantine', agentId);
    }

    async resetBreaker() {
      return this.demoControl('rearm_breaker');
    }

    async demoControl(action, agentId) {
      const pin = window.prompt('Code opérateur de démonstration (4 chiffres) :');
      if (pin === null) return;
      const result = await this.request('POST', '/controls/demo', { action, pin, agent_id: agentId, runtime_id: this.runtimeId });
      await this.syncControls();
      return result;
    }

    async syncControls() {
      const state = await this.request('GET', '/controls/state?runtime_id=' + encodeURIComponent(this.runtimeId));
      this.store.kill = { global: state.kill_switch.global_engaged, by: state.kill_switch.global_stop?.actor_id, at: state.kill_switch.global_stop?.engaged_at };
      this.store.risk.breaker = state.circuit_breaker.open ? 'open' : 'closed';
      this.store.risk.freq = state.circuit_breaker.orders_last_minute;
      this.store.risk.rejects = state.circuit_breaker.consecutive_rejections;
      this.store.agents = Object.fromEntries(state.agents.map(a => [a.agent_id, { trust: a.trust_score, quarantined: a.quarantined }]));
      this.store.mark('all');
    }

    verify() {
      return this.request('GET', '/audit/verify');
    }

    tamper() {
      return this.runScenario('audit_tamper');
    }

    async restore() {
      throw new Error("La restauration du journal n'existe qu'en simulation.");
    }

    async reset() {
      throw new Error("La réinitialisation n'existe qu'en simulation.");
    }

    setFast() {}
  }

  MA.SimTransport = SimTransport;
  MA.LiveTransport = LiveTransport;
})(typeof window !== 'undefined' ? window : globalThis);
