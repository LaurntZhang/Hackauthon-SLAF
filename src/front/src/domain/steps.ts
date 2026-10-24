/*
 * Lecture métier de l'état (port de jury.js) : huit étapes, verdict, raisons et détails techniques.
 * Tout est lu dans les événements journalisés ; aucune règle de gouvernance n'est évaluée ici.
 */
import { C, fmt, store, transport } from '../engine';
import type { AuditEvent, Tx } from '../engine/types';
import type { Tone } from '../theme/tokens';
import type { IconName } from '../components/Icon';
import * as W from './wording';

export type StepId = 'proposal' | 'mandate' | 'risk' | 'compliance' | 'decision' | 'human' | 'execution' | 'proof';
export type StepState = 'idle' | 'active' | 'pass' | 'escalate' | 'warn' | 'block' | 'skipped';
export type StepData = { state: StepState; label: string; short?: string; icon?: IconName; why: string };
export type StepsData = Record<StepId, StepData>;

type StepDef = {
  id: StepId;
  name: string;
  nav: string;
  icon: IconName;
  role: string;
  purpose: string;
  tech: { id: string; role: string }[];
  agents?: string[];
};

export const STEPS: StepDef[] = [
  {
    id: 'proposal', name: 'Proposition', nav: 'Proposition', icon: 'file',
    role: "Opération préparée par l'agent",
    purpose: "Un agent IA prépare l'opération. Il n'a aucun accès au marché ; un document externe reste une donnée, jamais un ordre.",
    tech: [
      { id: 'finguard.firewall', role: 'Encapsule les contenus externes et signale les consignes suspectes.' },
      { id: 'proposer', role: "Agent IA qui traduit l'objectif en opération, sans outil d'exécution ni de paiement." },
    ],
    agents: ['proposer'],
  },
  {
    id: 'mandate', name: 'Règles du mandat', nav: 'Règles du mandat', icon: 'listChecks',
    role: 'Actif, montant et contrepartie vérifiés',
    purpose: "Des règles fixes, sans IA, vérifient l'univers d'investissement, la contrepartie, l'outil demandé et le seuil d'autonomie.",
    tech: [{ id: 'finguard.policy', role: 'Moteur de règles déterministe et versionné : autoriser, escalader ou bloquer.' }],
  },
  {
    id: 'risk', name: 'Risque', nav: 'Analyse du risque', icon: 'gauge',
    role: "Exposition et seuil d'autonomie évalués",
    purpose: "Un contrôle indépendant de l'agent évalue l'exposition du fonds : concentration sectorielle, émetteur, position disponible.",
    tech: [{ id: 'risk_judge', role: "Agent juge : vote sur les expositions, sans pouvoir modifier l'opération." }],
    agents: ['risk_judge'],
  },
  {
    id: 'compliance', name: 'Conformité', nav: 'Contrôle conformité', icon: 'scale',
    role: 'Règles internes et restrictions contrôlées',
    purpose: "Un second contrôle, distinct du premier, vérifie la contrepartie (KYC), l'univers du mandat et les sources citées.",
    tech: [{ id: 'compliance_judge', role: "Agent juge : vote sur KYC et univers, sans pouvoir modifier l'opération." }],
    agents: ['compliance_judge'],
  },
  {
    id: 'decision', name: 'Décision', nav: 'Décision', icon: 'gate',
    role: 'Autoriser, escalader ou bloquer',
    purpose: "Les avis sont consolidés selon une règle fixée d'avance : au-delà de 1 000 €, les deux contrôles doivent être favorables.",
    tech: [{ id: 'finguard.quorum', role: 'Quorum : unanimité au-delà de 1 000 €, majorité pondérée en dessous.' }],
  },
  {
    id: 'human', name: 'Validation humaine', nav: 'Validation humaine', icon: 'user',
    role: "Décision du gérant si le seuil l'exige",
    purpose: "Au-delà du seuil ou en cas de désaccord, le traitement s'arrête : le gérant décide et signe l'opération exacte.",
    tech: [
      { id: 'finguard.hitl', role: "Suspend le traitement jusqu'à une décision signée du gérant." },
      { id: 'human:gerant-alpha', role: 'Approuve ou refuse ; la décision est signée (HMAC) et journalisée.' },
    ],
  },
  {
    id: 'execution', name: 'Exécution', nav: 'Exécution', icon: 'send',
    role: 'Ordre transmis uniquement après contrôle',
    purpose: "L'ordre ne part qu'avec une autorisation valide ; s'il diffère de ce qui a été validé, il est bloqué avant le marché.",
    tech: [
      { id: 'finguard.authorizations', role: "Autorisation à durée limitée, liée à l'empreinte de l'opération." },
      { id: 'executor', role: "Agent qui prépare l'ordre autorisé, sans pouvoir de décision." },
      { id: 'finguard.integrity', role: "Vérifie que l'ordre envoyé est identique à l'opération autorisée." },
      { id: 'finguard.risk_governor', role: "Limites du jour, coupe-circuit et arrêt d'urgence." },
      { id: 'finguard.gateway', role: 'Seul point de passage vers le marché (simulé dans la démo).' },
    ],
    agents: ['executor'],
  },
  {
    id: 'proof', name: 'Preuve', nav: 'Preuve', icon: 'link',
    role: 'Décision et justification enregistrées',
    purpose: 'Chaque étape est inscrite dans un journal chaîné par empreintes : toute modification ultérieure devient détectable.',
    tech: [{ id: 'finguard.audit', role: 'Journal chaîné par empreintes SHA-256, vérifiable à tout moment.' }],
  },
];

