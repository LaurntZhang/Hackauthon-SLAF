/*
 * Fiche de décision (DecisionRecord) : construite uniquement à partir des événements journalisés du dossier.
 */
import { StyleSheet, Text, View } from 'react-native';

import { fmt, store } from '../../engine';
import { badge } from '../../domain/dashboard';
import { STATE_TONE, type StepState } from '../../domain/steps';
import * as W from '../../domain/wording';
import * as app from '../../state/app';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft } from '../../theme/tokens';
import { Sheet } from '../Overlays';
import { Button, Facts, Pill, Status } from '../ui';

const STATE_TEXT: Record<string, string> = {
  idle: 'en attente', active: 'en cours', pass: 'validée', escalate: 'escalade', warn: 'signalée', block: 'bloquée', skipped: 'non traversée', revoked: 'révoquée',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderTopColor: colors.line }]}>
      <Text accessibilityRole="header" style={[styles.h3, { color: colors.text }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function XaiSheet() {
  const { ui } = app.useApp();
  const { colors } = useTheme();
  const corr = ui.xaiCorr;
  const record = corr ? store.decisionRecord(corr) : null;
  const statusMap: Record<string, [string, string]> = {
    filled: ['filled', 'Exécutée'], blocked: ['blocked', 'Bloquée'], pending: ['pending', 'En attente du gérant'], running: ['running', 'En cours'],
  };
  return (
    <Sheet
      visible={Boolean(record)}
      onClose={() => app.openXai(null)}
      kicker="Explicabilité · AI Act art. 12"
      title={`Fiche de décision${corr ? ` · ${corr}` : ''}`}
      actions={record ? <Button label="JSON" icon="download" size="sm" variant="ghost" onPress={() => app.exportRecord(record.correlation_id)} /> : null}
    >
      {record ? (
        <View>
          <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {(() => {
              const [k, l] = statusMap[record.status] || ['neutral', record.status];
              const b = badge(k, l);
              return <Pill tone={b.tone} icon={b.icon} label={b.label} />;
            })()}
            <Text style={[styles.body, { color: colors.text }]}>{record.summary}</Text>
          </View>
          <Section title="Chemin suivi">
            <View style={styles.path}>
              {record.path.map((p) => {
                const tone = p.state === 'revoked' ? 'block' : STATE_TONE[p.state as StepState] || 'idle';
                const dim = p.state === 'idle' || p.state === 'skipped';
                return (
                  <View
                    key={p.id}
                    accessibilityLabel={`${p.label}${p.sub ? ` · ${p.sub}` : ''} (${STATE_TEXT[p.state] || p.state})`}
                    style={[styles.pathStep, { borderColor: dim ? colors.border : toneColor(colors, tone), backgroundColor: dim ? 'transparent' : toneSoft(colors, tone), borderStyle: p.state === 'skipped' ? 'dashed' : 'solid' }]}
                  >
                    <Text style={[styles.xs, { color: dim ? colors.muted : colors.text, fontFamily: fonts.sansMedium }]}>
                      {p.label}
                      {p.sub ? ` · ${p.sub}` : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Section>
          <Section title="Facteurs, dans l'ordre du journal">
            {record.factors.length ? (
              record.factors.map((f) => {
                const tone = f.effect === 'favorable' ? 'ok' : f.effect === 'adverse' ? 'block' : 'human';
                const b = f.status !== 'ok' && W.STATUS[f.status] ? badge(f.status) : null;
                return (
                  <View key={f.line} style={[styles.factor, { borderLeftColor: toneColor(colors, tone), backgroundColor: colors.surface }]}>
                    <View style={styles.factorHead}>
                      <Text style={[styles.strong, { color: colors.text }]}>{f.actor}</Text>
                      {b ? <Status tone={b.tone} icon={b.icon} label={b.label} size="sm" /> : null}
                      <Text style={[styles.mono, { color: colors.muted }]}>
                        n° {f.line} · {fmt.shortHash(f.hash)}
                      </Text>
                    </View>
                    <Text style={[styles.small, { color: colors.text2 }]}>{f.text}</Text>
                  </View>
                );
              })
            ) : (
              <Text style={[styles.small, { color: colors.muted }]}>Aucun facteur journalisé pour l'instant.</Text>
            )}
          </Section>
          <Section title="Votes des contrôles">
            {record.votes.length ? (
              record.votes.map((v) => {
                const b = badge(v.vote);
                return (
                  <View key={v.judge_id} style={[styles.vote, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <View style={styles.factorHead}>
                      <Text style={[styles.strong, { color: colors.text }]}>{fmt.actor(v.judge_id)}</Text>
                      <Status tone={b.tone} icon={b.icon} label={b.label} size="sm" />
                      <Text style={[styles.mono, { color: colors.muted }]}>confiance {typeof v.confidence === 'number' ? fmt.dec(v.confidence) : '—'}</Text>
                      {(v.rule_ids || []).map((r) => (
                        <Text key={r} style={[styles.rule, { color: colors.text2, borderColor: colors.border }]}>
                          {r}
                        </Text>
                      ))}
                    </View>
                    <Text style={[styles.small, { color: colors.text2 }]}>{v.justification}</Text>
                  </View>
                );
              })
            ) : (
              <Text style={[styles.small, { color: colors.muted }]}>Aucun vote : la transaction a été arrêtée avant les contrôles.</Text>
            )}
          </Section>
          <Section title={`Règles appliquées · ${record.policy_version}`}>
            {record.rules.length ? (
              record.rules.map((r) => (
                <View key={r.id} style={styles.ruleRow}>
                  <Text style={[styles.mono, { color: colors.accent, width: 72 }]}>{r.id}</Text>
                  <Text style={[styles.small, { color: colors.text, flex: 1 }]}>{r.label}</Text>
                </View>
              ))
            ) : (
              <Text style={[styles.small, { color: colors.muted }]}>Aucune règle déclenchée.</Text>
            )}
          </Section>
          <Section title="Incertitudes">
            {record.uncertainties.map((u) => (
              <Text key={u} style={[styles.small, { color: colors.text2 }]}>
                • {u}
              </Text>
            ))}
          </Section>
          <Section title="Preuves">
            <Facts rows={record.proofs.map((p) => [p.label, p.value] as [string, string])} />
          </Section>
          {record.redactions.length ? (
            <Section title="Masquages">
              {record.redactions.map((r) => (
                <Text key={r} style={[styles.small, { color: colors.text2 }]}>
                  • {r}
                </Text>
              ))}
            </Section>
          ) : null}
          <Text style={[styles.note, { color: colors.muted, borderTopColor: colors.line }]}>
            Fiche construite uniquement à partir des événements journalisés de {record.correlation_id} (AI Act art. 12 · journalisation). Elle décrit les règles, votes et décisions enregistrés ; elle ne reconstitue pas un raisonnement interne de modèle. La chaîne d'empreintes rend toute altération détectable ; elle ne la rend pas impossible.
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { borderWidth: 1, borderRadius: radius.md, padding: space.s4, gap: space.s3, marginTop: space.s4 },
  section: { borderTopWidth: 1, paddingVertical: space.s4, gap: space.s3, marginTop: space.s4 },
  h3: { fontFamily: fonts.sansSemi, fontSize: fs.md },
  body: { fontFamily: fonts.serif, fontSize: fs.md, lineHeight: 23 },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 19 },
  strong: { fontFamily: fonts.sansSemi, fontSize: fs.sm },
  xs: { fontSize: fs.xs, lineHeight: 17 },
  mono: { fontFamily: fonts.mono, fontSize: fs.xs },
  path: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pathStep: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.s3, paddingVertical: 4 },
  factor: { borderLeftWidth: 3, padding: space.s3, gap: 4, borderRadius: radius.sm },
  factorHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s2 },
  vote: { borderWidth: 1, borderRadius: radius.md, padding: space.s3, gap: 4 },
  rule: { fontFamily: fonts.mono, fontSize: fs.xs, borderWidth: 1, borderRadius: 3, paddingHorizontal: 5 },
  ruleRow: { flexDirection: 'row', gap: space.s3, alignItems: 'baseline' },
  note: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 17, borderTopWidth: 1, paddingTop: space.s4, marginTop: space.s2 },
});
