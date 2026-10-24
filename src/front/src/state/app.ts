/*
 * Pilotage de la tour de contrôle : état d'interface + commandes (port des commandes de jury.js).
 * L'état métier vient du Store (dérivé des AuditEvent) ; ici on ne garde que ce qui relève de l'affichage.
 */
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, Share } from 'react-native';

import { C, errors, fmt, store, transport } from '../engine';
import type { AuditEvent, Decision, HitlCardData } from '../engine/types';
import { MENU, parseObjective, parseHint, plural, type StepId } from '../domain/steps';

export type Drawer = { type: 'journal' } | { type: 'step'; id: StepId } | null;
export type Confirm = { title: string; text: string; ok: string; danger?: boolean; resolve: (ok: boolean) => void } | null;
export type Issue = { code: string; message: string };
export type RemotePending = { card: HitlCardData; record: any } | null;

export type UiState = {
  running: string | null;
  replay: { index: number; total: number } | null;
  selected: StepId | null;
  pinned: boolean;
  txCorr: string | null;
  drawer: Drawer;
  phoneOpen: boolean;
  menuOpen: boolean;
  issues: Issue[];
  error: string | null;
  fast: boolean;
  confirm: Confirm;
  input: string;
  inputError: string | null;
  /** Demande reçue d'un autre onglet (écran du gérant ouvert seul, web). */
  remote: RemotePending;
  remoteResolved: { thread_id: string; status: string } | null;
  /** Scénario auquel se rapportent les issues (pour les afficher sur la bonne carte de cas). */
  issuesKey: string | null;
  // ---- salle de contrôle
  /** Dossier consulté (sinon : suivi du dernier dossier). */
  roomCorr: string | null;
  tab: 'feed' | 'audit';
  selectedLine: number | null;
  xaiCorr: string | null;
  openDetails: string[];
  composer: { open: boolean; asset: string; side: 'buy' | 'sell'; amount: string; counterparty: string; error: string | null };
};

let ui: UiState = {
  issuesKey: null,
  roomCorr: null,
  tab: 'feed',
  selectedLine: null,
  xaiCorr: null,
  openDetails: [],
  composer: { open: false, asset: 'OAT-30A', side: 'buy', amount: '12000', counterparty: 'Banque Horizon BFI', error: null },
  running: null,
  replay: null,
  selected: null,
  pinned: false,
  txCorr: null,
  drawer: null,
  phoneOpen: false,
  menuOpen: false,
  issues: [],
  error: null,
  fast: false,
  confirm: null,
  input: '',
  inputError: null,
  remote: null,
  remoteResolved: null,
};

let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const fn of listeners) fn();
}

function set(patch: Partial<UiState>) {
  ui = { ...ui, ...patch };
  emit();
}

export function getUi(): UiState {
  return ui;
}

/** Re-rendu à chaque événement du journal ou changement d'interface. */
export function useApp(): { ui: UiState; version: number } {
  const v = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
    () => version,
  );
  return { ui, version: v };
}

export function announce(text: string) {
  AccessibilityInfo.announceForAccessibility(text);
}

let errorTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(message: string) {
  clearTimeout(errorTimer);
  set({ error: message });
  announce(message);
  errorTimer = setTimeout(() => set({ error: null }), 9000);
}

function guard<T>(promise: Promise<T> | T): Promise<T | undefined> {
  return Promise.resolve(promise).catch((err) => {
    notify((err && err.message) || String(err));
    return undefined;
  });
}

export function busy(): boolean {
  return Boolean(ui.running) || Boolean(ui.replay);
}

export function confirmAction(spec: Omit<NonNullable<Confirm>, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    set({
      confirm: {
        ...spec,
        resolve: (ok) => {
          set({ confirm: null });
          resolve(ok);
        },
      },
    });
  });
}

// ------------------------------------------------------------------ preuve

export async function verifyNow() {
  try {
    const result = await transport.verify();
    if (result && typeof result.valid === 'boolean') store.setVerification(result);
  } catch (err) {
    notify(`Vérification impossible : ${(err as Error).message}`);
  }
}