export const STEP = Object.fromEntries(STEPS.map((s) => [s.id, s])) as Record<StepId, StepDef>;

/** Liens du parcours (le tracé est calculé à partir de la géométrie des nœuds). */
export const EDGES: [StepId, StepId][] = [
  ['proposal', 'mandate'], ['mandate', 'risk'], ['mandate', 'compliance'], ['risk', 'decision'],
  ['compliance', 'decision'], ['decision', 'human'], ['human', 'execution'], ['execution', 'proof'],
];

export const STATE_ICON: Record<StepState, IconName> = {
  idle: 'circleDashed', active: 'progress', pass: 'check', escalate: 'user', warn: 'alert', block: 'lock', skipped: 'minusCircle',
};
export const STATE_TONE: Record<StepState, Tone> = {
  idle: 'idle', active: 'active', pass: 'ok', escalate: 'human', warn: 'human', block: 'block', skipped: 'idle',
};
export const STATE_SHORT: Record<StepState, string> = {
  idle: 'En attente', active: 'En cours', pass: 'Validé', escalate: 'Attention', warn: 'Attention', block: 'Bloqué', skipped: 'Non requise',
};

const RISK_WHY: Record<string, string> = {
  'RJ-SECT': 'Concentration sectorielle trop forte.',
  'RJ-ISSU': 'Exposition par émetteur au-delà de 5 %.',
  'RJ-POS': 'Position insuffisante pour vendre.',
  'CJ-UNIV': 'Actif hors du périmètre du mandat.',
};
const COMPLIANCE_WHY: Record<string, string> = {
  'CJ-KYC': 'Contrepartie hors liste KYC.',
  'CJ-UNIV': "Actif hors de l'univers du mandat.",
  'CJ-SRC': 'Source signalée : un humain doit trancher.',
};
const GOVERNOR_WHY: Record<string, string> = {
  'RSK-001': 'Budget autonome du jour dépassé : ordre non exécuté.',
  'RSK-002': "Trop d'ordres en une minute : ordre non exécuté.",
  'RSK-003': 'Trop de refus consécutifs : ordre non exécuté.',
  'RSK-004': "Bloqué par l'arrêt d'urgence : ordre non exécuté.",
  'RSK-005': 'Bloqué par le coupe-circuit : ordre non exécuté.',
};
const GOVERNOR_REASON: Record<string, string> = {
  'RSK-001': 'Le budget autonome du jour aurait été dépassé.',
  'RSK-002': "Trop d'ordres en moins d'une minute : le coupe-circuit s'est ouvert.",
  'RSK-003': 'Trop de refus consécutifs.',
  'RSK-004': "L'arrêt d'urgence était actif au moment de l'ordre.",
  'RSK-005': "Le coupe-circuit était ouvert au moment de l'ordre.",
};
const EXEC_NODES = ['authorize', 'executor', 'integrity', 'governor', 'gateway', 'market'];
const EXEC_ACTIVE: Record<string, string> = {
  authorize: "Émission de l'autorisation.",
  executor: "Préparation de l'ordre.",
  integrity: "Vérification de l'intégrité de l'ordre.",
  governor: 'Contrôle des limites du jour.',
  gateway: 'Transmission au marché simulé.',
  market: 'Exécution au marché simulé.',
};
const JUDGE_SUBJECT: Record<string, string> = { risk_judge: 'Le contrôle risque', compliance_judge: 'Le contrôle conformité' };

