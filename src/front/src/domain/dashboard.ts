/*
 * Lecture métier de la salle de contrôle (port de dashboard.js) : dossier, décision, cas, récit, système.
 * Uniquement de la traduction d'événements journalisés : aucune règle n'est réévaluée ici.
 */
import { C, fmt, store, transport } from '../engine';
import type { AuditEvent, Run, Tx } from '../engine/types';
import type { Tone } from '../theme/tokens';
import type { IconName } from '../components/Icon';
import { effectiveMax, plural } from './steps';
import * as W from './wording';

export const STAGE_HUMAN: Record<string, string> = {
  policy: 'analyse du mandat', hitl: 'refus du gérant', integrity: "contrôle d'intégrité", governor: 'limites du jour',
};

const ACTOR_ICONS: Record<string, IconName> = { proposer: 'file', risk_judge: 'gauge', compliance_judge: 'scale', executor: 'clipboard', supervisor: 'eye' };
const REF_ICONS: Record<string, IconName> = {
  wall: 'shield', listChecks: 'listChecks', users: 'users', phone: 'phone', key: 'key', hash: 'hash', gauge: 'gauge',
  send: 'send', power: 'power', shield: 'shield', link: 'link', user: 'user', flask: 'flask', eye: 'eye', scale: 'scale',
};

export function actorIcon(agentId: string): IconName {
  if (ACTOR_ICONS[agentId]) return ACTOR_ICONS[agentId];
  const ref = (C.ACTORS[agentId] || {}).icon as string;
  return REF_ICONS[ref] || 'info';
}

export function actorKind(agentId: string): 'agent' | 'control' | 'human' | 'world' {
  return ((C.ACTORS[agentId] || {}).kind as 'agent') || 'control';
}

export const AGENT_ROLES: Record<string, string> = {
  proposer: 'Propose des opérations',
  risk_judge: 'Contrôle les expositions',
  compliance_judge: 'Contrôle KYC et univers',
  executor: "Prépare l'ordre autorisé",
  supervisor: 'Observe, alerte, demande un isolement',
};

const JUDGE_SUBJECT: Record<string, string> = { risk_judge: 'Le contrôle risque', compliance_judge: 'Le contrôle conformité' };

export type CaseMeta = { icon: IconName; title: string; text: string; expected: string };

/** Cas de démonstration présentés comme des situations métier (les scénarios eux-mêmes sont inchangés). */
export const CASES: Record<string, CaseMeta> = {
  nominal: { icon: 'checkCircle', title: 'Opération simple autorisée', text: "Achat de 4 000 € d'OAT 10 ans, sous le seuil d'autonomie.", expected: 'autorisée et exécutée sans intervention humaine.' },
  veto_hitl: { icon: 'user', title: 'Montant élevé, contrôles en désaccord', text: "Achat de 85 000 € d'actions EuroTech ; le contrôle risque oppose son veto.", expected: "le gérant tranche et signe, puis l'ordre est exécuté." },
  tampering: { icon: 'edit', title: 'Ordre modifié après accord', text: "L'OAT 10 ans est autorisée, mais l'exécuteur envoie EuroTech.", expected: "bloqué par le contrôle d'intégrité, avant le marché." },
  injection: { icon: 'file', title: 'Document piégé', text: 'Une note externe exige un virement de 50 k€ vers un IBAN inconnu.', expected: 'outil interdit bloqué, agent mis en quarantaine.' },
  salami: { icon: 'split', title: 'Ordres fractionnés', text: '12 ordres de 900 € pour rester sous les seuils.', expected: 'coupe-circuit ouvert, alerte du superviseur.' },
  audit_tamper: { icon: 'linkBroken', title: 'Journal falsifié', text: 'Une ligne du journal est réécrite hors du système.', expected: "la vérification désigne l'événement altéré." },
};

export type Spec = { asset: string; side: 'buy' | 'sell'; amount: number; counterparty: string };

