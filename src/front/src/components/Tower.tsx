/*
 * Blocs de la tour de contrôle : marque, suivi des étapes, barre d'outils, synthèse, explication, saisie.
 */
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { C, fmt, store, transport } from '../engine';
import type { Tx } from '../engine/types';
import { parseHint, parseObjective, STATE_ICON, STATE_SHORT, STATE_TONE, STEP, STEPS, type StepId, type StepsData, type Verdict } from '../domain/steps';
import * as app from '../state/app';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft } from '../theme/tokens';
import { Icon } from './Icon';
import { Button, Card, Eyebrow, Notice, Status, Txt } from './ui';

export function Brand({ subtitle }: { subtitle: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.brand, { flexShrink: 1 }]}>
      <View style={[styles.brandMark, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}>
        <Icon name="logo" size={20} color={colors.accent} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={[styles.brandName, { color: colors.text }]}>ManAgent</Text>
        <Text numberOfLines={1} style={[styles.brandSub, { color: colors.muted }]}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { name, toggle, colors } = useTheme();
  const next = name === 'dark' ? 'jour' : 'nuit';
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: name === 'dark' }}
      accessibilityLabel={`Thème nuit ${name === 'dark' ? 'activé' : 'désactivé'}`}
      accessibilityHint={`Passe au thème ${next}`}
      onPress={toggle}
      style={(state: any) => [
        styles.toggle,
        { borderColor: colors.border, backgroundColor: state.hovered || state.pressed ? colors.surface2 : colors.surface },
        state.focused && Platform.OS === 'web' ? ({ outlineColor: colors.focus, outlineWidth: 2, outlineStyle: 'solid' } as any) : null,
      ]}
    >
      <View style={[styles.toggleSeg, name === 'light' && { backgroundColor: colors.accentSoft }]}>
        <Icon name="sun" size={16} color={name === 'light' ? colors.accent : colors.muted} />
        {compact ? null : <Text style={[styles.toggleText, { color: name === 'light' ? colors.accent : colors.muted }]}>Jour</Text>}
      </View>
      <View style={[styles.toggleSeg, name === 'dark' && { backgroundColor: colors.accentSoft }]}>
        <Icon name="moon" size={16} color={name === 'dark' ? colors.accent : colors.muted} />
        {compact ? null : <Text style={[styles.toggleText, { color: name === 'dark' ? colors.accent : colors.muted }]}>Nuit</Text>}
      </View>
    </Pressable>
  );
}

function sideSubtitle(tx: Tx | null) {
  if (!tx) return `${C.FUND.name} · aucune opération`;
  const f = tx.final;
  const state = f ? (f.status === 'filled' ? 'exécutée' : 'bloquée') : tx.hitl && tx.hitl.status === 'pending' ? 'en attente du gérant' : 'en cours';
  return `${C.FUND.name} · ${tx.corr} ${state}`;
}