const ACTION_STEP: Record<string, StepId> = {
  'firewall.scanned': 'proposal', 'intent.proposed': 'proposal', 'policy.evaluated': 'mandate', 'quorum.decided': 'decision',
  'hitl.requested': 'human', 'hitl.report_requested': 'human', 'hitl.decided': 'human', 'authorization.created': 'execution',
  'authorization.revoked': 'execution', 'order.prepared': 'execution', 'integrity.checked': 'execution', 'risk.checked': 'execution',
  'execution.filled': 'execution', 'breaker.opened': 'execution',
};
const BLOCK_STEP: Record<string, StepId> = { policy: 'mandate', hitl: 'human', integrity: 'execution', governor: 'execution' };

export type MenuItem = { kind: 'scenario' | 'preset'; key: string; icon: IconName; title: string; text: string; sentence?: string };

/** Les six scénarios du cadrage, plus deux variantes saisies comme le ferait le gérant. */
export const MENU: MenuItem[] = [
  { kind: 'scenario', key: 'nominal', icon: 'checkCircle', title: 'Opération simple autorisée', text: "4 000 € d'OAT 10 ans, sous le seuil d'autonomie" },
  { kind: 'preset', key: 'amount', icon: 'user', title: 'Montant élevé', text: "25 000 € d'OAT 30 ans : validation humaine", sentence: "Acheter 25 000 € d'OAT 30 ans auprès de Banque Horizon BFI" },
  { kind: 'preset', key: 'cpty', icon: 'building', title: 'Contrepartie non autorisée', text: "5 000 € d'OAT auprès de Kappa Offshore", sentence: "Acheter 5 000 € d'OAT 10 ans auprès de Kappa Offshore Ltd" },
  { kind: 'scenario', key: 'veto_hitl', icon: 'scale', title: 'Désaccord risque / conformité', text: "85 000 € d'actions EuroTech : veto du risque" },
  { kind: 'scenario', key: 'tampering', icon: 'edit', title: 'Ordre modifié après accord', text: "L'ordre envoyé diffère de l'autorisation" },
  { kind: 'scenario', key: 'injection', icon: 'file', title: 'Document piégé', text: 'Une note externe exige un virement' },
  { kind: 'scenario', key: 'salami', icon: 'split', title: 'Ordres fractionnés', text: '12 ordres de 900 € pour passer sous les seuils' },
  { kind: 'scenario', key: 'audit_tamper', icon: 'linkBroken', title: 'Journal falsifié', text: 'Une ligne du journal est réécrite' },
];

export function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

export function effectiveMax(tx: Tx | null): number {
  return (tx && tx.policy && typeof tx.policy.effective_max === 'number' && tx.policy.effective_max) || C.LIMITS.autonomousMax;
}

/** « de » élidé devant une voyelle : « d'OAT 10 ans », « d'EuroTech SA », « de Voltéa Énergie ». */
function ofLabel(label: string | null): string {
  return /^[aeiouyhAEIOUYHÉÈÊ]/.test(label || '') ? `d'${label}` : `de ${label}`;
}

export function txWhat(tx: Tx | null): string {
  if (!tx || !tx.intent) return '';
  return `${fmt.side(tx.intent.side)} de ${fmt.eur(tx.intent.amount)} ${ofLabel(tx.assetLabel)}`;
}

export function currentTx(): Tx | null {
  const corr = store.pending ? store.pending.corr : store.lastCorr;
  return corr ? store.txs.get(corr) || null : null;
}

