/*
 * Section 03 : chaîne de décision horizontale (8 étapes, un responsable distinct par étape) et légende.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Tx } from '../../engine/types';
import { computeSteps, STATE_ICON, STATE_TONE, STEPS, type StepId } from '../../domain/steps';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, space, toneColor, toneSoft, type Tone } from '../../theme/tokens';
import { Icon, type IconName } from '../Icon';
import { SectionHead, Status } from '../ui';

const ACTOR: Record<StepId, string> = {
  proposal: 'AGENT IA', mandate: 'FINGUARD', risk: 'AGENT JUGE', compliance: 'AGENT JUGE',
  decision: 'FINGUARD', human: 'GÉRANT', execution: 'FINGUARD', proof: 'JOURNAL',
};

const LEGEND: [Tone, IconName, string][] = [
  ['ok', 'check', 'Validée'],
  ['active', 'progress', 'En cours'],
  ['human', 'user', 'Humain sollicité'],
  ['block', 'lock', 'Bloquée'],
  ['idle', 'minusCircle', 'Non requise ou non atteinte'],
];

export function Chain({ tx }: { tx: Tx | null }) {
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const data = computeSteps(tx);
  // Largeur d'étape calculée : la chaîne remplit la section, et défile sous 8 × 110 px.
  const stepW = w ? Math.max(118, Math.floor(w / STEPS.length)) : 118;
  return (
    <View style={{ gap: space.s4 }} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      <SectionHead num="03" title="Chaîne de décision" hint="De la proposition à la preuve : chaque étape a un responsable distinct, aucun agent ne parle directement à un autre." />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chain} accessibilityLabel="Étapes de la décision">
          {STEPS.map((s, i) => {
            const d = data[s.id];
            const tone = STATE_TONE[d.state];
            const c = d.state === 'idle' || d.state === 'skipped' ? colors.muted : toneColor(colors, tone);
            const nextLit = i < STEPS.length - 1 && !['idle', 'skipped'].includes(data[STEPS[i + 1].id].state);
            return (
              <View key={s.id} style={[styles.step, { width: stepW }]} accessibilityLabel={`${String(i + 1).padStart(2, '0')} ${s.nav} (${ACTOR[s.id].toLowerCase()}) : ${d.label}. ${d.why}`}>
                <View style={styles.markerRow}>
                  <View
                    style={[
                      styles.marker,
                      {
                        borderColor: c,
                        borderStyle: d.state === 'skipped' ? 'dashed' : 'solid',
                        backgroundColor: d.state === 'pass' ? toneColor(colors, 'ok') : d.state === 'idle' || d.state === 'skipped' ? colors.surface : toneSoft(colors, tone),
                      },
                    ]}
                  >
                    <Icon name={s.icon} size={17} color={d.state === 'pass' ? colors.surface : c} />
                  </View>
                  {i < STEPS.length - 1 ? <View style={[styles.link, { backgroundColor: nextLit ? toneColor(colors, 'ok') : colors.border }]} /> : null}
                </View>
                <Text style={[styles.num, { color: colors.muted }]}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={[styles.name, { color: d.state === 'skipped' ? colors.muted : colors.text }]}>{s.nav}</Text>
                <Text style={[styles.actor, { color: colors.muted }]}>{ACTOR[s.id]}</Text>
                <Status tone={tone} icon={d.icon || STATE_ICON[d.state]} label={d.label} size="sm" />
                {d.why ? (
                  <Text style={[styles.why, { color: colors.text2 }]} numberOfLines={4}>
                    {d.why}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.legend} accessibilityLabel="Légende des étapes">
        {LEGEND.map(([tone, icon, label]) => (
          <Status key={label} tone={tone} icon={icon} label={label} size="sm" />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chain: { flexDirection: 'row' },
  step: { gap: 3, paddingRight: space.s3 },
  markerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s2 },
  marker: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  link: { flex: 1, height: 2, marginLeft: space.s2 },
  num: { fontFamily: fonts.monoMedium, fontSize: fs.xs },
  name: { fontFamily: fonts.sansSemi, fontSize: fs.md - 0.5, lineHeight: 20 },
  actor: { fontFamily: fonts.sansSemi, fontSize: fs.xs - 1, letterSpacing: 0.6, marginBottom: 2 },
  why: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 17 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.s5, rowGap: space.s2 },
});
