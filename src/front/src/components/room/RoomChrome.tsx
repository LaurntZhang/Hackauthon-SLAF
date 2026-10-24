/*
 * Habillage de la salle de contrôle : barre supérieure (contexte, preuve, arrêt d'urgence), bandeaux,
 * charte « les agents proposent… chaque étape est prouvée », barre d'état.
 */
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fmt, store, transport } from '../../engine';
import { simState, statusbar } from '../../domain/dashboard';
import { plural } from '../../domain/steps';
import * as app from '../../state/app';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft } from '../../theme/tokens';
import { Icon, type IconName } from '../Icon';
import { Brand, ThemeToggle } from '../Tower';
import { Button, IconButton, Notice } from '../ui';

function ProofPill() {
  const { colors } = useTheme();
  const v = store.verification;
  const tone = v.state === 'valid' ? 'ok' : v.state === 'broken' ? 'block' : 'idle';
  const text =
    v.state === 'valid' ? `chaîne intègre · ${plural(v.checked, 'événement')}` : v.state === 'broken' ? `falsification détectée · n° ${v.broken_at + 1}` : 'non vérifiée';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Preuve : ${text}`}
      accessibilityHint="Ouvre le journal de preuve et vérifie que la chaîne d'événements n'a pas été modifiée"
      onPress={() => {
        app.setTab('audit');
        app.verifyAndAnnounce();
      }}
      style={(state: any) => [
        styles.pill,
        {
          borderColor: tone === 'idle' ? colors.border : toneColor(colors, tone),
          backgroundColor: tone === 'idle' ? (state.hovered ? colors.surface2 : colors.surface) : toneSoft(colors, tone),
        },
        state.focused && Platform.OS === 'web' ? ({ outlineColor: colors.focus, outlineWidth: 2, outlineStyle: 'solid' } as any) : null,
      ]}
    >
      <Icon name={v.state === 'broken' ? 'linkBroken' : 'link'} size={16} color={tone === 'idle' ? colors.text2 : toneColor(colors, tone)} />
      <Text style={[styles.small, { color: colors.text }]} numberOfLines={1}>
        Preuve : <Text style={{ fontFamily: fonts.sansSemi }}>{text}</Text>
      </Text>
    </Pressable>
  );
}

export function RoomHeader() {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const { width } = useWindowDimensions();
  // Paliers : très large = tout le contexte ; large = sans le fonds ; étroit = preuve et séance sur une 2e ligne.
  const compact = width < 1200;
  const roomy = width >= 1600;
  const st = simState(ui.running, Boolean(ui.replay));
  const kill = store.kill.global;
  const ctx: [string, string, string?][] = [
    ...(roomy ? ([['FONDS', 'Alpha · 10 M€ · profil prudent']] as [string, string][]) : []),
    ['MODE', transport.mode === 'live' ? `API live · ${store.connection || 'connexion…'}` : 'Simulation locale · hors ligne'],
    ['SÉANCE', st.label, st.tone],
  ];
  // Mobile : deux lignes seulement (marque + réglages, puis preuve + arrêt d'urgence).
  // L'état de la séance est porté par les indicateurs des onglets.
  if (width < 600) {
    return (
      <View style={[styles.topNarrow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.narrowRow}>
          <Brand subtitle="Salle de contrôle" />
          <View style={[styles.narrowRow, { marginLeft: 'auto' }]}>
            <IconButton icon="eye" label="Mode jury" onPress={() => router.push('/')} />
            <ThemeToggle compact />
          </View>
        </View>
        <View style={styles.narrowRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ProofPill />
          </View>
          <Button label={kill ? 'Réarmer' : "Arrêt d'urgence"} accessibilityLabel={kill ? "Réarmer l'exécution" : "Arrêt d'urgence"} icon="power" size="sm" variant={kill ? 'danger' : 'dangerOutline'} disabled={Boolean(ui.replay)} onPress={app.toggleKill} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.top, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <Brand subtitle="Gouverner les agents IA, garder la main" />
      {compact ? null : (
        <View style={styles.context} accessibilityLabel="Contexte de la démonstration">
          {ctx.map(([label, value, tone]) => (
            <View key={label} style={[styles.ctxItem, { borderLeftColor: colors.line }]}>
              <Text style={[styles.ctxLabel, { color: colors.muted }]}>{label}</Text>
              <Text style={[styles.small, { color: tone && tone !== 'neutral' ? toneColor(colors, tone as 'human') : colors.text, fontFamily: tone ? fonts.sansSemi : fonts.sans }]}>{value}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.actions}>
        {!roomy ? (
          <IconButton icon="eye" label="Mode jury" onPress={() => router.push('/')} />
        ) : (
          <Button label="Mode jury" icon="eye" size="sm" variant="ghost" onPress={() => router.push('/')} />
        )}
        {compact ? null : <ProofPill />}
        <Button label={kill ? "Réarmer l'exécution" : "Arrêt d'urgence"} icon="power" size="sm" variant={kill ? 'danger' : 'dangerOutline'} disabled={Boolean(ui.replay)} onPress={app.toggleKill} />
        <ThemeToggle compact />
      </View>
      {compact ? (
        <View style={styles.compactCtx}>
          <ProofPill />
          <Text style={[styles.xs, { color: st.tone !== 'neutral' ? toneColor(colors, st.tone) : colors.muted }]}>Séance : {st.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function RoomBanners() {
  const { ui } = app.useApp();
  const parts = [];
  if (store.kill.global) {
    parts.push(
      <Notice key="kill" tone="block" icon="power" text={`Arrêt d'urgence actif : aucun ordre n'atteint le marché. Déclenché par ${fmt.actor(store.kill.by || '')} à ${fmt.time(store.kill.at || new Date().toISOString())}.`}
        action={<Button label="Réarmer" size="sm" onPress={app.toggleKill} />} />,
    );
  }
  const p = store.pending;
  if (p && !ui.phoneOpen && !ui.replay) {
    const intent = p.card.intent;
    parts.push(
      <Notice key="pending" tone="human" icon="user"
        text={`Une décision attend le gérant sur ${p.corr} : ${fmt.side(intent.side).toLowerCase()} de ${fmt.eur(intent.amount)} de ${p.card.asset_label}. Le traitement est suspendu jusqu'à sa signature (AI Act art. 14).`}
        action={<Button label="Ouvrir la validation" size="sm" variant="primary" onPress={app.openPhone} />} />,
    );
  }
  if (ui.replay) {
    parts.push(
      <Notice key="replay" tone="active" icon="replay" text={`Relecture du journal (${ui.replay.index}/${ui.replay.total}) : lecture seule, aucune décision n'est rejouée.`}
        action={<Button label="Arrêter" size="sm" onPress={app.stopReplay} />} />,
    );
  }
  if (ui.error) parts.push(<Notice key="error" tone="block" icon="alert" text={ui.error} />);
  if (!parts.length) return null;
  // Bandeaux hors onglets : une décision en attente ou un arrêt d'urgence restent visibles partout.
  return <View style={{ gap: space.s2, paddingHorizontal: space.s4, paddingTop: space.s3 }}>{parts}</View>;
}