export async function verifyAndAnnounce() {
  await verifyNow();
  const v = store.verification;
  announce(v.state === 'valid' ? `Chaîne intègre : ${v.checked} événements.` : v.state === 'broken' ? `Modification détectée à l'événement ${v.broken_at + 1}.` : 'Vérification impossible.');
}

let verifyTimer: ReturnType<typeof setTimeout> | undefined;
let replayTimer: ReturnType<typeof setTimeout> | undefined;
let replayEvents: AuditEvent[] = [];

export function startReplay() {
  if (busy() || !store.events.length) return;
  replayEvents = store.events.slice();
  const overrides = new Map(store.overrides);
  const tampered = store.tampered;
  store.reset();
  store.overrides = overrides;
  store.tampered = tampered;
  const delay = Math.max(25, Math.min(220, Math.round(12000 / replayEvents.length)));
  set({
    replay: { index: 0, total: replayEvents.length }, pinned: false, selected: null, phoneOpen: false, menuOpen: false, drawer: null,
    roomCorr: null, openDetails: [], tab: 'feed', xaiCorr: null,
  });
  announce(`Relecture de ${replayEvents.length} événements du journal.`);
  const tick = () => {
    if (!ui.replay) return;
    const index = ui.replay.index;
    store.ingest(replayEvents[index]);
    if (index + 1 >= ui.replay.total) {
      finishReplay();
      return;
    }
    set({ replay: { ...ui.replay, index: index + 1 } });
    replayTimer = setTimeout(tick, delay);
  };
  replayTimer = setTimeout(tick, delay);
}

export function stopReplay() {
  if (!ui.replay) return;
  clearTimeout(replayTimer);
  for (let i = ui.replay.index; i < ui.replay.total; i++) store.ingest(replayEvents[i]);
  finishReplay();
}

function finishReplay() {
  clearTimeout(replayTimer);
  set({ replay: null });
  announce('Relecture terminée.');
  verifyNow();
}

function download(filename: string, text: string, type: string) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  Share.share({ title: filename, message: text }).catch(() => undefined);
}

export function exportJournal() {
  const lines = store.events.map((_, i) => JSON.stringify(store.journalLine(i))).join('\n');
  download('audit.jsonl', lines ? `${lines}\n` : '', 'application/x-ndjson');
  announce(`Journal exporté : ${plural(store.events.length, 'événement')}.`);
}

export function exportRecord(corr: string) {
  const record = store.decisionRecord(corr);
  if (!record) return;
  download(`decision-${record.correlation_id}.json`, JSON.stringify(record, null, 2), 'application/json');
  announce(`Fiche de décision ${record.correlation_id} exportée.`);
}

// ------------------------------------------------------------------ saisie et scénarios

export function setInput(text: string) {
  set({ input: text, inputError: null });
}

export async function submitText(text: string) {
  if (busy()) return;
  const parsed = parseObjective(text);
  if (!parsed || !parsed.amount || !parsed.asset) {
    const hint = parseHint(parsed);
    set({ inputError: hint ? hint.text : "Décrivez l'opération, par exemple « acheter 4 000 € d'OAT »." });
    return;
  }
  set({ running: 'manual', issues: [], menuOpen: false, inputError: null });
  announce(`Opération soumise : ${fmt.side(parsed.side)} de ${fmt.eur(parsed.amount)} de ${C.ASSETS[parsed.asset].label}.`);
  try {
    await transport.submitObjective({ asset: parsed.asset, side: parsed.side, amount: parsed.amount, counterparty: parsed.counterparty });
  } catch (err) {
    notify((err as Error).message);
  } finally {
    set({ running: null });
    verifyNow();
  }
}