/** Suivi de l'exécution : liste verticale (bureau) ou bandeau défilant (tablette, mobile). */
export function StepTracker({ tx, data, shown, horizontal }: { tx: Tx | null; data: StepsData; shown: StepId; horizontal?: boolean }) {
  const { colors } = useTheme();
  const items = STEPS.map((s) => {
    const d = data[s.id];
    const tone = STATE_TONE[d.state];
    const selected = shown === s.id;
    return (
      <Pressable
        key={s.id}
        accessibilityRole="button"
        accessibilityLabel={`${s.nav} : ${d.short || STATE_SHORT[d.state]}`}
        accessibilityState={{ selected }}
        onPress={() => app.selectStep(s.id)}
        style={(state: any) => [
          horizontal ? styles.chip : styles.stepItem,
          {
            backgroundColor: selected ? colors.surface : state.hovered ? colors.surface2 : 'transparent',
            borderColor: selected ? colors.borderStrong : horizontal ? colors.border : 'transparent',
          },
          !horizontal && selected ? { borderLeftColor: colors.accent, borderLeftWidth: 3 } : null,
        ]}
      >
        <View style={[styles.stepMarker, { borderColor: d.state === 'idle' ? colors.border : toneColor(colors, tone), backgroundColor: d.state === 'idle' ? 'transparent' : toneSoft(colors, tone) }]}>
          <Icon name={s.icon} size={15} color={d.state === 'idle' ? colors.muted : toneColor(colors, tone)} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text numberOfLines={1} style={[styles.stepName, { color: d.state === 'skipped' ? colors.muted : colors.text }]}>
            {s.nav}
          </Text>
          <Status tone={tone} icon={d.icon || STATE_ICON[d.state]} label={d.short || STATE_SHORT[d.state]} size="sm" />
        </View>
      </Pressable>
    );
  });
  if (horizontal) {
    return (
      <View style={{ gap: space.s2 }}>
        <View style={{ paddingHorizontal: space.s4 }}>
          <Txt variant="strong">Suivi de l'exécution</Txt>
          <Txt variant="small" color="muted">
            {sideSubtitle(tx)}
          </Txt>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s2, paddingHorizontal: space.s4 }}>
          {items}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={{ gap: space.s1 }}>
      <View style={{ marginBottom: space.s3 }}>
        <Txt variant="strong">Suivi de l'exécution</Txt>
        <Txt variant="small" color="muted">
          {sideSubtitle(tx)}
        </Txt>
      </View>
      {items}
    </View>
  );
}

export function Toolbar({ stacked }: { stacked?: boolean }) {
  const { ui } = app.useApp();
  const kill = store.kill.global;
  const replaying = Boolean(ui.replay);
  return (
    <View style={[styles.toolbar, stacked && { justifyContent: 'flex-start' }]} accessibilityLabel="Preuve et pilotage">
      <Button label="Journal de preuve" icon="link" size="sm" onPress={() => app.openDrawer({ type: 'journal' })} />
      <Button
        label={replaying ? 'Arrêter la relecture' : 'Rejouer'}
        icon={replaying ? 'pause' : 'replay'}
        size="sm"
        variant="ghost"
        disabled={!replaying && (Boolean(ui.running) || !store.events.length)}
        onPress={replaying ? app.stopReplay : app.startReplay}
      />
      <Button label="Exporter la preuve" icon="download" size="sm" variant="ghost" disabled={!store.events.length} onPress={app.exportJournal} />
      <Button label={kill ? "Réarmer l'exécution" : "Arrêt d'urgence"} icon="power" size="sm" variant={kill ? 'danger' : 'dangerOutline'} disabled={replaying} onPress={app.toggleKill} />
    </View>
  );
}

export function Notices() {
  const { ui } = app.useApp();
  const parts = [];
  if (store.kill.global) {
    parts.push(
      <Notice key="kill" tone="block" icon="power" title="Arrêt d'urgence actif." text="Aucun ordre n'atteint le marché ; les contrôles et le journal continuent."
        action={ui.replay ? undefined : <Button label="Réarmer l'exécution" size="sm" onPress={app.toggleKill} />} />,
    );
  }
  if (ui.replay) {
    parts.push(
      <Notice key="replay" tone="active" icon="replay" title={`Relecture du journal (${ui.replay.index}/${ui.replay.total}) :`} text="lecture seule, aucune décision n'est rejouée."
        action={<Button label="Arrêter" size="sm" onPress={app.stopReplay} />} />,
    );
  }
  for (const agent of ['proposer', 'executor']) {
    if (store.agents[agent] && store.agents[agent].quarantined && !ui.replay) {
      parts.push(
        <Notice key={agent} tone="human" icon="lock" title={`${agent === 'proposer' ? "L'agent de proposition" : "L'agent d'exécution"} est isolé`}
          text="après un comportement anormal. Toute nouvelle opération est bloquée jusqu'à une revue humaine."
          action={<Button label="Lever la quarantaine" size="sm" onPress={() => app.liftQuarantine(agent)} />} />,
      );
    }
  }
  if (store.risk.breaker === 'open' && !ui.replay) {
    parts.push(
      <Notice key="breaker" tone="human" icon="gauge" title="Coupe-circuit ouvert." text="Trop d'ordres en peu de temps : l'exécution reste suspendue jusqu'au réarmement humain."
        action={<Button label="Réarmer le coupe-circuit" size="sm" onPress={app.resetBreaker} />} />,
    );
  }
  for (const issue of ui.issues) {
    if (['quarantine', 'breaker', 'kill'].includes(issue.code)) continue;
    parts.push(<Notice key={issue.message} tone="block" icon="alert" text={issue.message} />);
  }
  if (ui.error) parts.push(<Notice key="error" tone="block" icon="alert" text={ui.error} />);
  if (!parts.length) return null;
  return <View style={{ gap: space.s2 }}>{parts}</View>;
}