function judgeStep(tx: Tx, nodeState: string, judgeId: string, whyMap: Record<string, string>, approveText: string): StepData {
  const v = tx.verdicts.find((x) => x.judge_id === judgeId);
  if (v) {
    if (v.vote === 'approve') return { state: 'pass', label: 'Favorable', why: approveText };
    const r = (v.rule_ids || [])[0];
    return { state: 'escalate', label: v.vote === 'veto' ? 'Veto' : 'Abstention', short: 'Attention', why: whyMap[r] || 'Un humain doit trancher.' };
  }
  if (nodeState === 'active') return { state: 'active', label: 'En cours', why: 'Vote indépendant des autres agents.' };
  if (nodeState === 'skipped') return { state: 'skipped', label: 'Non sollicité', short: 'Non sollicité', why: 'Opération arrêtée avant ce contrôle.' };
  return { state: 'idle', label: 'En attente', why: '' };
}

function pendingOrIdle(s: string): StepData {
  return {
    state: s === 'skipped' ? 'skipped' : s === 'active' ? 'active' : 'idle',
    label: s === 'active' ? 'En cours' : s === 'skipped' ? 'Non atteinte' : 'En attente',
    why: '',
  };
}

/** État métier des huit étapes, lu uniquement dans les événements journalisés de la transaction. */
export function computeSteps(tx: Tx | null): StepsData {
  if (!tx) {
    return Object.fromEntries(STEPS.map((s) => [s.id, { state: 'idle', label: 'En attente', why: '' }])) as StepsData;
  }
  const st = store.nodeStates(tx);
  const p = tx.policy;
  const q = tx.quorum;
  const f = tx.final;
  const out = {} as StepsData;

  const flagged = st.firewall.state === 'warn';
  if (tx.intent) {
    out.proposal = flagged
      ? { state: 'warn', label: 'Source signalée', why: 'Document externe suspect isolé : il reste une simple donnée.' }
      : { state: 'pass', label: 'Proposée', short: 'Validé', why: `${txWhat(tx)}.` };
  } else {
    const started = ['pass', 'warn', 'active'].includes(st.firewall.state) || st.proposer.state === 'active';
    out.proposal = { state: started ? 'active' : 'idle', label: started ? 'En préparation' : 'En attente', why: started ? 'Lecture des données de marché.' : '' };
  }

  if (p) {
    const rules = p.triggered_rules || [];
    if (p.outcome === 'BLOCK') out.mandate = { state: 'block', label: 'Hors mandat', why: W.rule(rules[0], { tool: tx.tool }) };
    else if (p.outcome === 'ESCALATE') out.mandate = { state: 'escalate', label: 'Seuil dépassé', why: `Montant au-delà du seuil d'autonomie de ${fmt.eur(effectiveMax(tx))}.` };
    else out.mandate = { state: 'pass', label: 'Dans le mandat', why: 'Opération dans le mandat autorisé.' };
  } else {
    out.mandate = pendingOrIdle(st.policy.state);
  }

  out.risk = judgeStep(tx, st.judges.state, 'risk_judge', RISK_WHY, 'Exposition dans les limites du fonds.');
  out.compliance = judgeStep(tx, st.judges.state, 'compliance_judge', COMPLIANCE_WHY, 'Contrepartie KYC et univers conformes.');

  if (p && p.outcome === 'BLOCK') out.decision = { state: 'block', label: 'Bloquer', why: 'Une règle du mandat est enfreinte.' };
  else if (q && q.outcome === 'ESCALATE') out.decision = { state: 'escalate', label: 'Escalader au gérant', short: 'Escalade', why: 'Les contrôles ne sont pas unanimes.' };
  else if (q && p && p.outcome === 'ESCALATE') out.decision = { state: 'escalate', label: 'Escalader au gérant', short: 'Escalade', why: "Seuil d'autonomie dépassé." };
  else if (q && q.outcome === 'ALLOW') {
    out.decision = { state: 'pass', label: 'Autoriser', short: 'Autorisée', why: q.mode === 'weighted' ? 'Majorité pondérée des contrôles atteinte.' : 'Les deux contrôles sont favorables.' };
  } else out.decision = pendingOrIdle(st.quorum.state);

  const h = st.hitl.state;
  if (tx.hitl && tx.hitl.status === 'pending') {
    out.human = { state: 'escalate', label: 'En attente du gérant', short: 'Requise', why: 'Décision du gérant requise. Traitement suspendu.' };
  } else if (tx.hitl && tx.hitl.status === 'approved') {
    out.human = {
      state: 'pass', label: 'Approuvée et signée', short: 'Signée', icon: 'pen',
      why: tx.human && tx.human.timestamp ? `Signature du gérant vérifiée à ${fmt.time(tx.human.timestamp)}.` : 'Signature du gérant vérifiée.',
    };
  } else if (tx.hitl && tx.hitl.status === 'rejected') {
    out.human = { state: 'block', label: 'Refusée et signée', short: 'Refusée', icon: 'pen', why: "Le gérant a refusé : l'ordre n'est pas préparé." };
  } else if (h === 'skipped') {
    const before = f && f.status === 'blocked' && f.stage === 'policy';
    out.human = before
      ? { state: 'skipped', label: 'Non atteinte', short: 'Non atteinte', why: 'Opération bloquée avant toute décision.' }
      : { state: 'skipped', label: 'Non requise', short: 'Non requise', why: "Sous le seuil d'autonomie, contrôles favorables." };
  } else {
    out.human = { state: h === 'active' ? 'active' : 'idle', label: h === 'active' ? 'En cours' : 'En attente', why: '' };
  }

  const execStates = EXEC_NODES.map((id) => st[id].state);
  if (f && f.status === 'filled') {
    out.execution = { state: 'pass', label: 'Exécuté', short: 'Exécuté', icon: 'checkCircle', why: 'Ordre transmis au marché simulé après contrôle.' };
  } else if (f && f.stage === 'integrity') {
    out.execution = { state: 'block', label: 'Bloqué', why: "L'ordre diffère de l'autorisation : non exécuté." };
  } else if (f && f.stage === 'governor') {
    out.execution = { state: 'block', label: 'Bloqué', why: GOVERNOR_WHY[(f.rules || [])[0]] || 'Limite du jour atteinte : ordre non exécuté.' };
  } else if (f || execStates.every((s) => s === 'skipped')) {
    out.execution = { state: 'skipped', label: 'Non atteinte', short: 'Non atteinte', why: "Aucun ordre préparé : l'ordre n'a pas été exécuté." };
  } else if (execStates.some((s) => s === 'active')) {
    const node = EXEC_NODES.find((id) => st[id].state === 'active') as string;
    out.execution = { state: 'active', label: 'En cours', why: EXEC_ACTIVE[node] || 'Sous contrôle.' };
  } else if (execStates.some((s) => s === 'pass')) {
    out.execution = { state: 'active', label: 'En cours', why: 'Sous contrôle.' };
  } else {
    out.execution = { state: 'idle', label: 'En attente', why: '' };
  }

  const v = store.verification;
  const n = tx.items.length;
  const last = n ? tx.items[n - 1] : -1;
  if (v.state === 'broken' && v.broken_at <= last) {
    out.proof = { state: 'block', label: 'Journal altéré', short: 'Altéré', icon: 'linkBroken', why: `Modification détectée dans le journal (événement n° ${v.broken_at + 1}).` };
  } else if (f && v.state === 'valid' && v.checked > last) {
    out.proof = { state: 'pass', label: 'Preuve enregistrée', short: 'Enregistrée', icon: 'link', why: `Chaîne valide · ${plural(n, 'événement')} pour cette opération.` };
  } else if (f && transport.mode === 'sim') {
    out.proof = { state: 'active', label: 'Vérification', why: 'Vérification de la chaîne du journal.' };
  } else if (f) {
    out.proof = { state: 'idle', label: 'Non vérifiée', why: 'Lancez la vérification du journal.' };
  } else {
    out.proof = { state: 'idle', label: 'En attente', why: n ? `${plural(n, 'événement')} déjà enregistré${n > 1 ? 's' : ''}.` : '' };
  }
  return out;
}