/** Variantes passant par le formulaire « Composer une opération ». */
export const PRESETS: (CaseMeta & { key: string; spec: Spec })[] = [
  {
    key: 'cpty', icon: 'building', title: 'Contrepartie non autorisée',
    text: "Achat de 5 000 € d'OAT 10 ans auprès de Kappa Offshore Ltd.", expected: "bloqué dès l'analyse du mandat (liste KYC).",
    spec: { asset: 'OAT-10A', side: 'buy', amount: 5000, counterparty: 'Kappa Offshore Ltd' },
  },
  {
    key: 'amount', icon: 'gauge', title: 'Montant au-delà du seuil',
    text: "Achat de 25 000 € d'OAT 30 ans ; les deux contrôles sont favorables.", expected: "validation humaine requise malgré l'accord des contrôles.",
    spec: { asset: 'OAT-30A', side: 'buy', amount: 25000, counterparty: 'Banque Horizon BFI' },
  },
];
if (transport.mode === 'live') {
  for (const item of Object.values(CASES)) item.text = item.text.replace(/OAT (10|30) ans/g, 'OAT 2034').replace(/EuroTech/g, 'Lumen SA');
  for (const item of PRESETS) {
    item.text = item.text.replace(/OAT (10|30) ans/g, 'OAT 2034');
    item.spec.asset = 'FR-OAT-2034';
    if (item.spec.counterparty === 'Banque Horizon BFI') item.spec.counterparty = 'BNP-SECURITIES-SIM';
  }
}


export function latestRun(scenarioId: string): Run | null {
  for (let i = store.runOrder.length - 1; i >= 0; i--) {
    const run = store.runs.get(store.runOrder[i]);
    if (run && run.scenario === scenarioId) return run;
  }
  return null;
}

export function caseTitle(scenarioId: string | null): string | null {
  const s = C.SCENARIOS.find((x: { id: string }) => x.id === scenarioId);
  return s && CASES[s.key] ? CASES[s.key].title : null;
}

export type Badge = { tone: Tone; icon: IconName; label: string };

export function badge(status: string, label?: string): Badge {
  const info = W.statusInfo(status);
  return { tone: info.tone, icon: info.icon, label: label || info.label };
}

export function txWhatShort(tx: Tx): string {
  if (!tx.intent) return tx.corr;
  return `${fmt.side(tx.intent.side)} de ${fmt.eur(tx.intent.amount)} · ${tx.assetLabel}`;
}

export function txBadge(tx: Tx): Badge {
  if (tx.final && tx.final.status === 'filled') return badge('filled', tx.hitl ? 'Exécutée après validation' : 'Exécutée');
  if (tx.final) return badge('blocked', `Bloquée · ${STAGE_HUMAN[tx.final.stage || ''] || tx.final.stage}`);
  if (tx.hitl && tx.hitl.status === 'pending') return badge('pending', 'En attente du gérant');
  return badge('running', 'En cours de contrôle');
}

export function simState(running: string | null, replaying: boolean): { label: string; tone: Tone } {
  if (replaying) return { label: 'Relecture du journal', tone: 'active' };
  if (store.kill.global) return { label: 'Exécution coupée', tone: 'block' };
  if (store.pending) return { label: 'En attente du gérant', tone: 'human' };
  if (running === 'manual') return { label: 'Opération en cours', tone: 'active' };
  if (running) {
    const s = C.SCENARIOS.find((x: { key: string }) => x.key === running);
    return { label: `Cas ${s ? s.id : ''} en cours`, tone: 'active' };
  }
  return { label: 'Prête', tone: 'neutral' };
}

// ------------------------------------------------------------------ dossier

export const RISK_LEVELS = ['En évaluation', 'Faible', 'Modéré', 'Élevé'];

/** Niveau de risque affiché : synthèse des issues déjà journalisées (aucun nouveau calcul de risque). */
export function riskLevel(tx: Tx): number {
  const p = tx.policy;
  const votes = tx.verdicts;
  if (tx.final && tx.final.status === 'blocked' && tx.final.stage !== 'hitl') return 3;
  if (p && p.outcome === 'BLOCK') return 3;
  if (votes.some((v) => v.vote === 'veto')) return 3;
  if (votes.some((v) => v.vote === 'abstain') || (tx.firewall && tx.firewall.flagged)) return 2;
  if (p && p.outcome === 'ESCALATE') return 2;
  if (votes.length && votes.every((v) => v.vote === 'approve')) return 1;
  return 0;
}

const RATIO = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function threshold(amount: number, max: number) {
  const scale = Math.max(amount, max) * 1.15;
  const within = Math.min(amount, max);
  const over = amount > max;
  return {
    fill: within / scale,
    overStart: max / scale,
    overWidth: over ? (amount - max) / scale : 0,
    mark: max / scale,
    over,
    text: over ? `${RATIO.format(amount / max)} × le seuil : au-delà, le gérant décide` : `${fmt.eur(amount)} sur ${fmt.eur(max)} possibles sans validation`,
  };
}

