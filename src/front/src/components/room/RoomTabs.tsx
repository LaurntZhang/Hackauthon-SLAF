/*
 * Barre d'onglets de la salle de contrôle. Chaque onglet porte un indicateur d'état
 * (décision en attente, journal altéré, alertes…) pour qu'aucun signal ne reste caché derrière un onglet fermé.
 */
import { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { C, store } from '../../engine';
import { latestRun } from '../../domain/dashboard';
import * as app from '../../state/app';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft, type Tone } from '../../theme/tokens';
import { Icon, type IconName } from '../Icon';

type TabDef = { id: app.RoomTab; icon: IconName; label: string; short: string };

const TABS: TabDef[] = [
  { id: 'operation', icon: 'folder', label: 'Opération en cours', short: 'Opération' },
  { id: 'feed', icon: 'users', label: 'Récit des décisions', short: 'Récit' },
  { id: 'audit', icon: 'link', label: 'Journal de preuve', short: 'Journal' },
  { id: 'system', icon: 'shield', label: 'Système sous contrôle', short: 'Système' },
  { id: 'cases', icon: 'flask', label: 'Scénarios', short: 'Scénarios' },
];

type Indicator = { text: string; tone: Tone; spoken: string } | null;

/** Indicateur d'un onglet, lu uniquement dans l'état dérivé du journal. */
function indicator(id: app.RoomTab, ui: app.UiState): Indicator {
  if (id === 'operation') {
    if (store.pending) return { text: 'À signer', tone: 'human', spoken: 'une décision attend le gérant' };
    const tx = app.roomTx();
    if (ui.running) return { text: 'En cours', tone: 'active', spoken: 'opération en cours' };
    if (tx && tx.final) {
      return tx.final.status === 'filled'
        ? { text: 'Exécutée', tone: 'ok', spoken: 'dernière opération exécutée' }
        : { text: 'Bloquée', tone: 'block', spoken: 'dernière opération bloquée' };
    }
    return null;
  }
  if (id === 'feed') {
    const n = store.runOrder.length;
    return n ? { text: String(n), tone: 'neutral', spoken: `${n} séquence${n > 1 ? 's' : ''}` } : null;
  }
  if (id === 'audit') {
    const v = store.verification;
    const n = store.events.length;
    if (v.state === 'broken') return { text: `Altéré n° ${v.broken_at + 1}`, tone: 'block', spoken: `journal altéré à l'événement ${v.broken_at + 1}` };
    if (!n) return null;
    return { text: String(n), tone: v.state === 'valid' ? 'ok' : 'neutral', spoken: `${n} événements${v.state === 'valid' ? ', chaîne intègre' : ''}` };
  }
  if (id === 'system') {
    const quarantined = Object.values(store.agents).some((a) => a.quarantined);
    if (store.kill.global) return { text: 'Arrêt', tone: 'block', spoken: "arrêt d'urgence actif" };
    if (store.risk.breaker === 'open') return { text: 'Coupe-circuit', tone: 'block', spoken: 'coupe-circuit ouvert' };
    if (quarantined) return { text: 'Quarantaine', tone: 'block', spoken: 'un agent est en quarantaine' };
    const n = store.alerts.length;
    if (!n) return null;
    const critical = store.alerts.some((a) => a.severity === 'critical');
    return { text: String(n), tone: critical ? 'block' : 'human', spoken: `${n} alerte${n > 1 ? 's' : ''} du superviseur` };
  }
  const done = C.SCENARIOS.filter((s: { id: string }) => {
    const run = latestRun(s.id);
    return run && run.completed && run.completed.matched;
  }).length;
  return done ? { text: `${done}/${C.SCENARIOS.length}`, tone: 'ok', spoken: `${done} cas conformes sur ${C.SCENARIOS.length}` } : null;
}

export function RoomTabs({ showCases, short }: { showCases: boolean; short: boolean }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const tabs = TABS.filter((t) => showCases || t.id !== 'cases');
  const scroller = useRef<ScrollViewInstance>(null);
  const offsets = useRef<Partial<Record<app.RoomTab, number>>>({});

  // L'onglet actif est toujours ramené dans la zone visible (bascule automatique au lancement d'un cas).
  useEffect(() => {
    const x = offsets.current[ui.tab];
    if (typeof x === 'number') scroller.current?.scrollTo({ x: Math.max(0, x - space.s4), animated: true });
  }, [ui.tab]);

  return (
    <View style={[styles.bar, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list} accessibilityRole="tablist">
        {tabs.map((t) => {
          const active = ui.tab === t.id;
          const ind = indicator(t.id, ui);
          const icon: IconName = t.id === 'audit' && store.verification.state === 'broken' ? 'linkBroken' : t.icon;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${t.label}${ind ? `, ${ind.spoken}` : ''}`}
              onPress={() => app.setTab(t.id)}
              onLayout={(e) => {
                offsets.current[t.id] = e.nativeEvent.layout.x;
              }}
              style={(state: any) => [
                styles.tab,
                { borderBottomColor: active ? colors.accent : 'transparent', backgroundColor: !active && state.hovered ? colors.surface2 : 'transparent' },
                state.focused && Platform.OS === 'web' ? ({ outlineColor: colors.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: -2 } as any) : null,
              ]}
            >
              <Icon name={icon} size={17} color={active ? colors.accent : colors.text2} />
              <Text style={[styles.label, { color: active ? colors.text : colors.text2, fontFamily: active ? fonts.sansSemi : fonts.sansMedium }]}>{short ? t.short : t.label}</Text>
              {ind ? (
                <View
                  style={[
                    styles.badge,
                    ind.tone === 'neutral'
                      ? { backgroundColor: colors.surface2, borderColor: colors.border }
                      : { backgroundColor: toneSoft(colors, ind.tone), borderColor: toneColor(colors, ind.tone) },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: ind.tone === 'neutral' ? colors.text2 : toneColor(colors, ind.tone) }]}>{ind.text}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: 1 },
  list: { paddingHorizontal: space.s4, gap: space.s1 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingHorizontal: space.s3, minHeight: 50, borderBottomWidth: 3, marginBottom: -1, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  label: { fontSize: fs.sm + 0.5 },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1, minWidth: 22, alignItems: 'center' },
  badgeText: { fontFamily: fonts.sansSemi, fontSize: 12 },
});
