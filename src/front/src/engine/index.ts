/*
 * Moteur de démonstration : mêmes fichiers que le front HTML (src/api/static/js), copiés dans legacy/.
 * L'ordre des imports compte : chaque fichier enrichit globalThis.ManAgent.
 * Mode par défaut : simulation locale hors ligne. Mode live : EXPO_PUBLIC_MANAGENT_API=https://… (web, SSE).
 */
import './legacy/crypto';
import './legacy/config';
import './legacy/simulator';
import './legacy/store';

import type { AuditEvent, Decision, Store, Transport } from './types';

const MA: any = (globalThis as any).ManAgent;

export const C: any = MA.config;
export const fmt: {
  eur: (v: number) => string;
  pct: (r: number) => string;
  dec: (v: number) => string;
  time: (iso: string) => string;
  side: (s: string) => string;
  shortHash: (h?: string | null) => string;
  actor: (id: string) => string;
  assetLabel: (id: string) => string;
  rule: (id: string) => string;
} = MA.fmt;
export const cryptoLib: {
  sha256Hex: (t: string) => string;
  hmacHex: (k: string, m: string) => string;
  canonical: (v: unknown) => string;
  hitlPayload: (thread: string, action: string, approver: string, ts: string, hash: string) => string;
} = MA.crypto;
export const errors: { Aborted: any; BusyError: any; PreconditionError: any } = MA.errors;

class SimTransport implements Transport {
  mode = 'sim' as const;
  private sim: any;

  constructor(private store: any) {
    this.sim = new MA.Simulator({
      onEvent: (event: AuditEvent) => store.ingest(event),
      onTamper: (info: unknown) => store.applyTamper(info),
    });
  }

  runScenario(key: string) {
    return this.sim.runScenario(key);
  }
  submitObjective(spec: { asset: string; side: string; amount: number; counterparty: string }) {
    return this.sim.submitObjective(spec);
  }
  async decide(threadId: string, decision: Decision) {
    return this.sim.decideHitl(threadId, decision);
  }
  async requestReport(threadId: string) {
    return this.sim.requestReport(threadId);
  }
  async killSwitch(engage: boolean) {
    if (engage) this.sim.engageKillSwitch();
    else this.sim.releaseKillSwitch();
  }
  async liftQuarantine(agentId: string) {
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
  setFast(fast: boolean) {
    this.sim.setFast(fast);
  }
}

/** API FastAPI du cadrage §8. Le front n'a aucun droit propre : il relaie des décisions que l'API vérifie. */
class LiveTransport implements Transport {
  mode = 'live' as const;

  constructor(private store: any, private base: string) {
    const ES = (globalThis as any).EventSource;
    if (!ES) {
      store.reportInvalid('EventSource indisponible sur cette plateforme : utilisez la version web', null);
      return;
    }
    const source = new ES(`${base}/events`);
    source.onopen = () => store.setConnection('connecté');
    source.onerror = () => store.setConnection('reconnexion…');
    source.onmessage = (message: { data: string }) => {
      try {
        store.ingest(JSON.parse(message.data));
      } catch (err) {
        if (err instanceof SyntaxError) store.reportInvalid('JSON illisible sur le flux SSE', message.data);
        else throw err;
      }
    };
  }

  private async request(method: string, path: string, body?: unknown) {
    const response = await fetch(this.base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`${method} ${path} : HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    return type.includes('json') ? response.json() : null;
  }

  runScenario(key: string) {
    return this.request('POST', `/scenarios/${encodeURIComponent(key)}`);
  }
  submitObjective(spec: unknown) {
    return this.request('POST', '/transactions', spec);
  }
  async decide(threadId: string, decision: Decision) {
    try {
      await this.request('POST', `/approvals/${encodeURIComponent(threadId)}`, { thread_id: threadId, ...decision });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  requestReport(threadId: string) {
    return this.request('POST', `/approvals/${encodeURIComponent(threadId)}`, { thread_id: threadId, action: 'report' });
  }
  killSwitch(engage: boolean) {
    return this.request('POST', '/kill-switch', { action: engage ? 'engage' : 'release' });
  }
  liftQuarantine(agentId: string) {
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

export const store: Store = new MA.Store();

const apiBase = process.env.EXPO_PUBLIC_MANAGENT_API;
export const transport: Transport = apiBase ? new LiveTransport(store, apiBase.replace(/\/$/, '')) : new SimTransport(store);
