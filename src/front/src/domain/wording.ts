/*
 * Vocabulaire d'affichage (port de wording.js) : identifiants techniques du journal → langage métier.
 * Couche de présentation uniquement : aucune règle de gouvernance n'est évaluée ici.
 */
import { fmt } from '../engine';
import type { Tone } from '../theme/tokens';
import type { IconName } from '../components/Icon';

export type StatusInfo = { label: string; tone: Tone; icon: IconName };

export const STATUS: Record<string, StatusInfo> = {
  ALLOW: { label: 'Autorisé', tone: 'ok', icon: 'check' },
  ESCALATE: { label: "Escaladé à l'humain", tone: 'human', icon: 'user' },
  BLOCK: { label: 'Bloqué', tone: 'block', icon: 'lock' },
  approve: { label: 'Approuve', tone: 'ok', icon: 'check' },
  veto: { label: 'Veto', tone: 'human', icon: 'alert' },
  abstain: { label: 'Abstention', tone: 'human', icon: 'alert' },
  pending: { label: 'En attente du gérant', tone: 'human', icon: 'clock' },
  approved: { label: 'Approuvé et signé', tone: 'ok', icon: 'pen' },
  rejected: { label: 'Refusé et signé', tone: 'block', icon: 'pen' },
  filled: { label: 'Exécuté', tone: 'ok', icon: 'checkCircle' },
  blocked: { label: 'Bloqué', tone: 'block', icon: 'lock' },
  flagged: { label: 'Signalé', tone: 'human', icon: 'alert' },
  penalty: { label: 'Score abaissé', tone: 'human', icon: 'arrowDownRight' },
  quarantined: { label: 'Quarantaine', tone: 'block', icon: 'lock' },
  released: { label: 'Levée', tone: 'ok', icon: 'check' },
  revoked: { label: 'Révoquée', tone: 'block', icon: 'xCircle' },
  open: { label: 'Ouvert', tone: 'block', icon: 'power' },
  closed: { label: 'Fermé', tone: 'ok', icon: 'check' },
  engaged: { label: 'Activé', tone: 'block', icon: 'power' },
  requested: { label: 'Demandé', tone: 'human', icon: 'alert' },
  report: { label: 'Fiche demandée', tone: 'neutral', icon: 'file' },
  broken: { label: 'Chaîne rompue', tone: 'block', icon: 'linkBroken' },
  mismatch: { label: 'Écart', tone: 'human', icon: 'alert' },
  alert: { label: 'Alerte', tone: 'human', icon: 'eye' },
  critical: { label: 'Critique', tone: 'block', icon: 'alert' },
  warning: { label: 'Vigilance', tone: 'human', icon: 'eye' },
  running: { label: 'En cours', tone: 'active', icon: 'clock' },
  ok: { label: 'Conforme', tone: 'neutral', icon: 'check' },
  valid: { label: 'Vérifiée', tone: 'ok', icon: 'link' },
  neutral: { label: '', tone: 'neutral', icon: 'info' },
};

const ACTIONS: Record<string, string> = {
  'scenario.started': 'Début du cas',
  'scenario.completed': 'Fin du cas',
  'firewall.scanned': 'Filtrage des données externes',
  'intent.proposed': 'Proposition',
  'policy.evaluated': 'Analyse du mandat',
  'judge.voted': "Vote d'un contrôle",
  'quorum.decided': 'Décision des contrôles',
  'hitl.requested': 'Validation demandée',
  'hitl.report_requested': 'Fiche demandée',
  'hitl.decided': 'Décision du gérant',
  'authorization.created': 'Autorisation émise',
  'authorization.revoked': 'Autorisation révoquée',
  'order.prepared': 'Ordre préparé',
  'integrity.checked': "Contrôle d'intégrité",
  'risk.checked': 'Limites du jour',
  'execution.filled': 'Exécution',
  'transaction.blocked': 'Blocage',
  'trust.updated': 'Score de confiance',
  'agent.quarantined': 'Mise en quarantaine',
  'agent.released': 'Levée de quarantaine',
  'supervisor.alert': 'Alerte du superviseur',
  'supervisor.kill_request': "Demande d'isolement",
  'breaker.opened': 'Coupe-circuit ouvert',
  'breaker.reset': 'Coupe-circuit réarmé',
  'killswitch.engaged': "Arrêt d'urgence",
  'killswitch.released': "Reprise de l'exécution",
  'audit.verified': 'Vérification du journal',
};

type RuleCtx = { max?: string; tool?: string | null };

const RULES: Record<string, (c: RuleCtx) => string> = {
  'FW-001': () => 'Un document externe contient une consigne suspecte : il reste une donnée, jamais un ordre.',
  'POL-001': () => "L'actif est hors de l'univers autorisé par le mandat.",
  'POL-002': () => "La contrepartie n'est pas dans la liste blanche KYC.",
  'POL-003': (c) => `L'agent a demandé un outil que son mandat interdit${c.tool ? ` (${c.tool})` : ''}.`,
  'POL-004': () => 'Un agent du circuit est en quarantaine : aucune nouvelle opération.',
  'POL-005': (c) => `Le montant dépasse le seuil d'autonomie${c.max ? ` de ${c.max}` : ''} : validation humaine requise.`,
  'QRM-001': () => "Un contrôle s'oppose ou s'abstient : seul un humain peut trancher.",
  'QRM-002': () => 'Au-delà de 1 000 €, les deux contrôles doivent approuver : c’est le cas.',
  'QRM-003': () => 'La majorité pondérée des contrôles est atteinte.',
  'RJ-SECT': () => 'Concentration sectorielle surveillée : alerte à 18 %, limite à 20 %.',
  'RJ-ISSU': () => 'Exposition par émetteur limitée à 5 % du fonds.',
  'RJ-POS': () => 'La position détenue est insuffisante pour vendre.',
  'CJ-KYC': () => 'Contrepartie vérifiée en liste blanche KYC.',
  'CJ-UNIV': () => "Actif dans l'univers du mandat.",
  'CJ-SRC': () => "La proposition s'appuie sur une source signalée.",
  'HITL-SIGN': () => 'Le gérant a approuvé et signé.',
  'HITL-REJECT': () => "Le gérant a refusé et signé : l'exécuteur n'est jamais sollicité.",
  'INT-001': () => "L'ordre envoyé ne correspond pas à ce qui a été autorisé.",
  'INT-002': () => "L'autorisation est absente, expirée ou révoquée.",
  'RSK-001': () => 'Le budget autonome du jour serait dépassé.',
  'RSK-002': () => "Trop d'ordres en moins d'une minute : le coupe-circuit s'ouvre.",
  'RSK-003': () => 'Trop de refus consécutifs.',
  'RSK-004': () => "L'arrêt d'urgence est actif : aucun ordre n'atteint le marché.",
  'RSK-005': () => 'Le coupe-circuit est ouvert : un réarmement humain est requis.',
};

export function statusInfo(status: string): StatusInfo {
  return STATUS[status] || { label: status, tone: 'neutral', icon: 'info' };
}

export function rule(id: string, c?: RuleCtx): string {
  const fn = RULES[id];
  return fn ? fn(c || {}) : fmt.rule(id);
}

export function action(code: string): string {
  return ACTIONS[code] || code;
}