export async function runScenario(key: string) {
  if (busy()) return;
  const scenario = C.SCENARIOS.find((s: { key: string }) => s.key === key);
  if (!scenario) return;
  const meta = MENU.find((m) => m.key === key);
  set({ issues: [], issuesKey: null, running: key, menuOpen: false, input: '', inputError: null, roomCorr: null, tab: key === 'audit_tamper' ? 'audit' : 'feed' });
  announce(`Scénario lancé : ${meta ? meta.title : scenario.title}.`);
  try {
    await transport.runScenario(key);
  } catch (err: any) {
    if (errors && err instanceof errors.PreconditionError) set({ issues: err.issues, issuesKey: key });
    else if (errors && err instanceof errors.BusyError) notify(err.message);
    else set({ issues: [{ code: 'error', message: err.message }], issuesKey: key });
  } finally {
    set({ running: null });
    verifyNow();
  }
}

export function runMenu(key: string) {
  const item = MENU.find((m) => m.key === key);
  if (!item) return;
  if (item.kind === 'preset' && item.sentence) {
    set({ input: item.sentence, menuOpen: false });
    submitText(item.sentence);
  } else {
    runScenario(key);
  }
}

// ------------------------------------------------------------------ navigation dans le parcours

export function selectStep(id: StepId) {
  set({ selected: id, pinned: true });
}

export function follow() {
  set({ pinned: false, selected: null });
}

export function openDrawer(drawer: NonNullable<Drawer>) {
  if (drawer.type === 'journal') verifyNow();
  set({ drawer });
}

export function closeDrawer() {
  set({ drawer: null });
}

export function setMenu(open: boolean) {
  set({ menuOpen: open });
}

export function openPhone() {
  clearTimeout(phoneTimer);
  set({ phoneOpen: true });
}

export function closePhone() {
  clearTimeout(phoneTimer);
  set({ phoneOpen: false });
}

export function setFast(fast: boolean) {
  transport.setFast(fast);
  set({ fast });
}

// ------------------------------------------------------------------ commandes de gouvernance

export async function decide(threadId: string, decision: Decision) {
  return transport.decide(threadId, decision);
}

export function requestReport(threadId: string) {
  guard(transport.requestReport(threadId));
}

export async function resetDemo() {
  set({ menuOpen: false });
  const ok = await confirmAction({
    title: 'Réinitialiser la démonstration ?',
    text: "Le journal local, les scores de confiance et les compteurs reviennent à leur état initial. Rien ne quitte l'appareil.",
    ok: 'Réinitialiser',
    danger: true,
  });
  if (!ok) return;
  if (ui.replay) stopReplay();
  set({
    phoneOpen: false, drawer: null, issues: [], issuesKey: null, pinned: false, selected: null, input: '',
    roomCorr: null, selectedLine: null, xaiCorr: null, openDetails: [], tab: 'feed',
  });
  await guard(transport.reset());
  broadcast({ type: 'idle' });
}

export async function toggleKill() {
  if (store.kill.global) {
    const ok = await confirmAction({
      title: "Réarmer l'exécution ?",
      text: 'Les ordres autorisés pourront de nouveau atteindre le marché simulé. Action journalisée.',
      ok: 'Réarmer',
    });
    if (ok) await guard(transport.killSwitch(false));
    return;
  }
  const ok = await confirmAction({
    title: "Déclencher l'arrêt d'urgence ?",
    text: "Plus aucun ordre n'atteindra le marché tant qu'un humain n'aura pas réarmé l'exécution. Les contrôles et le journal continuent.",
    ok: "Couper l'exécution",
    danger: true,
  });
  if (ok) {
    await guard(transport.killSwitch(true));
    announce("Arrêt d'urgence actif : aucun ordre n'atteint le marché.");
  }
}

export async function liftQuarantine(agentId: string) {
  const ok = await confirmAction({
    title: `Lever la quarantaine du ${fmt.actor(agentId)} ?`,
    text: "L'agent pourra de nouveau intervenir, avec son score de confiance actuel. L'action est journalisée au nom du superviseur humain.",
    ok: 'Lever la quarantaine',
  });
  if (ok) {
    set({ issues: [] });
    await guard(transport.liftQuarantine(agentId));
  }
}

