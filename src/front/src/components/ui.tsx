/*
 * Primitives d'interface de la charte : texte, boutons, statuts, cartes.
 * Cibles tactiles ≥ 44 px, retour visuel au survol / à l'appui, anneau de focus visible au clavier (web).
 */
import { type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft, type Palette, type Tone } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

type TxtVariant = 'body' | 'small' | 'xs' | 'label' | 'title' | 'display' | 'serif' | 'mono' | 'italic' | 'strong';

const variantStyle: Record<TxtVariant, TextStyle> = {
  body: { fontFamily: fonts.sans, fontSize: fs.md, lineHeight: 22 },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 20 },
  xs: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 18 },
  label: { fontFamily: fonts.sansMedium, fontSize: fs.sm, lineHeight: 18 },
  strong: { fontFamily: fonts.sansSemi, fontSize: fs.md, lineHeight: 22 },
  title: { fontFamily: fonts.serifSemi, fontSize: fs.x2, lineHeight: 34 },
  display: { fontFamily: fonts.serifSemi, fontSize: fs.x3, lineHeight: 46 },
  serif: { fontFamily: fonts.serifSemi, fontSize: fs.xl, lineHeight: 28 },
  mono: { fontFamily: fonts.mono, fontSize: fs.xs, lineHeight: 18 },
  italic: { fontFamily: fonts.serifItalic, fontSize: fs.md, lineHeight: 22 },
};

type TxtProps = TextProps & { variant?: TxtVariant; color?: keyof Palette | string; style?: StyleProp<TextStyle> };

export function Txt({ variant = 'body', color = 'text', style, ...rest }: TxtProps) {
  const { colors } = useTheme();
  const c = (colors as Record<string, string>)[color] || color;
  return <Text {...rest} style={[variantStyle[variant], { color: c }, style]} />;
}

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'warn' | 'danger' | 'dangerOutline' | 'approve';

type ButtonProps = {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  busy?: boolean;
  block?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

function buttonColors(p: Palette, variant: ButtonVariant) {
  switch (variant) {
    case 'primary':
      return { bg: p.accent, fg: p.onAccent, border: p.accent, hover: p.accentStrong };
    case 'approve':
      return { bg: p.accent, fg: p.onAccent, border: p.accent, hover: p.accentStrong };
    case 'warn':
      return { bg: p.human, fg: p.onHuman, border: p.human, hover: p.humanLine };
    case 'danger':
      return { bg: p.block, fg: p.onBlock, border: p.block, hover: p.block };
    case 'dangerOutline':
      return { bg: 'transparent', fg: p.block, border: p.block, hover: p.blockSoft };
    case 'ghost':
      return { bg: 'transparent', fg: p.text2, border: p.border, hover: p.surface2 };
    default:
      return { bg: p.surface, fg: p.text, border: p.border, hover: p.surface2 };
  }
}

export function Button({ label, icon, onPress, variant = 'outline', size = 'md', disabled, busy, block, accessibilityLabel, accessibilityHint, style }: ButtonProps) {
  const { colors } = useTheme();
  const c = buttonColors(colors, variant);
  const off = disabled || busy;
  const h = size === 'sm' ? 40 : size === 'lg' ? 52 : 46;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      disabled={off}
      onPress={onPress}
      style={(state: any) => [
        styles.btn,
        {
          minHeight: Math.max(44, h),
          paddingHorizontal: size === 'sm' ? space.s3 : space.s4,
          backgroundColor: off ? colors.surface2 : state.pressed || state.hovered ? c.hover : c.bg,
          borderColor: off ? colors.border : c.border,
          opacity: state.pressed ? 0.9 : 1,
        },
        block && styles.block,
        state.focused && Platform.OS === 'web' ? ({ outlineColor: colors.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 } as any) : null,
        style,
      ]}
    >
      {icon ? <Icon name={busy ? 'progress' : icon} size={size === 'lg' ? 20 : 17} color={off ? colors.muted : c.fg} /> : null}
      <Text
        numberOfLines={1}
        style={[
          variant === 'primary' || variant === 'approve' || variant === 'warn' || variant === 'danger' ? styles.btnTextStrong : styles.btnText,
          { color: off ? colors.muted : c.fg, fontSize: size === 'lg' ? fs.md + 1 : size === 'sm' ? fs.sm : fs.md },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Bouton icône seul : libellé accessible obligatoire. */
export function IconButton({ icon, label, onPress, size = 44 }: { icon: IconName; label: string; onPress: () => void; size?: number }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={(state: any) => [
        styles.iconBtn,
        { width: size, height: size, borderColor: colors.border, backgroundColor: state.hovered || state.pressed ? colors.surface2 : colors.surface },
        state.focused && Platform.OS === 'web' ? ({ outlineColor: colors.focus, outlineWidth: 2, outlineStyle: 'solid' } as any) : null,
      ]}
    >
      <Icon name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

/** Statut lisible : icône + libellé, la couleur n'est jamais le seul porteur du sens. */
export function Status({ tone, icon, label, size = 'md' }: { tone: Tone; icon: IconName; label: string; size?: 'sm' | 'md' }) {
  const { colors } = useTheme();
  const color = toneColor(colors, tone);
  return (
    <View style={styles.status}>
      <Icon name={icon} size={size === 'sm' ? 14 : 16} color={color} />
      <Text style={{ fontFamily: fonts.sansSemi, fontSize: size === 'sm' ? fs.xs : fs.sm, color }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/** Bandeau d'alerte avec action de correction éventuelle. */
export function Notice({ tone, icon, title, text, action }: { tone: Tone; icon: IconName; title?: string; text: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole={tone === 'block' ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: toneSoft(colors, tone), borderColor: toneColor(colors, tone) }]}
    >
      <Icon name={icon} size={18} color={toneColor(colors, tone)} />
      <Text style={[styles.noticeText, { color: colors.text }]}>
        {title ? <Text style={{ fontFamily: fonts.sansSemi }}>{title} </Text> : null}
        {text}
      </Text>
      {action}
    </View>
  );
}

/** En-tête de section éditorial : numéro, titre serif, filet supérieur et indication. */
export function SectionHead({ num, title, hint, right }: { num?: string; title: string; hint?: string; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sectionHead, { borderTopColor: colors.text }]}>
      <View style={styles.sectionRow}>
        {num ? <Text style={[styles.sectionNum, { color: colors.muted }]}>{num}</Text> : null}
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
          {title}
        </Text>
        {right ? <View style={styles.sectionRight}>{right}</View> : null}
      </View>
      {hint ? <Text style={[styles.sectionHint, { color: colors.text2 }]}>{hint}</Text> : null}
    </View>
  );
}

/** Barre de progression (jauge) : la valeur est toujours répétée en texte à côté. */
export function Bar({ ratio, tone, marks, height = 6, label, valueText }: { ratio: number; tone: Tone; marks?: number[]; height?: number; label: string; valueText: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100), text: valueText }}
      style={[styles.bar, { height, backgroundColor: colors.surface2, borderColor: colors.border }]}
    >
      <View style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: '100%', backgroundColor: toneColor(colors, tone), borderRadius: height }} />
      {(marks || []).map((m) => (
        <View key={m} style={[styles.barMark, { left: `${m * 100}%`, backgroundColor: colors.borderStrong }]} />
      ))}
    </View>
  );
}