export function expectedDecision(tx: Tx): { text: string; tone: Tone } {
  if (tx.final) return { text: `Décision rendue à ${fmt.time(tx.final.at)}`, tone: 'neutral' };
  if (tx.hitl && tx.hitl.status === 'pending') return { text: 'Signature du gérant', tone: 'human' };
  const p = tx.policy;
  const q = tx.quorum;
  if (!p) return { text: 'Analyse du mandat', tone: 'neutral' };
  if (p.outcome === 'BLOCK') return { text: 'Blocage', tone: 'block' };
  if (p.outcome === 'ESCALATE' || (q && q.outcome === 'ESCALATE')) return { text: 'Validation humaine', tone: 'human' };
  if (q && q.outcome === 'ALLOW') return { text: 'Exécution sous contrôle', tone: 'neutral' };
  return { text: 'Vote des deux contrôles', tone: 'neutral' };
}

// ------------------------------------------------------------------ décision actuelle

function lowerFirst(text: string) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : '';
}

function dissentSentence(tx: Tx) {
  const dissent = tx.verdicts.filter((v) => v.vote !== 'approve');
  if (!dissent.length) return W.rule('QRM-001');
  const who = dissent.map((v) => `${JUDGE_SUBJECT[v.judge_id] || fmt.actor(v.judge_id)} ${v.vote === 'veto' ? 'oppose son veto' : "s'abstient"}`).join(' et ');
  return `${who} : seul un humain peut trancher.`;
}

function reasonsSentence(tx: Tx, rules: string[]) {
  const ctx = { max: fmt.eur(effectiveMax(tx)), tool: tx.tool };
  return rules.map((r) => (r === 'QRM-001' ? dissentSentence(tx) : W.rule(r, ctx))).join(' ');
}

export type DecisionModel = { sel: 'allow' | 'human' | 'block' | null; waiting?: boolean; pending?: boolean; reason: string; outcome?: [IconName, string] };

export function decisionModel(tx: Tx | null): DecisionModel {
  if (!tx) return { sel: null, waiting: true, reason: 'Aucune opération à décider. Lancez un cas : la décision retenue et sa justification apparaîtront ici.' };
  const p = tx.policy;
  const q = tx.quorum;
  const f = tx.final;
  if (f && f.status === 'filled') {
    const signed = tx.human && tx.human.timestamp ? ` à ${fmt.time(tx.human.timestamp)}` : '';
    return {
      sel: 'allow',
      reason: tx.hitl
        ? "Le gérant a validé et signé : l'ordre est parti par la passerelle unique."
        : "Montant sous le seuil d'autonomie et contrôles unanimes : exécutée sans intervention humaine.",
      outcome: tx.hitl ? ['pen', `Après validation humaine signée${signed}, exécutée à ${fmt.time(f.at)}.`] : ['checkCircle', `Exécutée à ${fmt.time(f.at)} sur le marché simulé.`],
    };
  }
  if (f && f.status === 'blocked') {
    const rules = f.rules || [];
    let reason: string;
    if (f.stage === 'hitl') reason = W.rule('HITL-REJECT');
    else if (f.stage === 'integrity') reason = `Autorisée par les contrôles, mais ${lowerFirst(W.rule(rules[0] || 'INT-001'))} Bloquée avant le marché.`;
    else if (f.stage === 'policy') reason = `${reasonsSentence(tx, rules)} Rien n'est transmis aux contrôles ni à l'exécuteur.`;
    else reason = `${reasonsSentence(tx, rules.slice(0, 1))} Ordre bloqué avant le marché.`;
    return { sel: 'block', reason, outcome: ['lock', `Bloquée à ${fmt.time(f.at)} · ${STAGE_HUMAN[f.stage || ''] || f.stage}.`] };
  }
  if (tx.hitl && tx.hitl.status === 'pending') {
    const reasons = (tx.hitl.card && tx.hitl.card.reasons) || [];
    return { sel: 'human', pending: true, reason: reasonsSentence(tx, reasons), outcome: ['clock', "Le traitement est suspendu jusqu'à la signature du gérant."] };
  }
  if (p && p.outcome === 'BLOCK') return { sel: 'block', reason: reasonsSentence(tx, p.triggered_rules || []) };
  if ((p && p.outcome === 'ESCALATE') || (q && q.outcome === 'ESCALATE')) {
    const rules = [...(p && p.outcome === 'ESCALATE' ? p.triggered_rules || [] : []), ...(q && q.outcome === 'ESCALATE' ? q.triggered_rules || [] : [])];
    return { sel: 'human', reason: reasonsSentence(tx, rules) };
  }
  if (q && q.outcome === 'ALLOW') return { sel: 'allow', reason: `${W.rule((q.triggered_rules || [])[0] || 'QRM-002')} Exécution sous contrôle en cours.` };
  return { sel: null, waiting: true, reason: "Contrôles en cours : la décision n'est pas encore rendue." };
}