export function SummaryCards({ tx, verdict, columns }: { tx: Tx | null; verdict: Verdict; columns: number }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const v = store.verification;
  const pv =
    v.state === 'broken'
      ? { tone: 'block' as const, icon: 'linkBroken' as const, label: 'Journal altéré', text: `Une modification a été détectée dans le journal (événement n° ${v.broken_at + 1}).` }
      : v.state === 'valid' && v.checked
        ? { tone: 'ok' as const, icon: 'link' as const, label: 'Journal intègre', text: `La preuve cryptographique du journal est valide · ${v.checked} événement${v.checked > 1 ? 's' : ''}.` }
        : {
            tone: 'idle' as const,
            icon: 'circleDashed' as const,
            label: store.events.length ? 'Non vérifié' : 'Journal vide',
            text: store.events.length ? `${store.events.length} événement${store.events.length > 1 ? 's' : ''} à vérifier.` : 'Chaque étape y sera inscrite et chaînée.',
          };
  const basis = columns >= 3 ? { flexBasis: 0, flexGrow: 1 } : { flexBasis: '100%' as const };
  const i = tx && tx.intent;
  return (
    <View style={[styles.summary, columns >= 3 && { flexWrap: 'nowrap' }]} accessibilityLabel="Synthèse de l'opération">
      <Card style={basis}>
        <Eyebrow icon="folder" label="Opération" />
        {i ? (
          <>
            <Txt variant="serif">
              {fmt.side(i.side)} · {fmt.eur(i.amount)}
            </Txt>
            <Txt variant="small" color="text2">
              {tx!.assetLabel} · {i.counterparty}
            </Txt>
            <Txt variant="xs" color="muted">
              <Text style={{ fontFamily: fonts.mono }}>{tx!.corr}</Text> · proposée à {fmt.time(tx!.startedAt)}
            </Txt>
          </>
        ) : (
          <>
            <Txt variant="serif" color="text2">
              {tx ? 'En préparation' : 'Aucune'}
            </Txt>
            <Txt variant="small" color="text2">
              {tx ? "L'agent lit les données de marché." : `${C.FUND.name} · 10 M€ · profil prudent`}
            </Txt>
          </>
        )}
      </Card>
      <Card style={[basis, columns >= 3 && { flexGrow: 1.6 }]} tone={verdict.tone}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1, gap: 6, minWidth: 200 }}>
            <Eyebrow icon="gate" label="Décision" />
            <View style={styles.verdict}>
              <Icon name={verdict.icon} size={20} color={toneColor(colors, verdict.tone === 'idle' ? 'neutral' : verdict.tone)} />
              <Text style={[styles.verdictText, { color: verdict.tone === 'idle' ? colors.text2 : toneColor(colors, verdict.tone) }]}>{verdict.label}</Text>
            </View>
          </View>
          {verdict.cta && !ui.replay ? <Button label="Ouvrir la validation" icon="phone" variant="warn" size="sm" onPress={app.openPhone} /> : null}
        </View>
        <Txt variant="small" color="text2">
          {verdict.text}
        </Txt>
      </Card>
      <Card style={basis}>
        <Eyebrow icon="link" label="Preuve" />
        <View style={styles.verdict}>
          <Icon name={pv.icon} size={20} color={pv.tone === 'idle' ? colors.text2 : toneColor(colors, pv.tone)} />
          <Text style={[styles.verdictText, { color: pv.tone === 'idle' ? colors.text2 : toneColor(colors, pv.tone) }]}>{pv.label}</Text>
        </View>
        <Txt variant="small" color="text2">
          {pv.text}
        </Txt>
      </Card>
    </View>
  );
}

