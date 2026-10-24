/*
 * Couches modales : panneau latéral (détails techniques, journal), téléphone du gérant, confirmation, scénarios.
 */
import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, fmt, store, transport } from '../engine';
import type { AuditEvent } from '../engine/types';
import { MENU, STEP, computeSteps, currentTx, eventsByStep, factsFor, plural, STATE_ICON, STATE_TONE, txWhat, type StepId } from '../domain/steps';
import * as W from '../domain/wording';
import * as app from '../state/app';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, fs, radius, space } from '../theme/tokens';
import { HitlCard } from './HitlCard';
import { Icon } from './Icon';
import { Button, Facts, IconButton, Status, Txt } from './ui';

// ------------------------------------------------------------------ panneau latéral

export function Sheet({ visible, onClose, kicker, title, children, actions }: { visible: boolean; onClose: () => void; kicker: string; title: string; children: ReactNode; actions?: ReactNode }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 900;
  return (
    <Modal visible={visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.sheetRoot, { backgroundColor: colors.scrim, flexDirection: wide ? 'row' : 'column', justifyContent: 'flex-end' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer le panneau" />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.side, borderColor: colors.border, paddingTop: wide ? space.s5 : space.s4, paddingBottom: insets.bottom + space.s4 },
            wide ? { width: Math.min(560, width * 0.42), height: '100%', borderLeftWidth: 1 } : { maxHeight: '88%', borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
          ]}
        >
          <View style={[styles.sheetHead, { borderBottomColor: colors.line }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="small" color="muted">
                {kicker}
              </Txt>
              <Txt variant="serif" accessibilityRole="header">
                {title}
              </Txt>
            </View>
            {actions}
            <IconButton icon="x" label="Fermer le panneau" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children, last }: { title?: string; children: ReactNode; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderBottomColor: colors.line, borderBottomWidth: last ? 0 : 1 }]}>
      {title ? (
        <Txt variant="strong" accessibilityRole="header">
          {title}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

function EventRow({ e, line, broken }: { e: AuditEvent; line: number; broken: boolean }) {
  const { colors } = useTheme();
  const info = W.statusInfo(e.status);
  return (
    <View style={[styles.event, { backgroundColor: colors.surface, borderColor: broken ? colors.block : colors.border }]}>
      <View style={styles.eventHead}>
        <Text style={[styles.mono, { color: colors.muted }]}>n° {line}</Text>
        <Text style={[styles.small, { color: colors.text2 }]}>{fmt.time(e.timestamp)}</Text>
        <Text style={[styles.small, { color: colors.text, fontFamily: fonts.sansSemi }]}>{fmt.actor(e.agent_id)}</Text>
        <Text style={[styles.small, { color: colors.text2 }]}>{W.action(e.action)}</Text>
        {info.label ? <Status tone={info.tone} icon={info.icon} label={info.label} size="sm" /> : null}
        {broken ? <Status tone="block" icon="linkBroken" label="Ligne modifiée" size="sm" /> : null}
      </View>
      {e.reasoning ? <Text style={[styles.small, { color: colors.text }]}>{e.reasoning}</Text> : null}
      <Text style={[styles.mono, { color: colors.muted }]}>empreinte {fmt.shortHash(e.hash)}</Text>
    </View>
  );
}

function StepDetails({ id }: { id: StepId }) {
  const { colors } = useTheme();
  const s = STEP[id];
  const tx = currentTx();
  const d = computeSteps(tx)[id];
  const facts = factsFor(id, tx);
  const events = tx ? eventsByStep(tx)[id] : [];
  const rules = new Set<string>();
  for (const { e } of events) for (const r of (e.context && e.context.triggered_rules) || []) rules.add(r);
  const v = store.verification;
  const brokenAt = v.state === 'broken' ? v.broken_at : -1;
  return (
    <>
      <Section>
        <Status tone={STATE_TONE[d.state]} icon={d.icon || STATE_ICON[d.state]} label={d.label} />
        <Txt>{d.why || s.role}</Txt>
        {tx ? (
          <Txt variant="small" color="muted">
            Opération <Text style={styles.mono}>{tx.corr}</Text>
            {tx.intent ? ` · ${txWhat(tx)}` : ''}
          </Txt>
        ) : null}
      </Section>
      <Section title="Composants techniques">
        {s.tech.map((t) => {
          const actor = C.ACTORS[t.id] || { name: t.id, kind: 'control' };
          return (
            <View key={t.id} style={[styles.event, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.small, { color: colors.text, fontFamily: fonts.sansSemi }]}>
                {actor.name} <Text style={{ color: colors.muted, fontFamily: fonts.sans }}>{C.KIND_LABELS[actor.kind] || ''}</Text>
              </Text>
              <Text style={[styles.small, { color: colors.text2 }]}>{t.role}</Text>
            </View>
          );
        })}
      </Section>
      {(s.agents || []).map((agentId) => {
        const a = C.AGENTS.find((x: { id: string }) => x.id === agentId);
        if (!a) return null;
        const st = store.agents[agentId] || { trust: 100, quarantined: false };
        const rows: [string, string][] = [
          ['Agent', `${a.name} · ${a.nature}`],
          ['Mission', a.mission],
          ['Outils autorisés', a.allowed_tools.join(', ')],
        ];
        if (a.max_amount) rows.push(['Plafond autonome', fmt.eur(a.max_amount)]);
        rows.push(['Interdit', a.forbidden], ['Score de confiance', `${st.trust} / 100${st.quarantined ? ' · en quarantaine' : ''}`]);
        return (
          <Section key={agentId} title="Mandat">
            <Facts rows={rows} />
          </Section>
        );
      })}
      <Section title="Données analysées et résultat">
        {facts.length ? <Facts rows={facts} /> : <Txt variant="small" color="muted">Aucune donnée pour cette étape pour l'instant.</Txt>}
      </Section>
      <Section title={`Règles appliquées · ${C.POLICY_VERSION}`}>
        {rules.size ? (
          [...rules].map((r) => (
            <View key={r} style={styles.ruleRow}>
              <Text style={[styles.mono, { color: colors.accent, width: 72 }]}>{r}</Text>
              <Text style={[styles.small, { color: colors.text, flex: 1 }]}>{fmt.rule(r)}</Text>
            </View>
          ))
        ) : (
          <Txt variant="small" color="muted">Aucune règle déclenchée.</Txt>
        )}
      </Section>
      <Section title="Événements d'audit" last>
        {events.length ? events.map(({ e, line, index }) => <EventRow key={index} e={e} line={line} broken={index === brokenAt} />) : <Txt variant="small" color="muted">Aucun événement journalisé pour cette étape.</Txt>}
        {id === 'proof' ? (
          <View style={styles.actionsRow}>
            <Button label="Vérifier la chaîne" icon="link" size="sm" onPress={app.verifyAndAnnounce} />
            <Button label="Exporter audit.jsonl" icon="download" size="sm" disabled={!store.events.length} onPress={app.exportJournal} />
          </View>
        ) : null}
        <View style={styles.actionsRow}>
          {tx ? <Button label="Fiche de décision (JSON)" icon="download" size="sm" variant="ghost" onPress={() => app.exportRecord(tx.corr)} /> : null}
          <Button
            label="Vue technique complète"
            icon="terminal"
            size="sm"
            variant="ghost"
            onPress={() => {
              app.closeDrawer();
              router.push('/salle');
            }}
          />
        </View>
      </Section>
    </>
  );
}

function JournalDetails() {
  const { ui } = app.useApp();
  const v = store.verification;
  const n = store.events.length;
  const brokenAt = v.state === 'broken' ? v.broken_at : -1;
  const MAX = 60;
  const start = Math.max(0, n - MAX);
  const indexes: number[] = [];
  for (let i = n - 1; i >= start; i--) indexes.push(i);
  if (brokenAt >= 0 && brokenAt < start) indexes.push(brokenAt);
  const busy = app.busy();
  const status =
    v.state === 'valid' ? (
      <Status tone="ok" icon="link" label={`Chaîne intègre · ${plural(v.checked, 'événement')} vérifiés`} />
    ) : v.state === 'broken' ? (
      <Status tone="block" icon="linkBroken" label={`Modification détectée à l'événement n° ${v.broken_at + 1}`} />
    ) : (
      <Status tone="idle" icon="circleDashed" label={n ? 'Non vérifiée' : 'Journal vide'} />
    );
  return (
    <>
      <Section>
        {status}
        <Txt variant="small" color="text2">
          Chaque événement contient l'empreinte du précédent : modifier une ligne après coup rompt la chaîne, et la vérification désigne la ligne en cause.
        </Txt>
        <View style={styles.actionsRow}>
          <Button label="Vérifier la chaîne" icon="link" size="sm" variant="primary" disabled={!n} onPress={app.verifyAndAnnounce} />
          <Button label="Rejouer la séance" icon="replay" size="sm" disabled={!n || busy} onPress={app.startReplay} />
          <Button label="Exporter audit.jsonl" icon="download" size="sm" disabled={!n} onPress={app.exportJournal} />
          {store.tampered ? (
            transport.mode === 'sim' ? <Button label="Restaurer le journal" icon="reset" size="sm" onPress={app.restore} /> : null
          ) : (
            <Button label="Simuler une falsification" icon="edit" size="sm" variant="dangerOutline" disabled={!n || busy || Boolean(ui.replay)} onPress={app.tamper} />
          )}
        </View>
      </Section>
      <Section title={`Derniers événements${n > MAX ? ` · ${MAX} sur ${n}` : n ? ` · ${n}` : ''}`} last>
        {n ? indexes.map((i) => <EventRow key={i} e={store.journalLine(i)} line={i + 1} broken={i === brokenAt} />) : <Txt variant="small" color="muted">Aucun événement pour l'instant.</Txt>}
      </Section>
    </>
  );
}

export function DetailsSheet() {
  const { ui } = app.useApp();
  const d = ui.drawer;
  const title = !d ? '' : d.type === 'journal' ? 'Journal de preuve' : STEP[d.id].nav;
  return (
    <Sheet visible={Boolean(d)} onClose={app.closeDrawer} kicker={d && d.type === 'journal' ? 'Preuve et audit' : 'Détails techniques'} title={title}>
      {d ? d.type === 'journal' ? <JournalDetails /> : <StepDetails id={d.id} /> : null}
    </Sheet>
  );
}

// ------------------------------------------------------------------ téléphone du gérant

export function PhoneModal() {
  const { ui } = app.useApp();
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const p = store.pending;
  const tx = ui.txCorr ? store.txs.get(ui.txCorr) : null;
  // La carte reste montée après la décision pour afficher l'écran « décision signée ».
  const card = p ? p.card : tx && tx.hitl && tx.hitl.card ? tx.hitl.card : null;
  const resolved = !p && tx && tx.hitl && tx.hitl.status !== 'pending' ? tx.hitl.status : null;
  const framed = width >= 700;
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  return (
    <Modal visible={ui.phoneOpen} transparent animationType="fade" onRequestClose={app.closePhone}>
      <View style={[styles.phoneRoot, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={app.closePhone} accessibilityRole="button" accessibilityLabel="Fermer le téléphone" />
        <View style={{ alignItems: 'center', gap: space.s3, maxWidth: '100%' }} accessibilityViewIsModal>
          <View
            style={[
              styles.phone,
              framed
                ? { width: 390, height: Math.min(800, height - 140), borderColor: colors.borderStrong, backgroundColor: colors.bg }
                : { width, height: height - 70, borderWidth: 0, borderRadius: 0, backgroundColor: colors.bg },
            ]}
          >
            <View style={[styles.phoneStatus, { borderBottomColor: colors.line }]}>
              <Text style={[styles.small, { color: colors.text, fontFamily: fonts.sansSemi }]}>{time}</Text>
              <View style={[styles.notch, { backgroundColor: colors.borderStrong }]} />
              <Text style={[styles.small, { color: colors.muted }]}>ManAgent</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: space.s5 }}>
              {card ? (
                <HitlCard
                  key={card.thread_id}
                  card={card}
                  resolvedStatus={resolved}
                  onDecide={(decision) => app.decide(card.thread_id, decision)}
                  onReport={() => app.requestReport(card.thread_id)}
                  getRecord={() => store.decisionRecord(card.correlation_id)}
                />
              ) : (
                <View style={[styles.center, { gap: space.s3 }]}>
                  <Icon name="phone" size={34} color={colors.muted} />
                  <Txt variant="strong">Aucune décision en attente.</Txt>
                  <Txt variant="small" color="text2" style={{ textAlign: 'center' }}>
                    La demande apparaît dès qu'une opération est escaladée : montant au-delà du seuil, veto ou abstention d'un contrôle.
                  </Txt>
                </View>
              )}
            </ScrollView>
          </View>
          <Button label="Fermer · la décision reste en attente" variant="outline" size="sm" onPress={app.closePhone} />
        </View>
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------------ confirmation

export function ConfirmDialog() {
  const { ui } = app.useApp();
  const { colors } = useTheme();
  const c = ui.confirm;
  return (
    <Modal visible={Boolean(c)} transparent animationType="fade" onRequestClose={() => {
        if (c) c.resolve(false);
      }}>
      <View style={[styles.center, styles.fill, { backgroundColor: colors.scrim, padding: space.s4 }]}>
        {c ? (
          <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Txt variant="serif" accessibilityRole="header">
              {c.title}
            </Txt>
            <Txt color="text2">{c.text}</Txt>
            <View style={[styles.actionsRow, { justifyContent: 'flex-end' }]}>
              {/* Action destructrice : « Annuler » en premier pour qu'un réflexe ne déclenche rien. */}
              <Button label="Annuler" variant="ghost" onPress={() => c.resolve(false)} />
              <Button label={c.ok} variant={c.danger ? 'danger' : 'primary'} onPress={() => c.resolve(true)} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------------ scénarios

export function ScenarioMenu() {
  const { ui } = app.useApp();
  const { colors } = useTheme();
  const busy = app.busy();
  const live = transport.mode === 'live';
  return (
    <Modal visible={ui.menuOpen} transparent animationType="fade" onRequestClose={() => app.setMenu(false)}>
      <View style={[styles.center, styles.fill, { backgroundColor: colors.scrim, padding: space.s4 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => app.setMenu(false)} accessibilityRole="button" accessibilityLabel="Fermer les scénarios" />
        <View accessibilityViewIsModal style={[styles.menu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.menuHead}>
            <Txt variant="serif" accessibilityRole="header" style={{ flex: 1 }}>
              Scénarios de démonstration
            </Txt>
            <IconButton icon="x" label="Fermer les scénarios" onPress={() => app.setMenu(false)} />
          </View>
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 2 }}>
            {MENU.map((m) => (
              <Pressable
                key={m.key}
                accessibilityRole="button"
                accessibilityLabel={`${m.title} : ${m.text}`}
                disabled={busy}
                onPress={() => app.runMenu(m.key)}
                style={(state: any) => [styles.menuItem, { backgroundColor: state.hovered || state.pressed ? colors.surface2 : 'transparent', opacity: busy ? 0.5 : 1 }]}
              >
                <View style={[styles.menuIcon, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                  <Icon name={m.icon} size={18} color={colors.text2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.small, { color: colors.text, fontFamily: fonts.sansSemi }]}>{m.title}</Text>
                  <Text style={[styles.small, { color: colors.muted }]}>{m.text}</Text>
                </View>
                <Icon name="chevron" size={16} color={colors.muted} />
              </Pressable>
            ))}
          </ScrollView>
          {live ? null : (
            <View style={[styles.menuFoot, { borderTopColor: colors.line }]}>
              <View style={styles.switchRow}>
                <Switch
                  value={ui.fast}
                  onValueChange={app.setFast}
                  accessibilityLabel="Animation rapide"
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor={colors.surface}
                />
                <Txt variant="small" color="text2">
                  Animation rapide
                </Txt>
              </View>
              <Button label="Réinitialiser" icon="reset" size="sm" variant="ghost" onPress={app.resetDemo} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  sheetRoot: { flex: 1 },
  sheet: { paddingHorizontal: space.s5, gap: space.s3 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, paddingBottom: space.s3, borderBottomWidth: 1 },
  sheetBody: { paddingBottom: space.s6 },
  section: { gap: space.s3, paddingVertical: space.s4 },
  event: { borderWidth: 1, borderRadius: radius.md, padding: space.s3, gap: 4 },
  eventHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.s3, rowGap: 2 },
  ruleRow: { flexDirection: 'row', gap: space.s3, alignItems: 'baseline' },
  mono: { fontFamily: fonts.mono, fontSize: fs.xs },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 19 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  phoneRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  phone: { borderWidth: 6, borderRadius: 34, overflow: 'hidden' },
  phoneStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.s5, paddingVertical: space.s3, borderBottomWidth: 1 },
  notch: { width: 72, height: 6, borderRadius: 3 },
  dialog: { width: '100%', maxWidth: 460, borderWidth: 1, borderRadius: radius.lg, padding: space.s5, gap: space.s4 },
  menu: { width: '100%', maxWidth: 520, borderWidth: 1, borderRadius: radius.lg, padding: space.s4, gap: space.s3 },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.s3, padding: space.s3, borderRadius: radius.md, minHeight: 56 },
  menuIcon: { width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  menuFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: space.s3 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
});
