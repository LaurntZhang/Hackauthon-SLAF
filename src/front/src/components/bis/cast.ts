/*
 * Distribution de la chaîne : seuls les vrais acteurs ont un avatar.
 * Proposition et exécution sont imaginées en plusieurs agents ; mandat, décision et preuve
 * restent des composants FinGuard déterministes, sans IA.
 */
import type { StepId } from '../../domain/steps';
import type { Persona } from './AvatarFigure';

export type Agent = Persona & { name: string; tag: string; persona: string };

export const CAST: Partial<Record<StepId, Agent[]>> = {
  proposal: [
    { id: 'lea', name: 'LÉA', tag: 'Prudente', persona: 'value prudent', skin: '#f0c3a0', hair: '#3a2a22', hairStyle: 'bob', shirt: '#3f7f86', collar: 'crew', glasses: true },
    { id: 'max', name: 'MAX', tag: 'Décote', persona: 'opportuniste, décote', skin: '#a8704a', hair: '#1d1a1f', hairStyle: 'curly', shirt: '#d2793f', collar: 'crew' },
    { id: 'noa', name: 'NOA', tag: 'Macro', persona: 'macro momentum', skin: '#d9a074', hair: '#6b3a2a', hairStyle: 'bun', shirt: '#7b62b8', collar: 'crew' },
  ],
  risk: [
    { id: 'risk', name: 'RISQUE', tag: 'Juge', persona: 'juge risque', skin: '#8a5a3c', hair: '#15181f', hairStyle: 'bald', shirt: '#2f6fa8', collar: 'crew', beard: true },
  ],
  compliance: [
    { id: 'compl', name: 'CONFORMITÉ', tag: 'Juge', persona: 'juge conformité', skin: '#f0c3a0', hair: '#9a9aa6', hairStyle: 'quiff', shirt: '#5d7f6a', collar: 'shirt', glasses: true },
  ],
  human: [
    { id: 'gerant', name: 'GÉRANT', tag: 'Humain', persona: 'gérant du fonds', skin: '#d9a074', hair: '#2a2420', hairStyle: 'short', shirt: '#1f2a44', collar: 'suit' },
  ],
  execution: [
    { id: 'ivan', name: 'IVAN', tag: 'Smart route', persona: 'agency smart route', skin: '#e5b08a', hair: '#4a2f22', hairStyle: 'short', shirt: '#c79a2c', collar: 'crew', headset: true },
    { id: 'zoe', name: 'ZOÉ', tag: 'Best exec.', persona: 'venue best execution', skin: '#7a4b32', hair: '#14121a', hairStyle: 'long', shirt: '#c2574d', collar: 'crew', headset: true },
  ],
};

/** Légende courte sous le titre de chaque étape. */
export const CAPTION: Record<StepId, string> = {
  proposal: 'Essaim · 3 profils',
  mandate: 'FinGuard · sans IA',
  risk: 'Juge indépendant',
  compliance: 'Juge indépendant',
  decision: 'Quorum fixe',
  human: 'Décision signée',
  execution: 'Pool · 2 routes',
  proof: 'Journal SHA-256',
};