export function ExplainPanel({ tx, data, shown, stacked }: { tx: Tx | null; data: StepsData; shown: StepId; stacked?: boolean }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const s = STEP[shown];
  const d = data[shown];
  const tone = STATE_TONE[d.state];
  const index = STEPS.indexOf(s) + 1;
  const mode = ui.pinned ? 'Étape sélectionnée' : tx ? 'Suivi en direct' : 'Parcours';
  const pendingHere = shown === 'human' && store.pending && !ui.replay;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.explain, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: tone === 'idle' ? colors.borderStrong : toneColor(colors, tone) }, stacked && { flexDirection: 'column', alignItems: 'stretch' }]}
    >
      {stacked ? null : (
        <View style={[styles.explainIcon, { backgroundColor: colors.surface2 }]}>
          <Icon name={s.icon} size={20} color={colors.text2} />
        </View>
      )}
      <View style={{ flex: stacked ? undefined : 1, gap: 4 }}>
        <View style={styles.explainHead}>
          <Text accessibilityRole="header" style={[styles.explainTitle, { color: colors.text }]}>
            {s.nav}
          </Text>
          <Txt variant="small" color="muted">
            {mode} · étape {index} sur {STEPS.length}
          </Txt>
        </View>
        {tx ? (
          <View style={styles.explainResult}>
            <Status tone={tone} icon={d.icon || STATE_ICON[d.state]} label={d.label} />
            {d.why ? <Txt variant="small">{d.why}</Txt> : null}
          </View>
        ) : (
          <Txt variant="small">Saisissez une opération ou choisissez un scénario : chaque étape s'éclaire au fil des contrôles.</Txt>
        )}
        <Txt variant="small" color="muted">
          {s.purpose}
        </Txt>
      </View>
      <View style={[styles.explainActions, stacked && { flexDirection: 'column', alignItems: 'stretch' }]}>
        {pendingHere ? <Button label="Ouvrir la validation" icon="phone" variant="warn" size="sm" onPress={app.openPhone} /> : null}
        <Button label="Voir les détails techniques" icon="terminal" size="sm" onPress={() => app.openDrawer({ type: 'step', id: s.id })} />
        {ui.pinned && tx ? <Button label="Suivre en direct" icon="play" size="sm" variant="ghost" onPress={app.follow} /> : null}
      </View>
    </View>
  );
}