/** Pastille de statut encadrée (statut d'un dossier, d'un cas). */
export function Pill({ tone, icon, label }: { tone: Tone; icon: IconName; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pill, { borderColor: toneColor(colors, tone), backgroundColor: toneSoft(colors, tone) }]}>
      <Status tone={tone} icon={icon} label={label} size="sm" />
    </View>
  );
}

export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: Tone }) {
  const { colors } = useTheme();
  const top = tone && tone !== 'idle' && tone !== 'neutral' ? toneColor(colors, tone) : colors.border;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderTopColor: top, borderTopWidth: tone && tone !== 'idle' ? 2 : 1 }, style]}>
      {children}
    </View>
  );
}

export function Eyebrow({ icon, label, color }: { icon?: IconName; label: string; color?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.eyebrow}>
      {icon ? <Icon name={icon} size={15} color={color || colors.muted} /> : null}
      <Text style={{ fontFamily: fonts.sansMedium, fontSize: fs.sm, color: color || colors.muted }}>{label}</Text>
    </View>
  );
}

/** Liste clé / valeur (dl). */
export function Facts({ rows }: { rows: [string, string][] }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.s2 }}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.factRow}>
          <Text style={[styles.factKey, { color: colors.muted }]}>{k}</Text>
          <Text style={[styles.factVal, { color: colors.text }]}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s2,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  block: { alignSelf: 'stretch' },
  btnText: { fontFamily: fonts.sansMedium },
  btnTextStrong: { fontFamily: fonts.sansSemi },
  iconBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.s3,
    paddingVertical: space.s3,
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  noticeText: { flex: 1, minWidth: 200, fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.s4, gap: 6 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionHead: { borderTopWidth: 2, paddingTop: space.s3, gap: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: space.s3 },
  sectionNum: { fontFamily: fonts.monoMedium, fontSize: fs.xs },
  sectionTitle: { fontFamily: fonts.serifSemi, fontSize: fs.xl, lineHeight: 28 },
  sectionRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: space.s2, flexWrap: 'wrap' },
  sectionHint: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 20 },
  bar: { width: '100%', borderRadius: 99, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  barMark: { position: 'absolute', top: 0, bottom: 0, width: 1.5 },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.s3, paddingVertical: 4, alignSelf: 'flex-start' },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s4, rowGap: 2 },
  factKey: { width: 140, fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 20 },
  factVal: { flex: 1, minWidth: 140, fontFamily: fonts.sansMedium, fontSize: fs.sm, lineHeight: 20 },
});