export async function resetBreaker() {
  const ok = await confirmAction({
    title: 'Réarmer le coupe-circuit ?',
    text: "Les compteurs de fréquence et de refus repartent de zéro. L'action est journalisée au nom du superviseur humain.",
    ok: 'Réarmer',
  });
  if (ok) {
    set({ issues: [] });
    await guard(transport.resetBreaker());
  }
}

export async function tamper() {
  const info = await guard(transport.tamper());
  if (info && typeof info.index === 'number') announce(`Événement ${info.index + 1} modifié hors du système. Lancez la vérification.`);
}

export async function restore() {
  await guard(transport.restore());
  await verifyNow();
  announce('Journal restauré.');
}

// ------------------------------------------------------------------ synchronisation automatique

let phoneTimer: ReturnType<typeof setTimeout> | undefined;
let lastPendingThread: string | null = null;

/** Canal partagé avec un écran du gérant ouvert dans un autre onglet (même protocole que approval.html). */
type Channel = { postMessage: (m: unknown) => void; onmessage: ((ev: { data: any }) => void) | null };
let channel: Channel | null = null;

function broadcast(message: unknown) {
  if (channel) channel.postMessage(message);
}

function pendingMessage() {
  const p = store.pending;
  return p ? { type: 'pending', card: p.card, record: store.decisionRecord(p.corr) } : { type: 'idle' };
}

function onStoreChange(scopes: Set<string>) {
  // Nouvelle opération : la vue revient en suivi automatique.
  const corr = store.pending ? store.pending.corr : store.lastCorr;
  if (corr !== ui.txCorr) ui = { ...ui, txCorr: corr, pinned: false, selected: null };

  if (transport.mode === 'sim' && !ui.replay && scopes.has('events')) {
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(verifyNow, 350);
  }

  const p = store.pending;
  if (p && !ui.replay && p.thread_id !== lastPendingThread) {
    lastPendingThread = p.thread_id;
    broadcast(pendingMessage());
    announce(`Validation humaine requise sur ${p.corr}.`);
    // Le jury voit d'abord l'étape s'allumer dans le parcours, puis le téléphone du gérant s'ouvre.
    clearTimeout(phoneTimer);
    phoneTimer = setTimeout(() => {
      if (store.pending && store.pending.thread_id === p.thread_id && !ui.replay) set({ phoneOpen: true });
    }, 1200);
  } else if (!p && lastPendingThread) {
    const tx = ui.txCorr ? store.txs.get(ui.txCorr) : null;
    const status = tx && tx.hitl ? tx.hitl.status : 'rejected';
    broadcast({ type: 'resolved', thread_id: lastPendingThread, status });
    lastPendingThread = null;
    clearTimeout(phoneTimer);
    // L'écran « décision signée » reste lisible un instant avant de rendre la main au parcours.
    if (ui.phoneOpen) phoneTimer = setTimeout(() => set({ phoneOpen: false }), 2600);
  }
  emit();
}

store.subscribe(onStoreChange);

function setupChannel() {
  const BC = (globalThis as any).BroadcastChannel;
  // Navigateur uniquement (pas pendant le rendu statique côté Node, ni en natif).
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined' || !BC) return;
  channel = new BC('managent-hitl') as Channel;
  channel.onmessage = async ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'hello') {
      // Seule une tour de contrôle active répond : un autre écran vide ne doit pas effacer la demande.
      if (store.events.length) broadcast(pendingMessage());
    } else if (data.type === 'decision' && typeof data.thread_id === 'string' && data.decision && typeof data.decision === 'object') {
      if (!store.pending || store.pending.thread_id !== data.thread_id) return;
      const d = data.decision;
      const decision: Decision = { action: String(d.action) as Decision['action'], approver_id: String(d.approver_id), timestamp: String(d.timestamp), signature: String(d.signature) };
      const result = await transport.decide(data.thread_id, decision);
      broadcast({ type: 'decision-result', thread_id: data.thread_id, ok: Boolean(result && result.ok), error: result && result.error });
    } else if (data.type === 'report' && typeof data.thread_id === 'string') {
      guard(transport.requestReport(data.thread_id));
    } else if (data.type === 'pending' && data.card && !store.pending) {
      set({ remote: { card: data.card, record: data.record }, remoteResolved: null });
    } else if (data.type === 'resolved' && ui.remote && ui.remote.card.thread_id === data.thread_id) {
      set({ remoteResolved: { thread_id: data.thread_id, status: String(data.status) } });
    } else if (data.type === 'idle' && ui.remote) {
      set({ remote: null, remoteResolved: null });
    } else if (data.type === 'decision-result') {
      const resolver = remoteWaiters.get(data.thread_id);
      if (resolver) {
        remoteWaiters.delete(data.thread_id);
        resolver({ ok: Boolean(data.ok), error: data.error });
      }
    }
  };
  // Un écran ouvert seul demande l'état courant à la tour de contrôle.
  channel.postMessage({ type: 'hello' });
}