const CHARTER: { icon: IconName; verb: string; text: string; core?: boolean }[] = [
  { icon: 'users', verb: 'Les agents proposent', text: 'Ils préparent des opérations, sans aucun accès au marché.' },
  { icon: 'gate', verb: 'Les contrôles vérifient', text: "FinGuard, des règles fixes sans IA : la seule porte vers l'action.", core: true },
  { icon: 'user', verb: "L'humain tranche", text: "Sollicité quand le risque l'exige ; sa décision est signée." },
  { icon: 'send', verb: "L'exécution est séparée", text: "La passerelle applique l'autorisation ; elle ne décide jamais." },
  { icon: 'link', verb: 'Chaque étape est prouvée', text: 'Les événements sont chaînés dans un journal vérifiable.' },
];

export function Charter() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  // Bureau : les cinq étapes partagent la largeur. Tablette / mobile : bandeau défilant à largeur fixe.
  const fits = width >= 1100;
  const body = (
      <View style={[styles.charter, { borderColor: colors.border, backgroundColor: colors.canvas }, !fits && { minWidth: undefined }]}>
        {CHARTER.map((c, i) => (
          <View
            key={c.verb}
            style={[
              styles.charterStep,
              fits ? { flex: 1 } : { width: 250 },
              i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.line },
              c.core && { backgroundColor: colors.accentSoft, borderLeftColor: colors.accent, borderLeftWidth: 3 },
            ]}
          >
            <View style={[styles.charterIcon, { borderColor: c.icon === 'user' ? colors.humanLine : colors.borderStrong, backgroundColor: c.icon === 'user' ? colors.humanSoft : colors.surface }]}>
              <Icon name={c.icon} size={18} color={c.icon === 'user' ? colors.human : colors.text} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.verb, { color: c.core ? colors.accentStrong : colors.text }]}>{c.verb}</Text>
              <Text style={[styles.xs, { color: colors.text2 }]}>{c.text}</Text>
            </View>
          </View>
        ))}
      </View>
  );
  if (fits) return <View accessibilityLabel="Comment ManAgent garde la maîtrise des agents">{body}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Comment ManAgent garde la maîtrise des agents">
      {body}
    </ScrollView>
  );
}

export function StatusBar({ inline }: { inline?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statusbar, { borderTopColor: colors.border, backgroundColor: inline ? 'transparent' : colors.surface }, inline && { paddingHorizontal: 0 }]}>
      {statusbar().map((s) => (
        <Text key={s.text} style={[styles.xs, { color: s.bad ? colors.block : colors.muted }]}>
          {s.text}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s4, paddingHorizontal: space.s5, paddingVertical: space.s3, borderBottomWidth: 1 },
  context: { flexDirection: 'row', gap: space.s4, flex: 1, justifyContent: 'center' },
  ctxItem: { borderLeftWidth: 1, paddingLeft: space.s4, gap: 1 },
  ctxLabel: { fontFamily: fonts.sansSemi, fontSize: 12, letterSpacing: 0.7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s2, marginLeft: 'auto' },
  compactCtx: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s3, width: '100%' },
  topNarrow: { paddingHorizontal: space.s4, paddingVertical: space.s2, gap: space.s2, borderBottomWidth: 1 },
  narrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.s3, minHeight: 40, flexShrink: 1 },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 19 },
  xs: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 17 },
  charter: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  charterStep: { flexDirection: 'row', gap: space.s3, padding: space.s3, alignItems: 'flex-start' },
  charterIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  verb: { fontFamily: fonts.serifSemi, fontSize: fs.md },
  statusbar: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s5, rowGap: 2, paddingHorizontal: space.s5, paddingVertical: space.s2, borderTopWidth: 1 },
});