export function ActionBar({ narrow }: { narrow?: boolean }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const disabled = app.busy();
  const hint = ui.inputError ? { ok: false, text: ui.inputError } : parseHint(parseObjective(ui.input));
  return (
    <View style={[styles.action, { borderTopColor: colors.line, backgroundColor: colors.bg }]}>
      <View style={[styles.actionRow, narrow && { flexDirection: 'column', alignItems: 'stretch' }]}>
        <View style={[styles.field, { borderColor: ui.inputError ? colors.block : colors.border, backgroundColor: colors.surface }]}>
          <Icon name="edit" size={17} color={colors.muted} />
          <TextInput
            value={ui.input}
            onChangeText={app.setInput}
            onSubmitEditing={() => app.submitText(ui.input)}
            editable={!disabled}
            placeholder="Ex. acheter 4 000 € d'OAT pour le fonds Alpha…"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Opération à vérifier, en langage courant"
            accessibilityHint="Décrivez le sens, le montant, l'actif et la contrepartie"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="send"
            style={[styles.input, { color: colors.text }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
          />
        </View>
        <View style={styles.actionButtons}>
          <Button label="Scénarios" icon="flask" variant="outline" disabled={disabled} onPress={() => app.setMenu(true)} style={narrow ? { flex: 1 } : undefined} />
          <Button
            label={ui.running ? 'Vérification en cours…' : 'Lancer la vérification'}
            icon="play"
            variant="primary"
            busy={Boolean(ui.running)}
            disabled={disabled}
            onPress={() => app.submitText(ui.input)}
            style={narrow ? { flex: 2 } : undefined}
          />
        </View>
      </View>
      {hint ? (
        <View style={styles.hint} accessibilityLiveRegion="polite">
          <Icon name={hint.ok ? 'check' : 'info'} size={15} color={hint.ok ? colors.ok : ui.inputError ? colors.block : colors.muted} />
          <Text style={[styles.hintText, { color: hint.ok ? colors.text2 : ui.inputError ? colors.block : colors.muted }]}>{hint.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function SideLinks() {
  const { colors } = useTheme();
  const link = (icon: 'phone' | 'terminal', label: string, onPress: () => void) => (
    <Pressable accessibilityRole="link" onPress={onPress} style={(state: any) => [styles.sideLink, state.hovered && { backgroundColor: colors.surface2 }]}>
      <Icon name={icon} size={16} color={colors.text2} />
      <Text style={[styles.sideLinkText, { color: colors.text2 }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.sideFoot, { borderTopColor: colors.line }]}>
      {link('terminal', 'Vue technique complète', () => router.push('/salle'))}
      {link('phone', 'Écran mobile du gérant', () => router.push('/gerant'))}
      <View style={{ paddingTop: space.s2 }}>
        <ThemeToggle />
      </View>
      <Text style={[styles.mode, { color: colors.muted }]}>{transport.mode === 'sim' ? 'Simulation locale · hors ligne' : 'API connectée'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  brandMark: { width: 38, height: 38, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontFamily: fonts.sansSemi, fontSize: fs.md + 1 },
  brandSub: { fontFamily: fonts.sans, fontSize: fs.sm },
  toggle: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.pill, padding: 3, alignSelf: 'flex-start', minHeight: 44, alignItems: 'center' },
  toggleSeg: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.s3, height: 36, borderRadius: radius.pill },
  toggleText: { fontFamily: fonts.sansMedium, fontSize: fs.sm },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s2, paddingHorizontal: space.s2, borderRadius: radius.md, borderWidth: 1, minHeight: 52 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingVertical: 6, paddingLeft: 6, paddingRight: space.s4, borderRadius: radius.pill, borderWidth: 1, minHeight: 48 },
  stepMarker: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepName: { fontFamily: fonts.sansSemi, fontSize: fs.sm + 0.5 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2, justifyContent: 'flex-end' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s3 },
  cardRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.s3 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  verdictText: { fontFamily: fonts.serifSemi, fontSize: fs.lg + 1, flexShrink: 1 },
  explain: { flexDirection: 'row', alignItems: 'center', gap: space.s4, borderWidth: 1, borderLeftWidth: 3, borderRadius: radius.md, padding: space.s4 },
  explainIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  explainHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.s3 },
  explainTitle: { fontFamily: fonts.sansSemi, fontSize: fs.lg },
  explainResult: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.s3, rowGap: 2 },
  explainActions: { gap: space.s2, alignItems: 'flex-end' },
  action: { borderTopWidth: 1, paddingVertical: space.s3, gap: 6 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s3, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.s4, minHeight: 48 },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: fs.md, paddingVertical: 12 },
  actionButtons: { flexDirection: 'row', gap: space.s3 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { fontFamily: fonts.sans, fontSize: fs.sm, flexShrink: 1 },
  sideFoot: { borderTopWidth: 1, paddingTop: space.s3, gap: 2 },
  sideLink: { flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 44, paddingHorizontal: space.s2, borderRadius: radius.md },
  sideLinkText: { fontFamily: fonts.sans, fontSize: fs.sm + 0.5 },
  mode: { fontFamily: fonts.sans, fontSize: fs.xs, paddingTop: space.s2 },
});
