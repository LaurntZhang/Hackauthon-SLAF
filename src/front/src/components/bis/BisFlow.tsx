/*
 * Parcours « avatarisé » : même graphe, mêmes liens et mêmes états que FlowCanvas, avec des personnages
 * sur les étapes tenues par des agents (proposition, risque, conformité, exécution) et par l'humain (gérant).
 * Mandat, décision et preuve restent des composants FinGuard sans IA : badge de composant, jamais de visage.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { EDGES, STATE_ICON, STATE_TONE, STEPS, type StepId, type StepsData } from '../../domain/steps';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft, type Palette } from '../../theme/tokens';
import { Icon } from '../Icon';
import { Status } from '../ui';
import { AvatarFigure } from './AvatarFigure';
import { CAST, CAPTION, type Agent } from './cast';

type Rect = { x: number; y: number; w: number; h: number };
type Layout = { rects: Record<StepId, Rect>; height: number; wide: boolean; cap: { x: number; y: number; w: number } | null };

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Même grille que le graphe classique, nœuds 30 % plus hauts (128 → 168 px) pour loger les personnages. */
function layoutFor(width: number): Layout {
  const W = Math.max(280, width);
  if (W >= 860) {
    const G = W >= 1100 ? 48 : 36;
    const colW = (W - 3 * G) / 4;
    const H = 168;
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
  const H = 154;
  const Hh = 176;
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

function BisFlowBase({ width, data, shown, onSelect }: Props) {
  const { colors } = useTheme();
  const layout = useMemo(() => layoutFor(width), [width]);
  const flow = useRef(new Animated.Value(0)).current;

  // Les liens actifs défilent dans le sens du flux ; arrêtés si l'utilisateur réduit les animations.
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(flow, { toValue: -20, duration: 1100, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [flow]);

  const edges = EDGES.map(([a, b]) => {
    const { pts, dir } = edgePoints(layout.rects[a], layout.rects[b]);
    const tone = edgeTone(a, b, data);
    const strong = tone !== 'idle' && tone !== 'skipped';
    return { key: `${a}-${b}`, d: roundedElbow(pts), head: arrowHead(pts[pts.length - 1], dir), color: edgeColor(colors, tone), strong, dashed: !strong };
  });

  return (
    <View style={{ width: Math.max(280, width), height: layout.height }} accessibilityRole="list" accessibilityLabel="Parcours de l'opération, de la proposition à la preuve">
      <Svg width={Math.max(280, width)} height={layout.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {edges.map((e) =>
          e.strong ? (
            <AnimatedPath key={e.key} d={e.d} stroke={e.color} strokeWidth={2} fill="none" strokeDasharray="6 4" strokeDashoffset={flow as unknown as number} />
          ) : (
            <Path key={e.key} d={e.d} stroke={e.color} strokeWidth={1.4} fill="none" strokeDasharray="4 4" />
          ),
        )}
        {edges.map((e) => (
          <Path key={`${e.key}-h`} d={e.head} fill={e.color} />
        ))}
      </Svg>
      {layout.cap ? <Text style={[styles.cap, { left: layout.cap.x, top: layout.cap.y, width: layout.cap.w, color: colors.text2 }]}>Contrôles indépendants</Text> : null}
      {STEPS.map((s, i) => (
        <Node key={s.id} index={i} id={s.id} rect={layout.rects[s.id]} half={!layout.wide && (s.id === 'risk' || s.id === 'compliance')} data={data[s.id]} selected={shown === s.id} onSelect={onSelect} />
      ))}
    </View>
  );
}

export const BisFlow = memo(BisFlowBase);

type NodeProps = { id: StepId; index: number; rect: Rect; half: boolean; data: StepsData[StepId]; selected: boolean; onSelect: (id: StepId) => void };

function Node({ id, index, rect, half, data, selected, onSelect }: NodeProps) {
  const { colors } = useTheme();
  const step = STEPS[index];
  const tone = STATE_TONE[data.state];
  const toneC = toneColor(colors, tone);
  const lit = data.state !== 'idle' && data.state !== 'skipped';
  const dim = data.state === 'skipped';
  const text = data.why || step.role;
  const agents = CAST[id] || [];
  const solo = agents.length <= 1;
  const active = data.state === 'active' || data.state === 'escalate';
  const enter = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 480, delay: index * 70, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter, index]);

  useEffect(() => {
    Animated.spring(lift, { toValue: selected ? 1 : 0, friction: 7, tension: 90, useNativeDriver: true }).start();
  }, [lift, selected]);

  const hover = (on: boolean) => Animated.spring(lift, { toValue: on || selected ? 1 : 0, friction: 7, tension: 90, useNativeDriver: true }).start();

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        opacity: enter,
        transform: [
          { perspective: 900 },
          { translateY: Animated.add(enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }), lift.interpolate({ inputRange: [0, 1], outputRange: [0, -4] })) },
          { rotateX: lift.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-2.5deg'] }) },
          { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }) },
        ],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${step.name}, étape ${index + 1} sur 8 : ${data.label}. ${text}`}
        accessibilityState={{ selected }}
        accessibilityHint="Affiche l'explication de l'étape"
        onPress={() => onSelect(id)}
        onHoverIn={() => hover(true)}
        onHoverOut={() => hover(false)}
        style={(state: any) => [
          styles.node,
          {
            backgroundColor: state.hovered ? colors.surface2 : colors.surface,
            borderColor: selected ? colors.borderStrong : data.state === 'active' ? colors.accent : colors.border,
            borderWidth: selected ? 2 : 1,
            borderLeftColor: lit ? toneC : selected ? colors.borderStrong : colors.border,
            borderLeftWidth: lit ? 3 : selected ? 2 : 1,
            borderStyle: dim ? 'dashed' : 'solid',
            opacity: dim ? 0.78 : 1,
          },
          selected ? styles.nodeSelected : null,
          state.focused && Platform.OS === 'web' ? ({ outlineColor: colors.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 } as any) : null,
        ]}
      >
        <View style={styles.nodeHead}>
          {half ? null : (
            <View style={[styles.nodeIcon, { backgroundColor: colors.surface2 }]}>
              <Icon name={step.icon} size={16} color={colors.text2} />
            </View>
          )}
          <Text numberOfLines={1} style={[styles.nodeTitle, { color: colors.text }]}>
            {step.name}
          </Text>
        </View>
        {solo ? (
          <View style={styles.soloRow}>
            {agents.length ? (
              <Figure agent={agents[0]} accent={toneC} active={active} delay={index * 90} small />
            ) : (
              <Engine icon={step.icon} caption={CAPTION[id]} tone={toneC} soft={toneSoft(colors, tone)} />
            )}
            <Text numberOfLines={3} style={[styles.nodeText, styles.soloText, { color: lit ? colors.text2 : colors.muted }]}>
              {text}
            </Text>
          </View>
        ) : (
          <>
            <Text numberOfLines={1} style={[styles.nodeText, { color: lit ? colors.text2 : colors.muted }]}>
              {text}
            </Text>
            <View style={styles.cast}>
              {agents.map((agent, i) => (
                <Figure key={agent.id} agent={agent} accent={toneC} active={active} delay={i * 260 + index * 90} small />
              ))}
            </View>
          </>
        )}

        <View style={styles.nodeFoot}>
          <Status tone={tone} icon={data.icon || STATE_ICON[data.state]} label={data.label} size="sm" />
          {half ? null : <Text style={[styles.nodeNum, { color: colors.muted }]}>{String(index + 1).padStart(2, '0')}</Text>}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function Figure({ agent, accent, active, delay, small }: { agent: Agent; accent: string; active: boolean; delay: number; small: boolean }) {
  const { colors } = useTheme();
  const bob = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const size = small ? 34 : 42;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1500, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, delay]);

  useEffect(() => {
    if (!active) {
      ring.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, ring]);

  return (
    <View style={styles.figure} accessible accessibilityLabel={`${agent.name}, ${agent.persona}`}>
      <View style={[styles.stand, { width: size + 14 }]}>
        <Animated.View style={[styles.ring, { width: size + 12, height: size + 12, borderRadius: (size + 12) / 2, borderColor: accent, opacity: ring, transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }] }]} />
        <View style={[styles.floor, { width: size * 0.9, backgroundColor: colors.text }]} />
        <Animated.View style={{ transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }, { rotateZ: bob.interpolate({ inputRange: [0, 1], outputRange: ['-1.5deg', '1.5deg'] }) }] }}>
          <AvatarFigure persona={agent} width={size} accent={accent} />
        </Animated.View>
      </View>
      <Text numberOfLines={1} style={[styles.figName, { color: colors.text }]}>
        {agent.name}
      </Text>
      <Text numberOfLines={1} style={[styles.figTag, { color: accent }]}>
        {agent.tag}
      </Text>
    </View>
  );
}

function Engine({ icon, caption, tone, soft }: { icon: Parameters<typeof Icon>[0]['name']; caption: string; tone: string; soft: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.figure}>
      <View style={[styles.engine, { backgroundColor: soft, borderColor: tone }]}>
        <Icon name={icon} size={22} color={tone} />
      </View>
      <Text numberOfLines={1} style={[styles.figName, { color: colors.text }]}>
        Composant
      </Text>
      <Text numberOfLines={1} style={[styles.figTag, { color: colors.muted }]}>
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cap: { position: 'absolute', fontFamily: fonts.sansSemi, fontSize: fs.sm, textAlign: 'left' },
  node: { flex: 1, borderRadius: radius.md, paddingHorizontal: space.s4, paddingVertical: space.s2 + 2, justifyContent: 'space-between' },
  nodeSelected: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  nodeHead: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  nodeIcon: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  nodeTitle: { flex: 1, fontFamily: fonts.sansSemi, fontSize: fs.md + 1 },
  nodeText: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 19 },
  cast: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-end' },
  soloRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  soloText: { flex: 1 },
  figure: { alignItems: 'center', minWidth: 62 },
  stand: { height: 46, alignItems: 'center', justifyContent: 'flex-end' },
  ring: { position: 'absolute', bottom: 0, borderWidth: 2 },
  floor: { position: 'absolute', bottom: -1, height: 6, borderRadius: 3, opacity: 0.16 },
  engine: { width: 46, height: 46, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  figName: { fontFamily: fonts.sansSemi, fontSize: 10.5, marginTop: 3 },
  figTag: { fontFamily: fonts.mono, fontSize: 9.5 },
  nodeFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s2 },
  nodeNum: { fontFamily: fonts.mono, fontSize: fs.xs },
});