const remoteWaiters = new Map<string, (r: { ok: boolean; error?: string }) => void>();

/** Décision signée depuis un onglet « gérant » isolé : la tour de contrôle la vérifie et l'applique. */
export function decideRemote(threadId: string, decision: Decision): Promise<{ ok: boolean; error?: string }> {
  if (!channel) return Promise.resolve({ ok: false, error: 'Aucune tour de contrôle connectée.' });
  return new Promise((resolve) => {
    remoteWaiters.set(threadId, resolve);
    channel!.postMessage({ type: 'decision', thread_id: threadId, decision });
    setTimeout(() => {
      if (remoteWaiters.has(threadId)) {
        remoteWaiters.delete(threadId);
        resolve({ ok: false, error: 'La tour de contrôle ne répond pas.' });
      }
    }, 5000);
  });
}

export function requestReportRemote(threadId: string) {
  broadcast({ type: 'report', thread_id: threadId });
}

setupChannel();

// ------------------------------------------------------------------ salle de contrôle

/** Dossier affiché par la salle : celui consulté, sinon le dernier. */
export function roomTx() {
  const corr = ui.roomCorr || store.lastCorr;
  return corr ? store.txs.get(corr) || null : null;
}

export function pinDossier(corr: string | null) {
  set({ roomCorr: corr });
}

export function setTab(tab: UiState['tab']) {
  set({ tab });
}

export function selectLine(line: number | null) {
  set({ selectedLine: line });
  if (line !== null) announce(`Événement ${line + 1} affiché sous le tableau, tel qu'enregistré.`);
}

export function openXai(corr: string | null) {
  set({ xaiCorr: corr });
}

export function toggleDetails(key: string) {
  const open = ui.openDetails.includes(key);
  set({ openDetails: open ? ui.openDetails.filter((k) => k !== key) : [...ui.openDetails, key] });
}

export function setComposer(patch: Partial<UiState['composer']>) {
  set({ composer: { ...ui.composer, ...patch } });
}

/** Opération composée champ par champ : même contrat que l'objectif du gérant (validation côté moteur). */
export async function submitComposer() {
  if (busy()) return;
  const c = ui.composer;
  const amount = Number(String(c.amount).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  const error = !Number.isFinite(amount) || amount <= 0 ? 'Saisissez un montant positif.' : amount > 1000000 ? 'Montant limité à 1 000 000 € dans la démo.' : null;
  if (error) {
    setComposer({ error });
    announce(error);
    return;
  }
  set({ running: 'manual', roomCorr: null, tab: 'feed', composer: { ...c, error: null } });
  try {
    await transport.submitObjective({ asset: c.asset, side: c.side, amount, counterparty: c.counterparty });
  } catch (err) {
    notify((err as Error).message);
  } finally {
    set({ running: null });
    verifyNow();
  }
}

export function applyPreset(spec: { asset: string; side: 'buy' | 'sell'; amount: number; counterparty: string }, title: string) {
  setComposer({ open: true, asset: spec.asset, side: spec.side, amount: String(spec.amount), counterparty: spec.counterparty, error: null });
  announce(`Formulaire pré-rempli : ${title}. Validez avec « Confier au Proposer ».`);
}
