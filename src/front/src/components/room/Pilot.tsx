import { LIVE_ASSETS, LIVE_COUNTERPARTIES } from '../../engine/liveCatalog';
/*
 * Colonne de pilotage : cas de démonstration S1–S6, variantes à composer, formulaire d'opération, animation.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { transport, C, store } from '../../engine';
import { badge, CASES, latestRun, PRESETS } from '../../domain/dashboard';
import * as app from '../../state/app';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, radius, space } from '../../theme/tokens';
import { Icon, type IconName } from '../Icon';
import { Button, Status, Txt } from '../ui';

type CaseIssue = app.Issue & { agent?: string };

function issuesFor(key: string, ui: app.UiState): CaseIssue[] {
  const list: CaseIssue[] = [];
  if (key === 'salami') {
    for (const agent of ['proposer', 'executor']) {
      if (store.agents[agent] && store.agents[agent].quarantined) {
        list.push({ code: 'quarantine', agent, message: `Le ${C.ACTORS[agent].name} est en quarantaine. Seul un humain peut la lever avant ce cas.` });
      }
    }
    if (store.risk.breaker === 'open') list.push({ code: 'breaker', message: 'Le coupe-circuit est ouvert. Un humain doit le réarmer.' });
    if (store.kill.global) list.push({ code: 'kill', message: "L'arrêt d'urgence est actif. Un humain doit réarmer l'exécution." });
  }
  if (ui.issuesKey === key) {
    for (const i of ui.issues as CaseIssue[]) if (!list.some((x) => x.code === i.code && x.agent === i.agent)) list.push(i);
  }
  return list;
}

function FixButton({ issue }: { issue: CaseIssue }) {
  if (issue.code === 'quarantine' && issue.agent) return <Button label="Lever la quarantaine" icon="user" size="sm" onPress={() => app.liftQuarantine(issue.agent as string)} />;
  if (issue.code === 'breaker') return <Button label="Réarmer le coupe-circuit" icon="reset" size="sm" onPress={app.resetBreaker} />;
  if (issue.code === 'kill') return <Button label="Réarmer l'exécution" icon="power" size="sm" onPress={app.toggleKill} />;
  return null;
}

function CaseItem({ icon, id, title, text, expected, children, active }: { icon: IconName; id?: string; title: string; text: string; expected: string; children?: React.ReactNode; active?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.case, { borderBottomColor: colors.line }, active && { borderLeftWidth: 3, borderLeftColor: colors.text, paddingLeft: space.s3 }]}>
      <View style={[styles.caseIcon, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
        <Icon name={icon} size={18} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.caseTitle, { color: colors.text }]}>
          {id ? <Text style={[styles.mono, { color: colors.muted }]}>{id}  </Text> : null}
          {title}
        </Text>
        <Text style={[styles.small, { color: colors.text2 }]}>{text}</Text>
        <Text style={[styles.small, { color: colors.text2 }]}>
          <Text style={{ fontFamily: fonts.sansSemi, color: colors.text }}>Attendu : </Text>
          {expected}
        </Text>
        {children}
      </View>
    </View>
  );
}

function Cases() {
  const { ui } = app.useApp();
  const { colors } = useTheme();
  const busy = app.busy();
  return (
    <View style={{ gap: space.s2 }}>
      <View style={styles.headRow}>
        <Txt variant="serif" accessibilityRole="header" style={{ fontSize: fs.lg }}>
          Cas de démonstration
        </Txt>
        <Txt variant="xs" color="muted">
          hors ligne · sans LLM
        </Txt>
      </View>
      {C.SCENARIOS.map((s: { id: string; key: string; title: string; input: string; expected: string; quote: string }) => {
        const meta = CASES[s.key] || { icon: 'play', title: s.title, text: s.input, expected: s.expected };
        const run = latestRun(s.id);
        const running = ui.running === s.key;
        const issues = issuesFor(s.key, ui);
        const label = running ? 'En cours' : run ? 'Relancer' : 'Lancer';
        const blocked = issues.some((i) => ['quarantine', 'breaker', 'kill'].includes(i.code));
        let status = null;
        if (running) {
          const b = store.pending ? badge('pending', 'En attente du gérant') : badge('running', 'En cours…');
          status = <Status tone={b.tone} icon={b.icon} label={b.label} size="sm" />;
        } else if (run && run.completed) {
          const b = run.completed.matched ? badge('valid', `Conforme : ${run.completed.obtained}`) : badge('mismatch', `Écart : ${run.completed.obtained}`);
          status = <Status tone={b.tone} icon={b.icon} label={b.label} size="sm" />;
        }
        return (
          <CaseItem key={s.key} icon={meta.icon} id={s.id} title={meta.title} text={meta.text} expected={meta.expected} active={running}>
            {issues.length ? (
              <View style={[styles.issue, { backgroundColor: colors.humanSoft, borderLeftColor: colors.humanLine }]}>
                {issues.map((i) => (
                  <View key={`${i.code}-${i.agent || ''}`} style={{ gap: 6 }}>
                    <Text style={[styles.small, { color: colors.text }]}>{i.message}</Text>
                    <FixButton issue={i} />
                  </View>
                ))}
              </View>
            ) : null}
            {running || (run && run.completed) ? <Text style={[styles.quote, { color: colors.text2 }]}>{s.quote}</Text> : null}
            {status ? <View style={{ marginTop: 2 }}>{status}</View> : null}
            <View style={[styles.caseFoot, { justifyContent: 'flex-end' }]}>
              <Button
                label={label}
                icon="play"
                size="sm"
                accessibilityLabel={`${label} le cas ${s.id} : ${meta.title}`}
                disabled={busy || blocked}
                busy={running}
                onPress={() => app.runScenario(s.key)}
              />
            </View>
          </CaseItem>
        );
      })}
      <Txt variant="xs" color="text2" style={{ marginTop: space.s2 }}>
        Deux variantes à composer soi-même, via le formulaire :
      </Txt>
      {PRESETS.map((p) => (
        <CaseItem key={p.key} icon={p.icon} title={p.title} text={p.text} expected={p.expected}>
          <View style={[styles.caseFoot, { justifyContent: 'flex-end' }]}>
            <Button label="Pré-remplir" icon="edit" size="sm" variant="ghost" disabled={busy} accessibilityLabel={`Pré-remplir le formulaire : ${p.title}`} onPress={() => app.applyPreset(p.spec, p.title)} />
          </View>
        </CaseItem>
      ))}
    </View>
  );
}

function Choice({ options, value, onChange, label }: { options: { value: string; label: string; hint?: string }[]; value: string; onChange: (v: string) => void; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={[styles.fieldLabel, { color: colors.text2 }]}>{label}</Text>
      <View style={styles.choices}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${o.label}${o.hint ? `, ${o.hint}` : ''}`}
              onPress={() => onChange(o.value)}
              style={(state: any) => [
                styles.choice,
                { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : state.hovered ? colors.surface2 : colors.surface },
              ]}
            >
              <Text style={[styles.small, { color: active ? colors.accentStrong : colors.text, fontFamily: active ? fonts.sansSemi : fonts.sans }]}>{o.label}</Text>
              {o.hint ? <Text style={[styles.xs, { color: o.hint.startsWith('hors') ? colors.block : colors.muted }]}>{o.hint}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Composer() {
  const { ui } = app.useApp();
  const { colors } = useTheme();
  const c = ui.composer;
  const busy = app.busy();
  const assets = Object.entries(transport.mode === 'live' ? LIVE_ASSETS : C.ASSETS).map(([id, a]: [string, any]) => ({
    value: id,
    label: a.label,
    hint: !['bond', 'equity', 'cash'].includes(a.type) ? 'hors univers' : C.ASSET_TYPE_LABELS[a.type],
  }));
  const cptys = [
    ...(transport.mode === 'live' ? LIVE_COUNTERPARTIES : C.COUNTERPARTIES).map((x: string) => ({ value: x, label: x, hint: 'KYC' })),
    ...C.UNLISTED_COUNTERPARTIES.map((x: string) => ({ value: x, label: x, hint: 'hors liste blanche' })),
  ];
  return (
    <View style={[styles.composer, { borderTopColor: colors.line }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: c.open }} onPress={() => app.setComposer({ open: !c.open })} style={styles.composerToggle}>
        <Text accessibilityRole="header" style={[styles.caseTitle, { color: colors.text, fontFamily: fonts.serifSemi, fontSize: fs.lg }]}>
          Composer une opération
        </Text>
        <View style={{ transform: [{ rotate: c.open ? '-90deg' : '90deg' }] }}>
          <Icon name="chevron" size={16} color={colors.text2} />
        </View>
      </Pressable>
      {c.open ? (
        <View style={{ gap: space.s4 }}>
          <Txt variant="small" color="text2">
            Le gérant fixe un objectif ; l'agent Proposer le traduit en opération, FinGuard la contrôle.
          </Txt>
          <Choice label="Actif" options={assets} value={c.asset} onChange={(asset) => app.setComposer({ asset })} />
          <Choice
            label="Sens"
            options={[
              { value: 'buy', label: 'Achat' },
              { value: 'sell', label: 'Vente' },
            ]}
            value={c.side}
            onChange={(side) => app.setComposer({ side: side as 'buy' | 'sell' })}
          />
          <View style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: colors.text2 }]}>Montant (€)</Text>
            <TextInput
              value={c.amount}
              onChangeText={(amount) => app.setComposer({ amount, error: null })}
              keyboardType="numeric"
              inputMode="numeric"
              accessibilityLabel="Montant en euros"
              accessibilityHint="Au-delà de 10 000 € : validation humaine"
              style={[styles.input, { color: colors.text, borderColor: c.error ? colors.block : colors.border, backgroundColor: colors.surface }]}
            />
            <View style={styles.hint}>
              <Icon name="info" size={14} color={colors.muted} />
              <Text style={[styles.xs, { color: colors.muted }]}>Au-delà de 10 000 € : validation humaine.</Text>
            </View>
            {c.error ? (
              <View accessibilityRole="alert" style={styles.hint}>
                <Icon name="alert" size={14} color={colors.block} />
                <Text style={[styles.xs, { color: colors.block, fontFamily: fonts.sansMedium }]}>{c.error}</Text>
              </View>
            ) : null}
          </View>
          <Choice label="Contrepartie" options={cptys} value={c.counterparty} onChange={(counterparty) => app.setComposer({ counterparty })} />
          <Button label="Confier au Proposer" icon="send" variant="primary" block disabled={busy} busy={ui.running === 'manual'} onPress={app.submitComposer} />
        </View>
      ) : null}
    </View>
  );
}

function DemoControls() {
  const { ui } = app.useApp();
  const { colors } = useTheme();
  return (
    <View style={[styles.composer, { borderTopColor: colors.line, gap: space.s3 }]}>
      <Txt variant="serif" accessibilityRole="header" style={{ fontSize: fs.lg }}>
        Animation de la démo
      </Txt>
      <View style={[styles.headRow, { justifyContent: 'flex-start', gap: space.s2 }]}>
        <Switch value={ui.fast} onValueChange={app.setFast} accessibilityLabel="Animation rapide" trackColor={{ true: colors.accent, false: colors.border }} thumbColor={colors.surface} />
        <Txt variant="small" color="text2">
          Vitesse rapide
        </Txt>
      </View>
      <Button label="Ouvrir l'écran mobile du gérant" icon="phone" block onPress={() => router.push('/gerant')} />
      <Button label="Réinitialiser la démo" icon="reset" variant="ghost" block onPress={app.resetDemo} />
    </View>
  );
}

export function Pilot() {
  return (
    <View style={{ gap: space.s5 }} accessibilityLabel="Pilotage de la démonstration">
      <Cases />
      <Composer />
      <DemoControls />
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: space.s2 },
  case: { flexDirection: 'row', gap: space.s3, paddingVertical: space.s3, borderBottomWidth: 1 },
  caseIcon: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  caseTitle: { fontFamily: fonts.sansSemi, fontSize: fs.md, lineHeight: 21 },
  caseFoot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s2, marginTop: 4 },
  issue: { borderLeftWidth: 3, padding: space.s3, gap: space.s2, borderRadius: radius.sm },
  quote: { fontFamily: fonts.serifItalic, fontSize: fs.sm, lineHeight: 20 },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 19 },
  xs: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 17 },
  mono: { fontFamily: fonts.monoMedium, fontSize: fs.xs },
  composer: { borderTopWidth: 1, paddingTop: space.s3, gap: space.s2 },
  composerToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  fieldLabel: { fontFamily: fonts.sansSemi, fontSize: fs.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  choice: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.s3, paddingVertical: 6, minHeight: 44, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.s3, minHeight: 46, fontFamily: fonts.sans, fontSize: fs.md },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
