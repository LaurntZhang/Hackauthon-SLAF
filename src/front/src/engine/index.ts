/*
 * Moteur de démonstration : mêmes fichiers que le front HTML (src/api/static/js), copiés dans legacy/.
 * L'ordre des imports compte : chaque fichier enrichit globalThis.ManAgent.
 * Mode par défaut : simulation locale hors ligne. Mode live : EXPO_PUBLIC_MANAGENT_API=https://… (web, SSE).
 */
import './legacy/crypto';
import './legacy/config';
import './legacy/simulator';
import './legacy/store';
import './legacy/transport';

import { LIVE_ASSETS } from './liveCatalog';
import type { Decision, Store, Transport } from './types';

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

export const store: Store = new MA.Store();

const apiBase = process.env.EXPO_PUBLIC_MANAGENT_API;
if (apiBase) Object.assign(C.ASSETS, LIVE_ASSETS);

class UnsupportedLiveTransport implements Transport {
  mode = 'live' as const;
  private readonly message = 'Le mode live nécessite Expo Web avec EventSource.';

  constructor(private readonly liveStore: Store) {
    this.liveStore.setConnection('mode live indisponible sur cette plateforme');
  }

  private unavailable(): never { throw new Error(this.message); }
  async runScenario(_key: string): Promise<unknown> { return this.unavailable(); }
  async submitObjective(_spec: { asset: string; side: string; amount: number; counterparty: string }): Promise<unknown> { return this.unavailable(); }
  async decide(_threadId: string, _decision: Decision): Promise<{ ok: boolean; error?: string }> { return this.unavailable(); }
  async requestReport(_threadId: string): Promise<unknown> { return this.unavailable(); }
  async killSwitch(_engage: boolean): Promise<unknown> { return this.unavailable(); }
  async liftQuarantine(_agentId: string): Promise<unknown> { return this.unavailable(); }
  async resetBreaker(): Promise<unknown> { return this.unavailable(); }
  async verify(): Promise<unknown> { return this.unavailable(); }
  async tamper(): Promise<unknown> { return this.unavailable(); }
  async restore(): Promise<unknown> { return this.unavailable(); }
  async reset(): Promise<void> { return this.unavailable(); }
  setFast(_fast: boolean): void {}
}

const normalizedApiBase = apiBase ? apiBase.replace(/\/$/, '') : null;
const hasEventSource = typeof (globalThis as any).EventSource === 'function';
export const transport: Transport = normalizedApiBase
  ? (hasEventSource ? new MA.LiveTransport(store, normalizedApiBase) : new UnsupportedLiveTransport(store))
  : new MA.SimTransport(store);