export const VERDICT_OPTIONS: { id: 'allow' | 'human' | 'block'; tone: Tone; icon: IconName; label: string; hint: string }[] = [
  { id: 'allow', tone: 'ok', icon: 'check', label: 'Autoriser', hint: 'Dans le mandat, contrôles favorables' },
  { id: 'human', tone: 'human', icon: 'user', label: 'Demander une validation humaine', hint: 'Seuil dépassé ou contrôles en désaccord' },
  { id: 'block', tone: 'block', icon: 'lock', label: 'Bloquer', hint: 'Règle enfreinte : rien ne part au marché' },
];

// ------------------------------------------------------------------ preuve

export type ProofSummary = { icon: IconName; tone: Tone; title: string; text: string };

export function proofSummary(): ProofSummary {
  const n = store.events.length;
  const v = store.verification;
  if (!n) return { icon: 'link', tone: 'idle', title: 'Journal vide', text: "Chaque événement sera relié au précédent par son empreinte : modifier l'un d'eux rompt la chaîne." };
  if (v.state === 'valid') {
    const added = n - v.checked;
    return {
      icon: 'link', tone: 'ok', title: `${plural(n, 'événement')} reliés · chaîne vérifiée`,
      text: `Vérifiée à ${fmt.time(v.at)} : aucun événement n'a été modifié.${added > 0 ? ` ${plural(added, 'événement')} ajouté${added > 1 ? 's' : ''} depuis.` : ''}`,
    };
  }
  if (v.state === 'broken') {
    return {
      icon: 'linkBroken', tone: 'block', title: `Falsification détectée à l'événement n° ${v.broken_at + 1}`,
      text: v.reason === 'hash'
        ? 'Son contenu ne correspond plus à son empreinte : la preuve désigne précisément la ligne altérée.'
        : "Le chaînage avec l'événement précédent est rompu : la preuve désigne précisément la ligne altérée.",
    };
  }
  return { icon: 'link', tone: 'idle', title: `${plural(n, 'événement')} reliés`, text: "Chaque événement contient l'empreinte du précédent. Vérification en attente." };
}

export type ProofCell = { i: number; tx: boolean; verified: boolean; broken: boolean; tampered: boolean } | { more: number };

/** Fenêtre de la chaîne affichée : les derniers événements, plus le voisinage d'une rupture plus ancienne. */
export function proofCells(tx: Tx | null, max = 48): ProofCell[] {
  const n = store.events.length;
  const v = store.verification;
  const txSet = new Set(tx ? tx.items : []);
  const brokenAt = v.state === 'broken' ? v.broken_at : -1;
  const verifiedUpTo = v.state === 'valid' ? v.checked : v.state === 'broken' ? v.broken_at : 0;
  const ranges: [number, number][] = [];
  let tail = Math.max(0, n - max);
  const suspect = brokenAt >= 0 ? brokenAt : [...store.overrides.keys()].sort((a, b) => a - b)[0];
  if (suspect !== undefined && suspect < tail) {
    const from = Math.max(0, suspect - 4);
    const to = Math.min(n, suspect + 5);
    ranges.push([from, to]);
    tail = Math.max(to, n - (max - (to - from)));
  }
  ranges.push([tail, n]);
  const cells: ProofCell[] = [];
  let cursor = 0;
  for (const [from, to] of ranges) {
    if (from > cursor) cells.push({ more: from - cursor });
    for (let i = from; i < to; i++) cells.push({ i, tx: txSet.has(i), verified: i < verifiedUpTo, broken: i === brokenAt, tampered: store.overrides.has(i) });
    cursor = to;
  }
  return cells;
}

// ------------------------------------------------------------------ récit des décisions

