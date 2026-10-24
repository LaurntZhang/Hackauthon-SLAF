/*
 * Types de l'état dérivé des AuditEvent (miroir du contrat Pydantic côté API).
 * Le moteur (simulateur + store) reste en JavaScript, partagé avec le front HTML historique.
 */

export type AuditEvent = {
  rawEvent?: AuditEvent;
  timestamp: string;
  correlation_id: string;
  agent_id: string;
  action: string;
  status: string;
  reasoning?: string | null;
  policy_version: string;
  trust_score?: number | null;
  context?: Record<string, any>;
  prev_hash: string;
  hash: string;
};

export type Intent = {
  asset: string;
  asset_type?: string;
  side: 'buy' | 'sell';
  amount: number;
  counterparty: string;
  confidence: number;
  rationale: string;
  data_sources?: string[];
};

export type Verdict = {
  judge_id: string;
  vote: 'approve' | 'veto' | 'abstain' | string;
  justification: string;
  rule_ids?: string[];
  confidence?: number | null;
};

export type HitlCardData = {
  thread_id: string;
  correlation_id: string;
  intent: Intent;
  asset_label: string;
  requested_at: string | null;
  reasons?: string[];
  intent_hash: string;
  policy?: { outcome: string; explanation?: string; effective_max?: number; policy_version?: string };
  verdicts?: Verdict[];
  quorum?: { outcome: string; explanation?: string };
};

export type Tx = {
  corr: string;
  runId: string;
  items: number[];
  path: Record<string, string>;
  verdicts: Verdict[];
  intent: Intent | null;
  assetLabel: string | null;
  tool: string | null;
  firewall: { source: string; flagged: boolean; flags: string[] } | null;
  policy: { outcome: string; triggered_rules?: string[]; effective_max?: number; policy_version?: string } | null;
  quorum: { outcome: string; mode?: string; ratio?: number; approvals?: number; required?: number; triggered_rules?: string[] } | null;
  hitl: { card: HitlCardData | null; status: 'pending' | 'approved' | 'rejected' | string; requestedAt: string } | null;
  human: { approver_id?: string; timestamp?: string; signature?: string; thread_id?: string } | null;
  auth: { auth_id: string; intent_hash?: string; revoked?: boolean } | null;
  order: { order_id: string; side: string; amount: number; asset: string } | null;
  integrity: { ok: boolean; expected_hash?: string; actual_hash?: string } | null;
  risk: { daily_cumul: number; daily_limit: number; orders_last_minute: number; freq_limit: number } | null;
  final: { status: 'filled' | 'blocked'; stage?: string; rules?: string[]; reason?: string; at: string } | null;
  startedAt: string;
};

export type Verification =
  | { state: 'unknown' }
  | { state: 'valid'; valid: true; checked: number; last_hash?: string; at: string }
  | { state: 'broken'; valid: false; checked: number; broken_at: number; reason: string; expected?: string; found?: string; at: string };

export type DecisionRecord = {
  correlation_id: string;
  status: string;
  summary: string;
  factors: { actor: string; kind: string; status: string; effect: string; text: string; line: number; hash: string }[];
  votes: Verdict[];
  rules: { id: string; label: string }[];
  uncertainties: string[];
  path: { id: string; label: string; kind: string; state: string; sub: string }[];
  proofs: { label: string; value: string }[];
  redactions: string[];
  policy_version: string;
};

export type NodeStates = Record<string, { state: string; sub: string }>;

export type Run = {
  id: string;
  title: string;
  scenario: string | null;
  compact: boolean;
  startedAt: string;
  items: number[];
  txIds: string[];
  completed: { matched: boolean; expected: string; obtained: string; at: string } | null;
  expected: string | null;
  input: string | null;
};

export type Alert = { index: number; severity: 'warning' | 'critical' | string; title: string; text: string; at: string; corr: string | null };

export type Kpis = { total: number; decided: number; filled: number; blocked: number; escalated: number; pending: number; alerts: number; critical: number };

export interface Store {
  events: AuditEvent[];
  invalid: number;
  lastInvalid: string | null;
  connection: string | null;
  runs: Map<string, Run>;
  runOrder: string[];
  alerts: Alert[];
  txs: Map<string, Tx>;
  agents: Record<string, { trust: number; quarantined: boolean }>;
  risk: {
    breaker: 'open' | 'closed';
    daily: number;
    dailyLimit: number;
    humanApproved: number;
    freq: number;
    freqLimit: number;
    rejects: number;
    rejectLimit: number;
    lastCheck: string | null;
  };
  kpis(): Kpis;
  isMain(e: AuditEvent): boolean;
  kill: { global: boolean; by: string | null; at: string | null };
  pending: { thread_id: string; corr: string; card: HitlCardData } | null;
  verification: Verification;
  tampered: { index: number; field: string; before: string; after: string } | null;
  overrides: Map<number, AuditEvent>;
  lastCorr: string | null;
  subscribe(fn: (scopes: Set<string>) => void): () => void;
  setConnection(text: string): void;
  reset(): void;
  ingest(event: AuditEvent): boolean;
  journalLine(i: number): AuditEvent;
  setVerification(result: any): void;
  nodeStates(tx: Tx): NodeStates;
  decisionRecord(corr: string): DecisionRecord | null;
}

export type Decision = { pin?: string; action: 'approve' | 'reject'; approver_id: string; timestamp: string; signature: string };

export interface Transport {
  mode: 'sim' | 'live';
  runScenario(key: string): Promise<unknown>;
  submitObjective(spec: { asset: string; side: string; amount: number; counterparty: string }): Promise<unknown>;
  decide(threadId: string, decision: Decision): Promise<{ ok: boolean; error?: string; signature?: string }>;
  requestReport(threadId: string): Promise<unknown>;
  killSwitch(engage: boolean): Promise<unknown>;
  liftQuarantine(agentId: string): Promise<unknown>;
  resetBreaker(): Promise<unknown>;
  verify(): Promise<any>;
  tamper(): Promise<any>;
  restore(): Promise<any>;
  reset(): Promise<void>;
  setFast(fast: boolean): void;
}