function dissentSentence(tx: Tx): string {
  const parts = tx.verdicts.map((v) => {
    const who = JUDGE_SUBJECT[v.judge_id] || fmt.actor(v.judge_id);
    if (v.vote === 'approve') return `${who.toLowerCase()} y est favorable`;
    return `${who.toLowerCase()} ${v.vote === 'veto' ? "s'y oppose" : "s'abstient"}`;
  });
  if (!parts.length) return W.rule('QRM-001');
  const text = parts.join(' ; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function humanReason(tx: Tx): string {
  const reasons = (tx.hitl && tx.hitl.card && tx.hitl.card.reasons) || [];
  const parts: string[] = [];
  if (reasons.includes('POL-005')) parts.push(`Le montant dépasse le seuil d'autonomie de ${fmt.eur(effectiveMax(tx))}.`);
  if (reasons.includes('QRM-001') || reasons.includes('QRM-003')) parts.push(dissentSentence(tx));
  if (!parts.length) parts.push(...reasons.map((r) => W.rule(r)));
  parts.push('Validation humaine requise.');
  return parts.join(' ');
}

function blockReason(tx: Tx): string {
  const f = tx.final!;
  const rules = f.rules || [];
  if (f.stage === 'policy') return rules.slice(0, 2).map((r) => W.rule(r, { tool: tx.tool, max: fmt.eur(effectiveMax(tx)) })).join(' ');
  if (f.stage === 'hitl') return "Le gérant a refusé l'opération et signé sa décision.";
  if (f.stage === 'integrity') return "L'ordre envoyé ne correspond pas à ce qui a été autorisé.";
  if (f.stage === 'governor') return GOVERNOR_REASON[rules[0]] || W.rule(rules[0] || 'RSK-004');
  return f.reason || '';
}

export type Verdict = { key: string; tone: Tone; icon: IconName; label: string; text: string; cta?: boolean };

export function verdictOf(tx: Tx | null, data: StepsData): Verdict {
  if (!tx) {
    return { key: 'none', tone: 'idle', icon: 'circleDashed', label: 'Aucune opération en cours', text: 'Saisissez une opération ou choisissez un scénario.' };
  }
  const f = tx.final;
  if (f && f.status === 'filled') {
    const signed = tx.human && tx.human.timestamp ? ` à ${fmt.time(tx.human.timestamp)}` : '';
    return {
      key: `${tx.corr}-filled`, tone: 'ok', icon: 'checkCircle', label: 'Opération exécutée',
      text: tx.hitl ? `Exécutée après validation signée du gérant${signed}.` : 'Opération dans le mandat autorisé. Exécutée sans intervention humaine.',
    };
  }
  if (f) return { key: `${tx.corr}-blocked`, tone: 'block', icon: 'lock', label: 'Opération bloquée', text: `${blockReason(tx)} L'ordre n'a pas été exécuté.` };
  if (tx.hitl && tx.hitl.status === 'pending') {
    return { key: `${tx.corr}-pending`, tone: 'human', icon: 'user', label: 'Validation humaine requise', text: humanReason(tx), cta: true };
  }
  const active = STEPS.find((s) => data[s.id].state === 'active');
  return {
    key: `${tx.corr}-running`, tone: 'active', icon: 'progress', label: 'Vérification en cours',
    text: active ? `Étape en cours : ${active.nav.toLowerCase()}.` : "Les contrôles examinent l'opération.",
  };
}

/** Étape mise en avant automatiquement : celle qui bloque, attend ou travaille. */
export function autoStep(tx: Tx | null, data: StepsData): StepId {
  if (!tx) return 'proposal';
  const block = STEPS.find((s) => data[s.id].state === 'block');
  if (block) return block.id;
  if (tx.hitl && tx.hitl.status === 'pending') return 'human';
  const active = STEPS.find((s) => data[s.id].state === 'active');
  if (active) return active.id;
  if (tx.final) return 'proof';
  return 'proposal';
}

export type ProofState = { tone: Tone; icon: IconName; label: string; text: string };

export function proofState(): ProofState {
  const v = store.verification;
  if (v.state === 'broken') {
    return { tone: 'block', icon: 'linkBroken', label: 'Journal altéré', text: `Une modification a été détectée dans le journal (événement n° ${v.broken_at + 1}).` };
  }
  if (v.state === 'valid' && v.checked) {
    return { tone: 'ok', icon: 'link', label: 'Journal intègre', text: `La preuve cryptographique du journal est valide · ${plural(v.checked, 'événement')}.` };
  }
  const n = store.events.length;
  return { tone: 'idle', icon: 'circleDashed', label: n ? 'Non vérifié' : 'Journal vide', text: n ? `${plural(n, 'événement')} à vérifier.` : 'Chaque étape y sera inscrite et chaînée.' };
}

export type JournalEntry = { e: AuditEvent; line: number; index: number };

export function eventsByStep(tx: Tx): Record<StepId, JournalEntry[]> {
  const groups = Object.fromEntries(STEPS.map((s) => [s.id, []])) as unknown as Record<StepId, JournalEntry[]>;
  let current: StepId = 'proposal';
  for (const i of tx.items) {
    const e = store.journalLine(i);
    let step: StepId | undefined = ACTION_STEP[e.action];
    if (e.action === 'judge.voted') step = e.agent_id === 'risk_judge' ? 'risk' : e.agent_id === 'compliance_judge' ? 'compliance' : current;
    if (e.action === 'transaction.blocked') step = BLOCK_STEP[(e.context || {}).stage] || current;
    if (step) current = step;
    groups[step || current].push({ e, line: i + 1, index: i });
  }
  return groups;
}

export function factsFor(stepId: StepId, tx: Tx | null): [string, string][] {
  const rows: [string, string][] = [];
  const add = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') rows.push([k, String(v)]);
  };
  if (!tx) return rows;
  const i = tx.intent;
  if (stepId === 'proposal') {
    if (i) {
      add('Opération', `${fmt.side(i.side)} de ${fmt.eur(i.amount)} · ${tx.assetLabel}`);
      add('Contrepartie', i.counterparty);
      add('Confiance déclarée', fmt.dec(i.confidence));
      add('Sources citées', (i.data_sources || []).join(', ') || 'aucune');
      add('Outil demandé', tx.tool);
      add('Justification', i.rationale);
    }
    if (tx.firewall) add('Donnée externe', `${tx.firewall.source}${tx.firewall.flagged ? ` · signalée (${tx.firewall.flags.join(', ')})` : ' · rien de suspect'}`);
  } else if (stepId === 'mandate' && tx.policy) {
    add('Résultat', W.statusInfo(tx.policy.outcome).label);
    add("Seuil d'autonomie", fmt.eur(effectiveMax(tx)));
    add('Version des règles', tx.policy.policy_version || C.POLICY_VERSION);
  } else if (stepId === 'risk' || stepId === 'compliance') {
    const v = tx.verdicts.find((x) => x.judge_id === (stepId === 'risk' ? 'risk_judge' : 'compliance_judge'));
    if (v) {
      add('Vote', W.statusInfo(v.vote).label);
      if (typeof v.confidence === 'number') add('Confiance', fmt.dec(v.confidence));
      add('Justification', v.justification);
    }
  } else if (stepId === 'decision' && tx.quorum) {
    const q = tx.quorum;
    add('Résultat', W.statusInfo(q.outcome).label);
    add('Règle de quorum', q.mode === 'weighted' ? 'Majorité pondérée (> 0,70)' : 'Unanimité au-delà de 1 000 €');
    if (typeof q.approvals === 'number') add('Avis favorables', `${q.approvals} sur ${q.required}`);
  } else if (stepId === 'human' && tx.hitl) {
    const card = tx.hitl.card;
    add('Statut', W.statusInfo(tx.hitl.status).label);
    add('Motifs', (card?.reasons || []).map((r) => W.rule(r, { max: fmt.eur(effectiveMax(tx)) })).join(' '));
    if (tx.human && tx.human.approver_id) add('Signataire', fmt.actor(`human:${tx.human.approver_id}`));
    if (tx.human && tx.human.timestamp) add('Signée à', fmt.time(tx.human.timestamp));
    if (tx.human && tx.human.signature) add('Signature HMAC', `${tx.human.signature.slice(0, 24)}…`);
    if (card?.intent_hash) add("Empreinte de l'opération", fmt.shortHash(card.intent_hash));
  } else if (stepId === 'execution') {
    if (tx.auth) add('Autorisation', `${tx.auth.auth_id}${tx.auth.revoked ? ' · révoquée' : ''}`);
    if (tx.order) add('Ordre', `${tx.order.order_id} · ${fmt.side(tx.order.side)} de ${fmt.eur(tx.order.amount)} · ${fmt.assetLabel(tx.order.asset)}`);
    if (tx.integrity) {
      add('Empreinte autorisée', fmt.shortHash(tx.integrity.expected_hash));
      add('Empreinte reçue', `${fmt.shortHash(tx.integrity.actual_hash)}${tx.integrity.ok ? ' · identique' : ' · différente'}`);
    }
    if (tx.risk) {
      add('Budget autonome du jour', `${fmt.eur(tx.risk.daily_cumul)} sur ${fmt.eur(tx.risk.daily_limit)}`);
      add('Ordres sur 60 s', `${tx.risk.orders_last_minute} sur ${tx.risk.freq_limit}`);
    }
  } else if (stepId === 'proof') {
    const v = store.verification;
    add('Vérification', v.state === 'valid' ? `Chaîne intègre · ${plural(v.checked, 'événement')}` : v.state === 'broken' ? `Rupture à l'événement n° ${v.broken_at + 1}` : 'Non vérifiée');
    const record = store.decisionRecord(tx.corr);
    for (const proof of record ? record.proofs : []) {
      add(proof.label, proof.label.startsWith('Hash') || proof.label.startsWith('Signature') ? fmt.shortHash(proof.value) : proof.value);
    }
  }
  return rows;
}