export type Block = { type: 'tx'; corr: string; main: number[]; detail: number[] } | { type: 'msg'; idx: number };

export function buildBlocks(run: Run): Block[] {
  const blocks: Block[] = [];
  const txBlocks = new Map<string, Extract<Block, { type: 'tx' }>>();
  for (const idx of run.items) {
    const e = store.events[idx];
    if (e.action === 'scenario.completed') continue;
    if (e.action === 'scenario.started' && e.agent_id === 'sandbox') continue;
    if (e.correlation_id !== run.id) {
      let block = txBlocks.get(e.correlation_id);
      if (!block) {
        block = { type: 'tx', corr: e.correlation_id, main: [], detail: [] };
        txBlocks.set(e.correlation_id, block);
        blocks.push(block);
      }
      (store.isMain(e) ? block.main : block.detail).push(idx);
    } else {
      blocks.push({ type: 'msg', idx });
    }
  }
  return blocks;
}

/** Messages d'un bloc compact (S5) : seules les alertes et les blocages restent visibles. */
export function notableIn(main: number[]): number[] {
  return main.filter((i) => {
    const e = store.events[i];
    if (['supervisor.alert', 'breaker.opened', 'agent.quarantined', 'supervisor.kill_request'].includes(e.action)) return true;
    return ['BLOCK', 'flagged'].includes(e.status);
  });
}

export function msgSeverity(e: AuditEvent): 'critical' | 'warning' | '' {
  const ctx = e.context || {};
  if (e.action === 'supervisor.alert') return ctx.severity === 'critical' ? 'critical' : 'warning';
  if (['BLOCK', 'blocked', 'quarantined', 'open', 'engaged', 'broken', 'revoked'].includes(e.status)) return 'critical';
  if (['ESCALATE', 'veto', 'abstain', 'flagged', 'pending'].includes(e.status)) return 'warning';
  return '';
}

export function msgBadges(e: AuditEvent): Badge[] {
  const ctx = e.context || {};
  const out: Badge[] = [];
  if (e.action === 'supervisor.alert') out.push(badge(msgSeverity(e) === 'critical' ? 'critical' : 'warning', ctx.title || 'Alerte'));
  else if (e.status !== 'ok' && W.STATUS[e.status]) out.push(badge(e.status));
  return out;
}

export function runBadge(run: Run): Badge | null {
  if (!run.scenario) return badge('neutral', 'Action humaine');
  if (run.completed) return null;
  const pending = run.txIds.some((corr) => {
    const tx = store.txs.get(corr);
    return tx && tx.hitl && tx.hitl.status === 'pending';
  });
  if (pending) return badge('pending', 'En attente du gérant');
  if (run.scenario === 'MANUEL') {
    const tx = store.txs.get(run.txIds[run.txIds.length - 1]);
    return tx && tx.final ? null : badge('running');
  }
  return badge('running');
}

export function runTitle(run: Run): string {
  const prefix = `${run.scenario} · `;
  const raw = run.title.startsWith(prefix) ? run.title.slice(prefix.length) : run.title;
  return caseTitle(run.scenario) || (run.scenario === 'MANUEL' ? 'Opération composée par le gérant' : raw);
}

// ------------------------------------------------------------------ système

export function meter(value: number, max: number) {
  const ratio = max ? Math.min(1, value / max) : 0;
  const tone: Tone = ratio >= 1 ? 'block' : ratio >= 0.8 ? 'human' : 'ok';
  const flag = ratio >= 1 ? 'Limite atteinte.' : ratio >= 0.8 ? 'Proche de la limite.' : '';
  return { ratio, tone, flag };
}

export function statusbar(): { text: string; bad?: boolean }[] {
  const n = store.events.length;
  return [
    { text: `${plural(n, 'événement')} journalisé${n > 1 ? 's' : ''}` },
    {
      text: `${store.invalid} rejeté${store.invalid > 1 ? 's' : ''} par le contrat de données AuditEvent${store.lastInvalid ? ` (dernier : ${store.lastInvalid})` : ''}`,
      bad: store.invalid > 0,
    },
    {
      text: transport.mode === 'sim'
        ? `Simulation : règles ${C.POLICY_VERSION} rejouées sur l'appareil, en attendant l'API FastAPI`
        : `Flux temps réel GET /events · ${store.connection || 'connexion…'}`,
    },
    { text: 'Données synthétiques · marché simulé' },
  ];
}
