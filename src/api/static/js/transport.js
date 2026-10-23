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
      this.connect();
    }

    connect() {
      this.source = new EventSource(this.base + '/events');
      this.source.onopen = () => this.store.setConnection('connecté');
      this.source.onerror = () => this.store.setConnection('reconnexion…');
      this.source.onmessage = (message) => {
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
        this.store.ingest(parsed);
      };
    }

    async request(method, path, body) {
      const response = await fetch(this.base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`${method} ${path} : HTTP ${response.status}`);
      const type = response.headers.get('content-type') || '';
      return type.includes('json') ? response.json() : null;
    }

    runScenario(key) {
      return this.request('POST', `/scenarios/${encodeURIComponent(key)}`);
    }

    submitObjective(spec) {
      return this.request('POST', '/transactions', spec);
    }

    async decide(threadId, decision) {
      try {
        await this.request('POST', `/approvals/${encodeURIComponent(threadId)}`, { thread_id: threadId, ...decision });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    async requestReport(threadId) {
      return this.request('POST', `/approvals/${encodeURIComponent(threadId)}`, { thread_id: threadId, action: 'report' });
    }

    killSwitch(engage) {
      return this.request('POST', '/kill-switch', { action: engage ? 'engage' : 'release' });
    }

    liftQuarantine(agentId) {
      return this.request('POST', '/kill-switch', { action: 'release', agent_id: agentId });
    }

    async resetBreaker() {
      throw new Error('Le cadrage §8 ne définit pas encore de route de réarmement du circuit breaker.');
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