// ------------------------------------------------------------------ saisie en langage courant

const ASSET_WORDS: [RegExp, string][] = [
  [/oat\s*30|30\s*ans/, 'OAT-30A'], [/\boat\b|obligation|souverain/, 'OAT-10A'], [/eurotech/, 'EUROTECH'], [/voltea/, 'VOLTEA'],
  [/medicis/, 'MEDICIS'], [/monetaire|money market/, 'MONE-EUR'], [/bitcoin|\bbtc\b|crypto/, 'BTC-SYN'], [/future|stoxx|derive/, 'FUT-ESX'],
];
const CPTY_WORDS: [RegExp, string][] = [
  [/kappa|offshore/, 'Kappa Offshore Ltd'], [/apex/, 'Apex Capital Partners'], [/nexus/, 'Nexus Trading Ltd'], [/horizon/, 'Banque Horizon BFI'],
];
const DEFAULT_CPTY = 'Banque Horizon BFI';

export type Parsed = { side: 'buy' | 'sell'; asset: string | null; amount: number | null; counterparty: string; defaultCpty: boolean };

/** Interprétation déterministe d'une phrase vers l'objectif du gérant (même contrat que la salle de contrôle). */
export function parseObjective(text: string): Parsed | null {
  const t = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!t.trim()) return null;
  const side = /\b(vend|vente|ced|sell|allege)/.test(t) ? 'sell' : 'buy';
  const asset = ASSET_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
  const counterparty = CPTY_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
  // Montants : on préfère un nombre suivi de €, k ou M ; on ignore les maturités (« 10 ans »).
  const re = /(\d{1,3}(?:[ \u00a0\u202f.]\d{3})+|\d+)(?:,(\d+))?\s*(k|m|mille|millions?)?\s*(€|eur(?:os?)?)?(\s*ans?\b)?/g;
  let best: { value: number; score: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m[5]) continue;
    let value = Number(m[1].replace(/[ \u00a0\u202f.]/g, '') + (m[2] ? `.${m[2]}` : ''));
    const unit = m[3] || '';
    if (unit === 'k' || unit === 'mille') value *= 1000;
    else if (unit.startsWith('m')) value *= 1000000;
    const score = (m[4] ? 2 : 0) + (unit ? 1 : 0);
    if (!best || score > best.score) best = { value, score };
  }
  const amount = best ? Math.round(best.value) : null;
  return { side, asset, amount, counterparty: counterparty || DEFAULT_CPTY, defaultCpty: !counterparty };
}

export function parseHint(parsed: Parsed | null): { ok: boolean; text: string } | null {
  if (!parsed) return null;
  const missing: string[] = [];
  if (!parsed.amount) missing.push('un montant');
  if (!parsed.asset) missing.push('un actif (OAT, EuroTech, Voltéa, Médicis, monétaire…)');
  if (missing.length) return { ok: false, text: `Précisez ${missing.join(' et ')}.` };
  const asset = C.ASSETS[parsed.asset as string].label;
  return {
    ok: true,
    text: `Compris : ${fmt.side(parsed.side)} · ${fmt.eur(parsed.amount as number)} · ${asset} · ${parsed.counterparty}${parsed.defaultCpty ? ' (contrepartie par défaut)' : ''}`,
  };
}
