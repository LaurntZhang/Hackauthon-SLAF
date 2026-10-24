/*
 * Parcours de l'opération : huit étapes reliées, de la proposition à la preuve.
 * Géométrie calculée (pas de mesure DOM) : grille 4 colonnes en bureau, colonne unique en mobile.
 */
import { memo, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { EDGES, STATE_ICON, STATE_TONE, STEPS, type StepId, type StepsData } from '../domain/steps';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, type Palette } from '../theme/tokens';
import { Icon } from './Icon';
import { Status } from './ui';

type Rect = { x: number; y: number; w: number; h: number };
type Layout = { rects: Record<StepId, Rect>; height: number; wide: boolean; cap: { x: number; y: number; w: number } | null };

export function computeLayout(width: number): Layout {
  const W = Math.max(280, width);
  if (W >= 860) {
    const G = W >= 1100 ? 48 : 36;
    const colW = (W - 3 * G) / 4;
    const H = 128;
    const capH = 26;
    const vGap = 14;
    const lane = 60;
    const x = (i: number) => i * (colW + G);
    const mid = capH + (H + vGap) / 2;
    const row2 = capH + 2 * H + vGap + lane;
    const rects: Record<StepId, Rect> = {
      proposal: { x: x(0), y: mid, w: colW, h: H },
      mandate: { x: x(1), y: mid, w: colW, h: H },
      risk: { x: x(2), y: capH, w: colW, h: H },
      compliance: { x: x(2), y: capH + H + vGap, w: colW, h: H },
      decision: { x: x(3), y: mid, w: colW, h: H },
      human: { x: x(0), y: row2, w: colW, h: H },
      execution: { x: x(1), y: row2, w: colW, h: H },
      proof: { x: x(2), y: row2, w: colW, h: H },
    };
    return { rects, height: row2 + H + 4, wide: true, cap: { x: x(2), y: 0, w: colW } };
  }
  const H = 118;
  const Hh = 134;
  const gap = 38;
  const col = 12;
  const half = (W - col) / 2;
  const rects = {} as Record<StepId, Rect>;
  let y = 0;
  for (const id of ['proposal', 'mandate'] as StepId[]) {
    rects[id] = { x: 0, y, w: W, h: H };
    y += H + gap;
  }
  y += 6;
  rects.risk = { x: 0, y, w: half, h: Hh };
  rects.compliance = { x: half + col, y, w: half, h: Hh };
  y += Hh + gap + 6;
  for (const id of ['decision', 'human', 'execution', 'proof'] as StepId[]) {
    rects[id] = { x: 0, y, w: W, h: H };
    y += H + gap;
  }
  return { rects, height: y - gap + 4, wide: false, cap: null };
}

type EdgeTone = 'idle' | 'active' | 'done' | 'human' | 'block' | 'skipped';

function toneOf(state: string): EdgeTone {
  return ({ idle: 'idle', active: 'active', pass: 'done', escalate: 'human', warn: 'human', block: 'block', skipped: 'skipped' } as const)[state as 'idle'] || 'idle';
}

function edgeTone(a: StepId, b: StepId, d: StepsData): EdgeTone {
  // Une validation humaine « non requise » est traversée : le parcours continue sans s'y arrêter.
  const through = (id: StepId) => id === 'human' && d.human.state === 'skipped' && !['idle', 'skipped'].includes(d.execution.state);
  if (d[a].state === 'skipped' && !through(a)) return 'skipped';
  if (d[b].state === 'skipped') return through(b) ? 'done' : 'skipped';
  if (d[a].state === 'idle') return 'idle';
  return toneOf(d[b].state);
}

function edgeColor(p: Palette, tone: EdgeTone): string {
  switch (tone) {
    case 'active':
      return p.accent;
    case 'done':
      return p.ok;
    case 'human':
      return p.human;
    case 'block':
      return p.block;
    case 'skipped':
      return p.border;
    default:
      return p.borderStrong;
  }
}

/** Polyligne orthogonale à coins arrondis (r ≤ 8 px). */
function roundedElbow(points: number[][]): string {
  let path = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(8, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const bx = x - Math.sign(x - px) * r;
    const by = y - Math.sign(y - py) * r;
    const ax = x + Math.sign(nx - x) * r;
    const ay = y + Math.sign(ny - y) * r;
    path += ` L${bx} ${by} Q${x} ${y} ${ax} ${ay}`;
  }
  const end = points[points.length - 1];
  return `${path} L${end[0]} ${end[1]}`;
}

function edgePoints(A: Rect, B: Rect): { pts: number[][]; dir: 'right' | 'down' } {
  const ar = A.x + A.w;
  const acx = A.x + A.w / 2;
  const acy = A.y + A.h / 2;
  const bcx = B.x + B.w / 2;
  const bcy = B.y + B.h / 2;
  if (B.x >= ar - 2) {
    const xm = Math.round((ar + B.x) / 2);
    const pts = Math.abs(acy - bcy) < 1 ? [[ar, acy], [B.x - 3, bcy]] : [[ar, acy], [xm, acy], [xm, bcy], [B.x - 3, bcy]];
    return { pts, dir: 'right' };
  }
  const ab = A.y + A.h;
  const ym = Math.round(B.y - Math.min(30, (B.y - ab) / 2));
  const pts = Math.abs(acx - bcx) < 1 ? [[acx, ab], [bcx, B.y - 3]] : [[acx, ab], [acx, ym], [bcx, ym], [bcx, B.y - 3]];
  return { pts, dir: 'down' };
}

