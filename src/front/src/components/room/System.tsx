/*
 * Section 05 : le système sous contrôle — agents et mandats (score de confiance), limites du jour, superviseur.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, fmt, store } from '../../engine';
import { actorIcon, AGENT_ROLES, badge, meter } from '../../domain/dashboard';
import * as app from '../../state/app';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft } from '../../theme/tokens';
import { Icon } from '../Icon';
import { Bar, Button, SectionHead, Status } from '../ui';

function PanelHead({ title, hint }: { title: string; hint: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.panelHead, { borderBottomColor: colors.line }]}>
      <Text accessibilityRole="header" style={[styles.panelTitle, { color: colors.text }]}>
        {title}
      </Text>
      <Text style={[styles.xs, { color: colors.muted }]}>{hint}</Text>
    </View>
  );
}

function Agents() {
  const { colors } = useTheme();
  return (
    <View style={styles.panel}>
      <PanelHead title="Agents et mandats" hint="score de confiance" />
      {C.AGENTS.map((a: { id: string; name: string; mission: string; forbidden: string; max_amount: number | null }) => {
        const st = store.agents[a.id];
        const reduced = st.trust < C.LIMITS.trustReduced;
        const low = st.trust < C.LIMITS.trustQuarantine;
        const chip = st.quarantined ? badge('quarantined') : reduced ? { tone: 'human' as const, icon: 'arrowDownRight' as const, label: 'Plafond ÷ 2' } : { tone: 'neutral' as const, icon: 'check' as const, label: 'Actif' };
        const forbidden = `${a.forbidden.charAt(0).toLowerCase()}${a.forbidden.slice(1)}`;
        const limits = a.max_amount ? `Plafond ${fmt.eur(reduced ? a.max_amount / 2 : a.max_amount)} · interdit : ${forbidden}.` : `Interdit : ${forbidden}.`;
        const valueText = `${st.trust} sur 100${st.quarantined ? ', en quarantaine' : reduced ? ', plafond divisé par deux' : ''}`;
        return (
          <View key={a.id} style={[styles.agent, { borderBottomColor: colors.line }, st.quarantined && { backgroundColor: colors.blockSoft }]}>
            <View style={styles.agentHead}>
              <View style={[styles.avatar, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}>
                <Icon name={actorIcon(a.id)} size={16} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.strong, { color: colors.text }]}>{a.name}</Text>
                <Text style={[styles.xs, { color: colors.text2 }]}>{AGENT_ROLES[a.id] || a.mission}</Text>
              </View>
              <Status tone={chip.tone} icon={chip.icon} label={chip.label} size="sm" />
            </View>
            <View style={styles.trustRow}>
              <View style={{ flex: 1 }}>
                <Bar ratio={st.trust / 100} tone={low ? 'block' : reduced ? 'human' : 'neutral'} marks={[0.4, 0.7]} height={8} label={`Score de confiance ${a.name}`} valueText={valueText} />
              </View>
              <Text style={[styles.monoStrong, { color: colors.text }]}>{st.trust}</Text>
            </View>
            <Text style={[styles.xs, { color: colors.muted }]}>{limits}</Text>
            {st.quarantined ? <Button label="Lever la quarantaine (humain)" icon="user" size="sm" block onPress={() => app.liftQuarantine(a.id)} /> : null}
          </View>
        );
      })}
      <View style={styles.scale}>
        <Text style={[styles.xs, { color: colors.muted }]}>sous 70 : plafond divisé par 2</Text>
        <Text style={[styles.xs, { color: colors.muted }]}>sous 40 : quarantaine</Text>
      </View>
    </View>
  );
}

function Meter({ label, value, max, text, note }: { label: string; value: number; max: number; text: string; note: string }) {
  const { colors } = useTheme();
  const m = meter(value, max);
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.meterHead}>
        <Text style={[styles.small, { color: colors.text, flex: 1 }]}>{label}</Text>
        <Text style={[styles.monoStrong, { color: colors.text }]}>{text}</Text>
      </View>
      <Bar ratio={m.ratio} tone={m.tone === 'ok' ? 'active' : m.tone} label={label} valueText={`${text}${m.flag ? ` · ${m.flag.toLowerCase()}` : ''}`} />
      <Text style={[styles.xs, { color: m.flag ? toneColor(colors, m.tone) : colors.muted }]}>
        {m.flag ? `${m.flag} ` : ''}
        {note}
      </Text>
    </View>
  );
}

function Limits() {
  const { colors } = useTheme();
  const r = store.risk;
  const open = r.breaker === 'open';
  const kill = store.kill.global;
  const line = (label: string, on: boolean, onLabel: string, offLabel: string, offIcon: 'check' | 'power') => (
    <View style={[styles.stateLine, { borderTopColor: colors.line }, on && { backgroundColor: colors.blockSoft }]}>
      <Text style={[styles.strong, { color: colors.text, flex: 1 }]}>{label}</Text>
      {on ? <Status tone="block" icon="power" label={onLabel} size="sm" /> : <Status tone="neutral" icon={offIcon} label={offLabel} size="sm" />}
    </View>
  );
  return (
    <View style={styles.panel}>
      <PanelHead title="Limites du jour" hint="avant tout ordre · réf. RTS 6" />
      <View style={{ gap: space.s4, paddingTop: space.s3 }}>
        <Meter
          label="Budget autonome du Proposer"
          value={r.daily}
          max={r.dailyLimit}
          text={`${fmt.eur(r.daily)} / ${fmt.eur(r.dailyLimit)}`}
          note={`Hors opérations signées par le gérant (${fmt.eur(r.humanApproved)} validés aujourd'hui).`}
        />
        <Meter label="Ordres sur 60 secondes" value={r.freq} max={r.freqLimit} text={`${r.freq} / ${r.freqLimit}`} note={r.lastCheck ? `Dernier contrôle à ${fmt.time(r.lastCheck)}.` : "Aucun contrôle pour l'instant."} />
        <Meter label="Refus consécutifs" value={r.rejects} max={r.rejectLimit} text={`${r.rejects} / ${r.rejectLimit}`} note="Au-delà : le coupe-circuit s'ouvre." />
        <View>
          {line('Coupe-circuit', open, 'Ouvert', 'Fermé', 'check')}
          {open ? <Button label="Réarmer (superviseur humain)" icon="reset" size="sm" block onPress={app.resetBreaker} /> : null}
          {line("Arrêt d'urgence", kill, 'Actif', 'Inactif', 'power')}
        </View>
      </View>
    </View>
  );
}

function Supervisor() {
  const { colors } = useTheme();
  const list = store.alerts.slice(0, 8);
  return (
    <View style={styles.panel}>
      <PanelHead title="Superviseur" hint="observe, alerte, demande l'isolement" />
      <View style={{ gap: space.s2, paddingTop: space.s3 }} accessibilityLiveRegion="polite">
        {list.length ? (
          list.map((a) => {
            const critical = a.severity === 'critical';
            const tone = critical ? 'block' : 'human';
            return (
              <View key={a.index} style={[styles.alert, { backgroundColor: toneSoft(colors, tone), borderLeftColor: toneColor(colors, tone) }]}>
                <Icon name={critical ? 'alert' : 'eye'} size={16} color={toneColor(colors, tone)} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.strong, { color: colors.text }]}>
                    {a.title} <Text style={[styles.xs, { color: toneColor(colors, tone) }]}>{critical ? 'critique' : 'vigilance'}</Text>
                  </Text>
                  <Text style={[styles.small, { color: colors.text2 }]}>{a.text}</Text>
                  <View style={styles.alertMeta}>
                    <Text style={[styles.xs, { color: colors.muted }]}>{fmt.time(a.at)}</Text>
                    {a.corr ? (
                      <Pressable accessibilityRole="link" onPress={() => app.pinDossier(a.corr)} hitSlop={8}>
                        <Text style={[styles.xs, { color: colors.accent, fontFamily: fonts.sansSemi, textDecorationLine: 'underline' }]}>Voir le dossier {a.corr}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <Text style={[styles.small, { color: colors.text2 }]}>Aucune alerte. Le superviseur lit le journal en continu ; il peut demander l'isolement d'un agent, jamais décider ni exécuter.</Text>
        )}
        {store.alerts.length > list.length ? <Text style={[styles.xs, { color: colors.muted }]}>{store.alerts.length - list.length} alerte(s) plus ancienne(s) dans le journal.</Text> : null}
      </View>
    </View>
  );
}

export function SystemUnderControl({ columns }: { columns: number }) {
  return (
    <View style={{ gap: space.s4 }}>
      <SectionHead title="Le système sous contrôle" hint="Ce que chaque agent a le droit de faire, les limites du jour et ce que le superviseur a remarqué." />
      <View style={[styles.grid, columns === 1 && { flexDirection: 'column' }]}>
        <View style={styles.col}>
          <Agents />
        </View>
        <View style={styles.col}>
          <Limits />
        </View>
        <View style={styles.col}>
          <Supervisor />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s5 },
  col: { flexGrow: 1, flexBasis: 280, minWidth: 260 },
  panel: { gap: 0 },
  panelHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: space.s2, paddingBottom: space.s2, borderBottomWidth: 1 },
  panelTitle: { fontFamily: fonts.serifSemi, fontSize: fs.lg },
  agent: { gap: 6, paddingVertical: space.s3, borderBottomWidth: 1, paddingHorizontal: 2, borderRadius: radius.sm },
  agentHead: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  avatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.s2 },
  meterHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.s2 },
  stateLine: { flexDirection: 'row', alignItems: 'center', gap: space.s2, borderTopWidth: 1, paddingVertical: space.s3, paddingHorizontal: 4, minHeight: 44 },
  alert: { flexDirection: 'row', gap: space.s3, padding: space.s3, borderLeftWidth: 3, borderRadius: radius.sm },
  alertMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s3 },
  strong: { fontFamily: fonts.sansSemi, fontSize: fs.sm + 0.5, lineHeight: 20 },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 19 },
  xs: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 17 },
  monoStrong: { fontFamily: fonts.monoMedium, fontSize: fs.xs },
});
