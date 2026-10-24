/*
 * ManAgent — état de la tour de contrôle, dérivé uniquement des AuditEvent reçus.
 * Même code en simulation et en live (SSE) : on ne lit jamais l'état interne du moteur.
 * Les événements invalides sont comptés et signalés, jamais ignorés en silence.
 */
(function (root) {
  'use strict';
  const MA = (root.ManAgent = root.ManAgent || {});
  const C = MA.config;
  const fmt = MA.fmt;
  const HEX64 = /^[0-9a-f]{64}$/;
  const OUTCOME_STATE = { ALLOW: 'pass', ESCALATE: 'escalate', BLOCK: 'block' };
  const TX_ACTIONS = new Set([
    'firewall.scanned', 'intent.proposed', 'policy.evaluated', 'judge.voted', 'quorum.decided', 'hitl.requested',
    'hitl.decided', 'authorization.created', 'authorization.revoked', 'order.prepared', 'integrity.checked',
    'risk.checked', 'execution.filled', 'transaction.blocked',
  ]);
  const STAGE_LABELS = { policy: 'Policy Engine', hitl: 'rejet humain', integrity: 'Integrity Engine', governor: 'Risk Governor' };
  const FAVORABLE = ['ALLOW', 'approve', 'approved', 'ok', 'filled'];
  const ADVERSE = ['BLOCK', 'veto', 'rejected', 'penalty', 'quarantined', 'blocked', 'revoked'];

  /** Retourne la raison du rejet d'un événement, ou null s'il respecte le contrat AuditEvent. */
  function validate(e) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return 'événement non objet';
    for (const key of ['timestamp', 'correlation_id', 'agent_id', 'action', 'status', 'policy_version']) {
      if (typeof e[key] !== 'string' || !e[key]) return `champ ${key} manquant ou vide`;
    }
    if (Number.isNaN(Date.parse(e.timestamp))) return 'timestamp illisible';
    if (!HEX64.test(e.hash || '') || !HEX64.test(e.prev_hash || '')) return 'hash ou prev_hash invalide';
    if (e.context !== undefined && (e.context === null || typeof e.context !== 'object' || Array.isArray(e.context))) {
      return 'context invalide';
    }
    if (e.reasoning !== undefined && e.reasoning !== null && typeof e.reasoning !== 'string') return 'reasoning invalide';
    return null;
  }

  function effectOf(status) {
    if (FAVORABLE.includes(status)) return 'favorable';
    if (ADVERSE.includes(status)) return 'adverse';
    return 'escalate';
  }

  class Store {
    constructor() {
      this.listeners = new Set();
      this.dirty = new Set();
      this.dirtyRuns = new Set();
      this.scheduled = false;
      this.connection = null;
      this.reset();
    }

    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    mark(...scopes) {
      for (const scope of scopes) this.dirty.add(scope);
      if (this.scheduled) return;
      this.scheduled = true;
      const schedule = typeof root.requestAnimationFrame === 'function' ? root.requestAnimationFrame.bind(root) : (fn) => setTimeout(fn, 16);
      schedule(() => this.flush());
    }

    flush() {
      this.scheduled = false;
      const scopes = new Set(this.dirty);
      const runs = new Set(this.dirtyRuns);
      this.dirty.clear();
      this.dirtyRuns.clear();
      for (const fn of this.listeners) fn(scopes, runs);
    }

    reset() {
      const L = C.LIMITS;
      this.events = [];
      this.invalid = 0;
      this.lastInvalid = null;
      this.runs = new Map();
      this.runOrder = [];
      this.txs = new Map();
      this.agents = {};
      for (const agent of C.AGENTS) this.agents[agent.id] = { trust: 100, quarantined: false };
      this.risk = {
        daily: 0, dailyLimit: L.dailyBudget, humanApproved: 0, freq: 0, freqLimit: L.freqPerMin,
        rejects: 0, rejectLimit: L.maxConsecutiveRejects, breaker: 'closed', lastCheck: null,
      };
      this.kill = { global: false, by: null, at: null };
      this.alerts = [];
      this.pending = null;
      this.verification = { state: 'unknown' };
      this.tampered = null;
      this.overrides = new Map();
      this.lastCorr = null;
      this.mark('all');
    }

    setConnection(text) {
      this.connection = text;
      this.mark('meta');
    }

    reportInvalid(problem, raw) {
      this.invalid += 1;
      this.lastInvalid = problem;
      console.warn('[ManAgent] événement rejeté :', problem, raw);
      this.mark('meta');
    }

    /** Ingère un AuditEvent ; retourne false s'il est rejeté. */
    ingest(event) {
      const problem = validate(event);
      if (problem) {
        this.reportInvalid(problem, event);
        return false;
      }
      const index = this.events.length;
      this.events.push(event);
      this.apply(event, index);
      this.mark('events');
      return true;
    }

    apply(e, index) {
      const ctx = e.context || {};
      const runId = ctx.run_id || `run:${e.correlation_id}`;
      let run = this.runs.get(runId);
      if (!run) {
        run = {
          id: runId, title: ctx.run_title || runId, scenario: ctx.scenario || null, compact: Boolean(ctx.compact),
          startedAt: e.timestamp, items: [], txIds: [], completed: null, expected: null, input: null,
        };
        this.runs.set(runId, run);
        this.runOrder.push(runId);
      }
      run.items.push(index);
      this.dirtyRuns.add(runId);

      let tx = null;
      if (e.correlation_id !== runId) {
        tx = this.txs.get(e.correlation_id);
        if (!tx) {
          tx = {
            corr: e.correlation_id, runId, items: [], path: {}, verdicts: [], intent: null, assetLabel: null, tool: null,
            firewall: null, policy: null, quorum: null, hitl: null, human: null, auth: null, order: null,
            integrity: null, risk: null, final: null, startedAt: e.timestamp,
          };
          this.txs.set(tx.corr, tx);
          run.txIds.push(tx.corr);
        }
        tx.items.push(index);
        this.lastCorr = tx.corr;
        this.mark('tx', 'kpis');
      }
      if (TX_ACTIONS.has(e.action) && !tx) {
        this.reportInvalid(`action ${e.action} sans correlation_id de transaction`, e);
        return;
      }

      switch (e.action) {
        case 'scenario.started':
          run.expected = ctx.expected || null;
          run.input = ctx.input || null;
          this.mark('scenarios');
          break;
        case 'scenario.completed':
          run.completed = { matched: Boolean(ctx.matched), expected: ctx.expected, obtained: ctx.obtained, at: e.timestamp };
          this.mark('scenarios');
          break;
        case 'firewall.scanned':
          tx.firewall = ctx.untrusted || null;
          tx.path.firewall = e.status === 'flagged' ? 'warn' : 'pass';
          break;
        case 'intent.proposed':
          tx.intent = ctx.intent || null;
          tx.assetLabel = ctx.asset_label || (tx.intent ? fmt.assetLabel(tx.intent.asset) : null);
          tx.tool = ctx.requested_tool || null;
          tx.path.proposer = 'pass';
          break;
        case 'policy.evaluated':
          tx.policy = ctx.policy || { outcome: e.status, triggered_rules: ctx.triggered_rules || [] };
          tx.path.policy = OUTCOME_STATE[e.status] || 'pass';
          break;
        case 'judge.voted':
          tx.verdicts.push(ctx.verdict || { judge_id: e.agent_id, vote: e.status, justification: e.reasoning, rule_ids: [], confidence: null });
          tx.path.judges = tx.verdicts.some((v) => v.vote !== 'approve') ? 'escalate' : 'pass';
          break;
        case 'quorum.decided':
          tx.quorum = ctx.quorum || { outcome: e.status };
          tx.path.quorum = OUTCOME_STATE[e.status] || 'pass';
          break;
        case 'hitl.requested':
          tx.hitl = { card: ctx.card || null, status: 'pending', requestedAt: e.timestamp };
          tx.path.hitl = 'active';
          if (ctx.card) this.pending = { thread_id: ctx.card.thread_id, corr: tx.corr, card: ctx.card };
          this.mark('pending');
          break;
        case 'hitl.decided': {
          const decision = ctx.decision || {};
          tx.human = decision;
          if (tx.hitl) tx.hitl.status = e.status;
          tx.path.hitl = e.status === 'approved' ? 'pass' : 'block';
          if (this.pending && this.pending.thread_id === decision.thread_id) this.pending = null;
          this.mark('pending');
          break;
        }
        case 'authorization.created':
          tx.auth = ctx.authorization || null;
          tx.path.authorize = 'pass';
          break;
        case 'authorization.revoked':
          if (tx.auth) tx.auth.revoked = true;
          tx.path.authorize = 'revoked';
          break;
        case 'order.prepared':
          tx.order = ctx.order || null;
          tx.path.executor = 'pass';
          break;
        case 'integrity.checked':
          tx.integrity = { ...ctx, ok: e.status === 'ok' };
          tx.path.integrity = e.status === 'ok' ? 'pass' : 'block';
          break;
        case 'risk.checked':
          tx.risk = ctx.snapshot || null;
          tx.path.governor = e.status === 'ok' ? 'pass' : 'block';
          if (ctx.snapshot) {
            this.risk.daily = ctx.snapshot.daily_cumul;
            this.risk.freq = ctx.snapshot.orders_last_minute;
            if (typeof ctx.snapshot.human_approved_cumul === 'number') this.risk.humanApproved = ctx.snapshot.human_approved_cumul;
            this.risk.lastCheck = e.timestamp;
          }
          this.mark('risk');
          break;
        case 'execution.filled':
          tx.final = { status: 'filled', at: e.timestamp };
          tx.path.gateway = 'pass';
          tx.path.market = 'pass';
          this.risk.rejects = 0;
          this.mark('risk');
          break;
        case 'transaction.blocked':
          tx.final = { status: 'blocked', stage: ctx.stage, rules: ctx.triggered_rules || [], reason: e.reasoning, at: e.timestamp };
          if (typeof ctx.consecutive_rejects === 'number') this.risk.rejects = ctx.consecutive_rejects;
          this.mark('risk');
          break;
        case 'trust.updated':
          if (this.agents[ctx.agent]) this.agents[ctx.agent].trust = ctx.after;
          this.mark('agents');
          break;
        case 'agent.quarantined':
          if (this.agents[ctx.agent]) this.agents[ctx.agent].quarantined = true;
          this.mark('agents', 'scenarios');
          break;
        case 'agent.released':
          if (this.agents[ctx.agent]) this.agents[ctx.agent].quarantined = false;
          this.mark('agents', 'scenarios');
          break;
        case 'supervisor.alert':
          this.alerts.unshift({
            index, severity: ctx.severity || 'warning', title: ctx.title || 'Alerte', text: e.reasoning || '',
            at: e.timestamp, corr: tx ? tx.corr : null,
          });
          this.mark('alerts');
          break;
        case 'breaker.opened':
          this.risk.breaker = 'open';
          this.mark('risk', 'scenarios');
          break;
        case 'breaker.reset':
          this.risk.breaker = 'closed';
          this.risk.rejects = 0;
          this.risk.freq = 0;
          this.mark('risk', 'scenarios');
          break;
        case 'killswitch.engaged':
          this.kill = { global: true, by: e.agent_id, at: e.timestamp };
          this.mark('kill', 'risk', 'scenarios');
          break;
        case 'killswitch.released':
          this.kill = { global: false, by: e.agent_id, at: e.timestamp };
          this.mark('kill', 'risk', 'scenarios');
          break;
        default:
          break;
      }
    }

    /**
     * Reflète une altération du fichier audit.jsonl. Le fil en direct garde ce qui a été reçu ;
     * seule la vue « fichier » du journal (journalLine) montre la ligne réécrite.
     */
    applyTamper(info) {
      if (!info || !this.events[info.index]) return;
      if (info.restored) {
        this.overrides.delete(info.index);
        this.tampered = null;
      } else {
        this.overrides.set(info.index, info.event);
        this.tampered = { index: info.index, field: info.field, before: info.before, after: info.after };
      }
      this.mark('audit');
    }

    /** Ligne i telle qu'elle figure dans le fichier d'audit (éventuellement altérée). */
    journalLine(i) {
      return this.overrides.get(i) || this.events[i];
    }

    setVerification(result) {
      this.verification = { state: result.valid ? 'valid' : 'broken', ...result, at: new Date().toISOString() };
      this.mark('audit');
    }

    /** Indique si un événement appartient au fil principal (sinon : sous-fil technique). */
    isMain(e) {
      if (e.action === 'trust.updated') return e.status !== 'ok';
      const meta = C.ACTIONS[e.action];
      if (!meta) return true;
      if (meta.level === 'main') return true;
      return C.NOTABLE_STATUSES.includes(e.status);
    }

    kpis() {
      const out = { total: this.txs.size, decided: 0, filled: 0, blocked: 0, escalated: 0, pending: 0, byStage: {} };
      for (const tx of this.txs.values()) {
        if (tx.hitl) out.escalated += 1;
        if (!tx.final) {
          if (tx.hitl && tx.hitl.status === 'pending') out.pending += 1;
          continue;
        }
        out.decided += 1;
        if (tx.final.status === 'filled') out.filled += 1;
        else {
          out.blocked += 1;
          out.byStage[tx.final.stage] = (out.byStage[tx.final.stage] || 0) + 1;
        }
      }
      out.alerts = this.alerts.length;
      out.critical = this.alerts.filter((a) => a.severity === 'critical').length;
      return out;
    }

    /** État de chaque nœud du graphe pour une transaction. */
    nodeStates(tx) {
      const ids = C.NODES.map((n) => n.id);
      const states = {};
      for (const id of ids) states[id] = { state: tx.path[id] || 'idle', sub: '' };
      const hitlNotNeeded = !tx.hitl && (tx.quorum || tx.final);
      if (hitlNotNeeded) states.hitl.state = 'skipped';
      if (tx.final) {
        for (const id of ids) if (!tx.path[id]) states[id].state = 'skipped';
      } else if (!(tx.hitl && tx.hitl.status === 'pending')) {
        let last = -1;
        ids.forEach((id, i) => {
          if (tx.path[id]) last = i;
        });
        const next = ids.slice(last + 1).find((id) => states[id].state !== 'skipped');
        if (next) states[next].state = 'active';
      }

      const intent = tx.intent;
      if (tx.path.firewall) states.firewall.sub = tx.path.firewall === 'warn' ? 'signalé' : tx.firewall ? 'assaini' : 'rien à filtrer';
      if (intent) states.proposer.sub = fmt.eur(intent.amount);
      if (tx.policy) states.policy.sub = tx.policy.outcome;
      if (tx.quorum) {
        states.quorum.sub = tx.quorum.outcome === 'ESCALATE' ? 'ESCALATE' : tx.quorum.mode === 'weighted' ? `ratio ${fmt.dec(tx.quorum.ratio)}` : `${tx.quorum.approvals}/${tx.quorum.required}`;
      }
      if (tx.hitl) states.hitl.sub = { pending: 'en attente', approved: 'signée', rejected: 'rejetée' }[tx.hitl.status] || '';
      else if (states.hitl.state === 'skipped') states.hitl.sub = 'non requise';
      if (tx.auth) states.authorize.sub = tx.auth.revoked ? 'révoquée' : tx.auth.auth_id;
      if (tx.order) states.executor.sub = tx.order.order_id;
      if (tx.integrity) states.integrity.sub = tx.integrity.ok ? 'hash =' : 'hash ≠';
      if (tx.path.governor) {
        if (tx.path.governor === 'block') states.governor.sub = tx.final && tx.final.rules ? tx.final.rules.join(' ') : 'BLOCK';
        else states.governor.sub = tx.risk ? `${tx.risk.orders_last_minute}/${tx.risk.freq_limit} /min` : 'OK';
      }
      if (tx.path.gateway) states.gateway.sub = 'transmis';
      if (tx.path.market) states.market.sub = 'exécuté';
      return states;
    }

    /** Construit la fiche XAI (DecisionRecord) à partir des seules lignes d'audit de la transaction. */
    decisionRecord(corr) {
      const tx = this.txs.get(corr);
      if (!tx) return null;
      const intent = tx.intent;
      const what = intent ? `${fmt.side(intent.side)} de ${fmt.eur(intent.amount)} de ${tx.assetLabel}` : corr;
      const events = tx.items.map((i) => ({ e: this.events[i], line: i + 1 }));

      let status;
      let summary;
      if (!tx.final) {
        const pending = tx.hitl && tx.hitl.status === 'pending';
        status = pending ? 'pending' : 'running';
        summary = pending
          ? `${what} : en attente de validation humaine (${(tx.hitl.card && tx.hitl.card.reasons ? tx.hitl.card.reasons : []).join(', ')}).`
          : `${what} : traitement en cours.`;
      } else if (tx.final.status === 'filled') {
        status = 'filled';
        summary = tx.hitl
          ? `${what} exécuté après validation humaine signée par ${fmt.actor('human:' + (tx.human ? tx.human.approver_id : ''))}.`
          : `${what} exécuté sans intervention humaine : règles respectées et quorum atteint.`;
      } else {
        status = 'blocked';
        const cause = events.filter(({ e }) => ['BLOCK', 'rejected'].includes(e.status)).pop();
        summary = `${what} bloqué par ${STAGE_LABELS[tx.final.stage] || tx.final.stage}. ${cause ? cause.e.reasoning : tx.final.reason}`;
      }

      const FACTOR_ACTIONS = ['firewall.scanned', 'policy.evaluated', 'judge.voted', 'quorum.decided', 'hitl.decided', 'integrity.checked', 'risk.checked', 'trust.updated', 'agent.quarantined'];
      const factors = events
        .filter(({ e }) => FACTOR_ACTIONS.includes(e.action))
        .filter(({ e }) => !(e.action === 'firewall.scanned' && e.status === 'ok'))
        .filter(({ e }) => !(e.action === 'trust.updated' && e.status === 'ok'))
        .map(({ e, line }) => ({
          actor: fmt.actor(e.agent_id),
          kind: (C.ACTORS[e.agent_id] || {}).kind || 'control',
          status: e.status,
          effect: effectOf(e.status),
          text: e.reasoning,
          line,
          hash: e.hash,
        }));

      const ruleIds = new Set();
      for (const { e } of events) for (const r of (e.context && e.context.triggered_rules) || []) ruleIds.add(r);
      for (const v of tx.verdicts) for (const r of v.rule_ids || []) ruleIds.add(r);
      const rules = [...ruleIds].map((id) => ({ id, label: fmt.rule(id) }));

      const uncertainties = [];
      if (intent) uncertainties.push(`Confiance déclarée par le Proposer : ${fmt.dec(intent.confidence)}.`);
      for (const v of tx.verdicts) {
        if (typeof v.confidence === 'number' && v.confidence < 0.9) uncertainties.push(`Confiance du ${fmt.actor(v.judge_id)} : ${fmt.dec(v.confidence)}.`);
      }
      if (tx.firewall && tx.firewall.flagged) {
        uncertainties.push(`Source externe « ${tx.firewall.source} » signalée par le firewall (${tx.firewall.flags.join(', ')}).`);
      }
      if (intent && (!intent.data_sources || !intent.data_sources.length)) uncertainties.push('Aucune source de données citée par le Proposer.');
      uncertainties.push('Agents en mode script (FINGUARD_LLM=off) : votes produits par des règles. Les justifications des agents sont déclaratives ; seules les règles FinGuard sont déterministes.');
      uncertainties.push('Marché, prix et portefeuille simulés (données synthétiques).');

      const states = this.nodeStates(tx);
      const path = C.NODES.map((n) => ({ id: n.id, label: n.label, kind: n.kind, state: states[n.id].state, sub: states[n.id].sub }));
      const proofs = [];
      const intentHash = (tx.auth && tx.auth.intent_hash) || (tx.hitl && tx.hitl.card && tx.hitl.card.intent_hash);
      if (intentHash) proofs.push({ label: "Hash de l'intention", value: intentHash });
      if (tx.auth) proofs.push({ label: 'Autorisation', value: `${tx.auth.auth_id}${tx.auth.revoked ? ' (révoquée)' : ''}` });
      if (tx.integrity && tx.integrity.actual_hash) proofs.push({ label: "Hash de l'ordre", value: tx.integrity.actual_hash });
      if (tx.human && tx.human.signature) proofs.push({ label: 'Signature HMAC du gérant', value: tx.human.signature });
      if (events.length) proofs.push({ label: "Lignes d'audit", value: `#${events[0].line} à #${events[events.length - 1].line} (${events.length} lignes)` });

      const redactions = [];
      if (tx.firewall && tx.firewall.flags && tx.firewall.flags.includes('iban_detected')) {
        redactions.push('IBAN masqué : la convention de journalisation interdit de conserver un IBAN.');
      }

      return {
        correlation_id: corr, status, summary, factors, votes: tx.verdicts, rules, uncertainties, path, proofs, redactions,
        policy_version: C.POLICY_VERSION,
      };
    }
  }

  MA.Store = Store;
  MA.validateEvent = validate;
})(typeof window !== 'undefined' ? window : globalThis);