function arrowHead(end: number[], dir: 'right' | 'down'): string {
  const [x, y] = end;
  return dir === 'right' ? `M${x - 7} ${y - 4.5} L${x + 1} ${y} L${x - 7} ${y + 4.5} Z` : `M${x - 4.5} ${y - 7} L${x} ${y + 1} L${x + 4.5} ${y - 7} Z`;
}

type Props = { width: number; data: StepsData; shown: StepId; onSelect: (id: StepId) => void };

function FlowCanvasBase({ width, data, shown, onSelect }: Props) {
  const { colors } = useTheme();
  const layout = useMemo(() => computeLayout(width), [width]);

  const edges = EDGES.map(([a, b]) => {
    const { pts, dir } = edgePoints(layout.rects[a], layout.rects[b]);
    const tone = edgeTone(a, b, data);
    return { key: `${a}-${b}`, d: roundedElbow(pts), head: arrowHead(pts[pts.length - 1], dir), color: edgeColor(colors, tone), dashed: tone === 'skipped' || tone === 'idle', strong: tone !== 'idle' && tone !== 'skipped' };
  });

  return (
    <View style={{ width: layout.wide ? width : Math.max(280, width), height: layout.height }} accessibilityRole="list" accessibilityLabel="Parcours de l'opération, de la proposition à la preuve">
      <Svg width={Math.max(280, width)} height={layout.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {edges.map((e) => (
          <Path key={e.key} d={e.d} stroke={e.color} strokeWidth={e.strong ? 1.6 : 1.2} fill="none" strokeDasharray={e.dashed ? '4 4' : undefined} />
        ))}
        {edges.map((e) => (
          <Path key={`${e.key}-h`} d={e.head} fill={e.color} />
        ))}
      </Svg>
      {layout.cap ? (
        <Text style={[styles.cap, { left: layout.cap.x, top: layout.cap.y, width: layout.cap.w, color: colors.text2 }]}>Contrôles indépendants</Text>
      ) : null}
      {STEPS.map((s, i) => (
        <FlowNode key={s.id} index={i} id={s.id} rect={layout.rects[s.id]} compact={!layout.wide && (s.id === 'risk' || s.id === 'compliance')} data={data[s.id]} selected={shown === s.id} onSelect={onSelect} />
      ))}
    </View>
  );
}

export const FlowCanvas = memo(FlowCanvasBase);

type NodeProps = { id: StepId; index: number; rect: Rect; compact: boolean; data: StepsData[StepId]; selected: boolean; onSelect: (id: StepId) => void };

function FlowNode({ id, index, rect, compact, data, selected, onSelect }: NodeProps) {
  const { colors } = useTheme();
  const step = STEPS[index];
  const tone = STATE_TONE[data.state];
  const toneC = toneColor(colors, tone);
  const lit = data.state !== 'idle' && data.state !== 'skipped';
  const dim = data.state === 'skipped';
  const text = data.why || step.role;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${step.name}, étape ${index + 1} sur 8 : ${data.label}. ${text}`}
      accessibilityState={{ selected }}
      accessibilityHint="Affiche l'explication de l'étape"
      onPress={() => onSelect(id)}
      style={(state: any) => [
        styles.node,
        {
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          backgroundColor: state.hovered ? colors.surface2 : colors.surface,
          borderColor: selected ? colors.borderStrong : data.state === 'active' ? colors.accent : colors.border,
          borderWidth: selected ? 2 : 1,
          borderLeftColor: lit ? toneC : selected ? colors.borderStrong : colors.border,
          borderLeftWidth: lit ? 3 : selected ? 2 : 1,
          borderStyle: dim ? 'dashed' : 'solid',
          opacity: dim ? 0.72 : 1,
        },
        selected ? styles.nodeSelected : null,
        state.focused && Platform.OS === 'web' ? ({ outlineColor: colors.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 } as any) : null,
      ]}
    >
      <View style={styles.nodeHead}>
        {compact ? null : (
          <View style={[styles.nodeIcon, { backgroundColor: colors.surface2 }]}>
            <Icon name={step.icon} size={16} color={colors.text2} />
          </View>
        )}
        <Text numberOfLines={1} style={[styles.nodeTitle, { color: colors.text }]}>
          {step.name}
        </Text>
      </View>
      <Text numberOfLines={compact ? 3 : 2} style={[styles.nodeText, { color: lit ? colors.text2 : colors.muted }]}>
        {text}
      </Text>
      <View style={styles.nodeFoot}>
        <Status tone={tone} icon={data.icon || STATE_ICON[data.state]} label={data.label} size="sm" />
        {compact ? null : <Text style={[styles.nodeNum, { color: colors.muted }]}>{String(index + 1).padStart(2, '0')}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cap: { position: 'absolute', fontFamily: fonts.sansSemi, fontSize: fs.sm, textAlign: 'left' },
  node: {
    position: 'absolute',
    borderRadius: radius.md,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
    justifyContent: 'space-between',
  },
  nodeSelected: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  nodeHead: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  nodeIcon: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  nodeTitle: { flex: 1, fontFamily: fonts.sansSemi, fontSize: fs.md + 1 },
  nodeText: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 19 },
  nodeFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s2 },
  nodeNum: { fontFamily: fonts.mono, fontSize: fs.xs },
});
