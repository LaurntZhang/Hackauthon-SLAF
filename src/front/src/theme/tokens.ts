/*
 * ManAgent — design tokens partagés par les deux thèmes.
 * Jour : charte « finance éditoriale » (managent.css : papier chaud, encre, sarcelle, or, brique).
 * Nuit : charte du mode jury (jury.css : ardoise, sarcelle lumineuse, or doux, brique rosée).
 * Les composants ne lisent jamais un hexadécimal : ils passent par ces rôles sémantiques.
 */

export type ThemeName = 'light' | 'dark';

export type Palette = {
  bg: string;
  side: string;
  canvas: string;
  surface: string;
  surface2: string;
  line: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  muted: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  onAccent: string;
  ok: string;
  okSoft: string;
  human: string;
  humanLine: string;
  humanSoft: string;
  onHuman: string;
  block: string;
  blockSoft: string;
  onBlock: string;
  idle: string;
  focus: string;
  scrim: string;
};

const light: Palette = {
  bg: '#f4f1ea',
  side: '#efebe2',
  canvas: '#f8f6f1',
  surface: '#fbfaf7',
  surface2: '#efebe2',
  line: '#e6e0d5',
  border: '#dcd5c8',
  borderStrong: '#b3aa9a',
  text: '#15212e',
  text2: '#3a4653',
  muted: '#59636e',
  accent: '#2e5b5e',
  accentStrong: '#234749',
  accentSoft: '#e2ebe8',
  onAccent: '#ffffff',
  ok: '#234749',
  okSoft: '#e2ebe8',
  human: '#7a5718',
  humanLine: '#b08a43',
  humanSoft: '#f3ead7',
  onHuman: '#ffffff',
  block: '#9e2f25',
  blockSoft: '#f6e4df',
  onBlock: '#ffffff',
  idle: '#59636e',
  focus: '#1c4e80',
  scrim: 'rgba(21, 33, 46, 0.42)',
};

const dark: Palette = {
  bg: '#0f1217',
  side: '#181d25',
  canvas: '#141920',
  surface: '#202632',
  surface2: '#283040',
  line: '#262e39',
  border: '#35404d',
  borderStrong: '#4c5969',
  text: '#edf1f2',
  text2: '#c9d2d9',
  muted: '#91a0ae',
  accent: '#72c4c1',
  accentStrong: '#72c4c1',
  accentSoft: 'rgba(114, 196, 193, 0.14)',
  onAccent: '#0d1a1a',
  ok: '#a4c397',
  okSoft: 'rgba(164, 195, 151, 0.13)',
  human: '#d0ad70',
  humanLine: '#d0ad70',
  humanSoft: 'rgba(208, 173, 112, 0.13)',
  onHuman: '#1a1408',
  block: '#c77d78',
  blockSoft: 'rgba(199, 125, 120, 0.14)',
  onBlock: '#1a0d0c',
  idle: '#91a0ae',
  focus: '#b9e6e3',
  scrim: 'rgba(5, 7, 10, 0.68)',
};

export const palettes: Record<ThemeName, Palette> = { light, dark };

/** Polices IBM Plex : sans pour le texte, serif pour les titres éditoriaux, mono pour les empreintes. */
export const fonts = {
  sans: 'IBMPlexSans_400Regular',
  sansMedium: 'IBMPlexSans_500Medium',
  sansSemi: 'IBMPlexSans_600SemiBold',
  serif: 'IBMPlexSerif_500Medium',
  serifSemi: 'IBMPlexSerif_600SemiBold',
  serifItalic: 'IBMPlexSerif_400Regular_Italic',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
};

/** Échelle typographique (ratio ≈ 1,2), aucun texte sous 12 px. */
export const fs = { xs: 12.5, sm: 13.5, md: 15, lg: 18, xl: 22, x2: 28, x3: 40 };

export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, s7: 48 };

export const radius = { sm: 4, md: 8, lg: 12, pill: 999 };

export const motion = { fast: 150, base: 220 };

/** Tons métier : ok (autorisé) · human (l'humain est sollicité) · block (blocage) · active · idle. */
export type Tone = 'ok' | 'human' | 'block' | 'active' | 'idle' | 'neutral';

export function toneColor(p: Palette, tone: Tone): string {
  switch (tone) {
    case 'ok':
      return p.ok;
    case 'human':
      return p.human;
    case 'block':
      return p.block;
    case 'active':
      return p.accent;
    case 'neutral':
      return p.text2;
    default:
      return p.idle;
  }
}

export function toneSoft(p: Palette, tone: Tone): string {
  switch (tone) {
    case 'ok':
      return p.okSoft;
    case 'human':
      return p.humanSoft;
    case 'block':
      return p.blockSoft;
    case 'active':
      return p.accentSoft;
    default:
      return p.surface2;
  }
}
