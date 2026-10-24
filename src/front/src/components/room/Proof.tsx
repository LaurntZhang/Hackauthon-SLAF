/*
 * Section 04 : preuve et audit — bilan de séance, chaîne d'empreintes, récit des décisions, journal de preuve.
 */
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, fmt, store, transport } from '../../engine';
import type { AuditEvent, Run, Tx } from '../../engine/types';
import {
  actorIcon, actorKind, buildBlocks, msgBadges, msgSeverity, notableIn, proofCells, proofSummary, runBadge, runTitle, txBadge, txWhatShort,
} from '../../domain/dashboard';
import { plural } from '../../domain/steps';
import * as W from '../../domain/wording';
import * as app from '../../state/app';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft, type Palette } from '../../theme/tokens';
import { Icon } from '../Icon';
import { Button, Pill, SectionHead, Status, Txt } from '../ui';

function kindColors(p: Palette, kind: string) {
  if (kind === 'agent') return { bg: p.accentSoft, fg: p.accent };
  if (kind === 'human') return { bg: p.humanSoft, fg: p.human };
  if (kind === 'world') return { bg: p.surface2, fg: p.text2 };
  return { bg: p.surface2, fg: p.text };
}

function Avatar({ agentId }: { agentId: string }) {
  const { colors } = useTheme();
  const k = kindColors(colors, actorKind(agentId));
  return (
    <View style={[styles.avatar, { backgroundColor: k.bg, borderColor: colors.border }]}>
      <Icon name={actorIcon(agentId)} size={16} color={k.fg} />
    </View>
  );
}

function Kpis() {
  const { colors } = useTheme();
  const k = store.kpis();
  const items: [string, number][] = [
    ['Dossiers', k.total],
    ['Exécutés', k.filled],
    ['Soumis au gérant', k.escalated],
    ['Bloqués', k.blocked],
    ['Alertes', k.alerts],
  ];
  return (
    <View style={styles.kpis} accessibilityLabel="Bilan de la séance">
      {items.map(([label, value]) => (
        <View key={label} style={styles.kpi} accessibilityLabel={`${label} : ${value}`}>
          <Text style={[styles.kpiValue, { color: colors.text }]}>{value}</Text>
          <Text style={[styles.xs, { color: colors.muted }]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function ProofStrip({ tx }: { tx: Tx | null }) {
  const { colors } = useTheme();
  const s = proofSummary();
  const cells = proofCells(tx);
  const n = store.events.length;
  const first = cells.find((c) => 'i' in c) as { i: number } | undefined;
  return (
    <View style={[styles.strip, { backgroundColor: colors.surface, borderColor: s.tone === 'block' ? colors.block : colors.border }]}>
      <View style={styles.stripHead}>
        <Icon name={s.icon} size={20} color={s.tone === 'idle' ? colors.text2 : toneColor(colors, s.tone)} />
        <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
          <Text style={[styles.strong, { color: s.tone === 'block' ? colors.block : colors.text }]}>{s.title}</Text>
          <Text style={[styles.small, { color: colors.text2 }]}>{s.text}</Text>
        </View>

      </View>
      {n ? (
        <View style={{ gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.cells}>
            {cells.map((c, k) =>
              'more' in c ? (
                <Text key={`m${k}`} style={[styles.xs, { color: colors.muted }]}>
                  +{c.more}
                </Text>
              ) : (
                <View
                  key={c.i}
                  style={[
                    styles.cell,
                    {
                      borderColor: c.broken || c.tampered ? colors.block : c.tx ? colors.text : colors.borderStrong,
                      backgroundColor: c.broken ? colors.block : c.tx ? (c.verified ? colors.text : colors.text2) : c.verified ? colors.surface2 : 'transparent',
                    },
                  ]}
                />
              ),
            )}
          </View>
          <View style={styles.rowBetween}>
            <Text style={[styles.mono, { color: colors.muted }]}>{first ? fmt.time(store.events[first.i].timestamp) : ''}</Text>
            <Text style={[styles.mono, { color: colors.muted }]}>{fmt.time(store.events[n - 1].timestamp)}</Text>
          </View>
          <View style={[styles.row, { columnGap: space.s4 }]}>
            <LegendDot fill={colors.text} border={colors.text} label="Événements du dossier affiché" />
            <LegendDot fill="transparent" border={colors.borderStrong} label="Autres événements" />
            <LegendDot fill={colors.block} border={colors.block} label="Événement altéré" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function LegendDot({ fill, border, label }: { fill: string; border: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.cell, { backgroundColor: fill, borderColor: border }]} />
      <Text style={[styles.xs, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ récit des décisions

function Message({ idx }: { idx: number }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const e = store.events[idx];
  const ctx = e.context || {};
  const actor = C.ACTORS[e.agent_id] || { name: e.agent_id, kind: 'control' };
  const sev = msgSeverity(e);
  const k = kindColors(colors, actor.kind);
  const pendingHere = e.action === 'hitl.requested' && store.pending && store.pending.corr === e.correlation_id && !ui.replay;
  return (
    <View style={[styles.msg, sev && { borderLeftColor: sev === 'critical' ? colors.block : colors.humanLine, borderLeftWidth: 3, paddingLeft: space.s3 }]}>
      <Avatar agentId={e.agent_id} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.msgMeta}>
          <Text style={[styles.smallStrong, { color: colors.text }]}>{actor.name}</Text>
          <View style={[styles.tag, { backgroundColor: k.bg }]}>
            <Text style={[styles.tagText, { color: k.fg }]}>{(C.KIND_LABELS[actor.kind] || '').toUpperCase()}</Text>
          </View>
          <Text style={[styles.xs, { color: colors.muted }]}>{fmt.time(e.timestamp)}</Text>
          <Text style={[styles.xs, { color: colors.muted }]}>
            {W.action(e.action)} · n° {idx + 1}
          </Text>
        </View>
        {e.reasoning ? <Text style={[styles.small, { color: colors.text }]}>{e.reasoning}</Text> : null}
        <View style={styles.row}>
          {msgBadges(e).map((b) => (
            <Status key={b.label} tone={b.tone} icon={b.icon} label={b.label} size="sm" />
          ))}
          {(ctx.triggered_rules || []).map((r: string) => (
            <Text key={r} style={[styles.rule, { color: colors.text2, borderColor: colors.border }]} accessibilityLabel={`Règle ${r} : ${fmt.rule(r)}`}>
              {r}
            </Text>
          ))}
        </View>
        {pendingHere ? <Button label="Ouvrir la validation du gérant" icon="phone" size="sm" variant="primary" onPress={app.openPhone} style={{ alignSelf: 'flex-start' }} /> : null}
      </View>
    </View>
  );
}

function TxBlock({ block, run }: { block: { corr: string; main: number[]; detail: number[] }; run: Run }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const tx = store.txs.get(block.corr);
  if (!tx) return null;
  const b = txBadge(tx);
  const focused = (ui.roomCorr || store.lastCorr) === tx.corr;
  const head = (
    <View style={styles.txHead}>
      <Text style={[styles.mono, { color: colors.text2 }]}>{tx.corr}</Text>
      <Text style={[styles.smallStrong, { color: colors.text, flexShrink: 1 }]}>{txWhatShort(tx)}</Text>
      <Status tone={b.tone} icon={b.icon} label={b.label} size="sm" />
      <View style={[styles.row, { marginLeft: 'auto' }]}>
        <Button label="Dossier" icon="folder" size="sm" variant="ghost" accessibilityLabel={`Afficher le dossier ${tx.corr}`} onPress={() => app.pinDossier(tx.corr)} />
        <Button label="Fiche" icon="file" size="sm" variant="ghost" accessibilityLabel={`Fiche de décision de ${tx.corr}`} onPress={() => app.openXai(tx.corr)} />
      </View>
    </View>
  );
  const box = [styles.tx, { borderColor: focused ? colors.borderStrong : colors.border, backgroundColor: colors.surface }, focused && { borderLeftWidth: 3, borderLeftColor: colors.accent }];
  if (run.compact) {
    // Séries d'ordres (S5) : une ligne par dossier, seules les alertes et blocages sont développés.
    const notable = notableIn(block.main);
    return (
      <View style={[styles.compact, { borderBottomColor: colors.line }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Afficher le dossier ${tx.corr}`} onPress={() => app.pinDossier(tx.corr)} style={styles.compactRow}>
          <Text style={[styles.mono, { color: colors.text2 }]}>{tx.corr}</Text>
          <Text style={[styles.xs, { color: colors.text, flex: 1, minWidth: 160 }]} numberOfLines={1}>
            {txWhatShort(tx)}
            {tx.intent ? <Text style={{ color: colors.muted }}> · {tx.intent.rationale}</Text> : null}
          </Text>
          <Status tone={b.tone} icon={b.icon} label={b.label} size="sm" />
        </Pressable>
        {notable.map((i) => (
          <Message key={i} idx={i} />
        ))}
      </View>
    );
  }
  const key = `micro-${tx.corr}`;
  const open = ui.openDetails.includes(key);
  return (
    <View style={box}>
      {head}
      <View style={{ gap: space.s3 }}>
        {block.main.map((i) => (
          <Message key={i} idx={i} />
        ))}
      </View>
      {block.detail.length ? (
        <View style={[styles.micro, { borderTopColor: colors.line }]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => app.toggleDetails(key)} style={styles.microToggle}>
            <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
              <Icon name="chevron" size={14} color={colors.text2} />
            </View>
            <Text style={[styles.xs, { color: colors.text2 }]}>
              {plural(block.detail.length, 'vérification')} technique{block.detail.length > 1 ? 's' : ''} de FinGuard (détail)
            </Text>
          </Pressable>
          {open
            ? block.detail.map((i) => {
                const e = store.events[i];
                return (
                  <View key={i} style={styles.microRow}>
                    <Text style={[styles.mono, { color: colors.muted, width: 52 }]}>n° {i + 1}</Text>
                    <Text style={[styles.xs, { color: colors.text2, width: 140 }]}>{fmt.actor(e.agent_id)}</Text>
                    <Text style={[styles.xs, { color: colors.text, flex: 1, minWidth: 180 }]}>{e.reasoning}</Text>
                  </View>
                );
              })
            : null}
        </View>
      ) : null}
    </View>
  );
}

function RunCard({ run }: { run: Run }) {
  const { colors } = useTheme();
  const blocks = buildBlocks(run);
  const rb = runBadge(run);
  const c = run.completed;
  const body = (
    <View style={{ gap: run.compact ? 0 : space.s3 }}>
      {blocks.map((b, k) => (b.type === 'tx' ? <TxBlock key={b.corr} block={b} run={run} /> : <Message key={`m${k}`} idx={b.idx} />))}
    </View>
  );
  return (
    <View style={[styles.run, { borderColor: colors.border }]}>
      <View style={styles.runHead}>
        {run.scenario ? (
          <Text style={[styles.caseId, { color: colors.text, borderColor: colors.text }]}>{run.scenario === 'MANUEL' ? 'OBJ' : run.scenario}</Text>
        ) : (
          <Avatar agentId="human:superviseur" />
        )}
        <Text accessibilityRole="header" style={[styles.runTitle, { color: colors.text }]}>
          {runTitle(run)}
        </Text>
        <Text style={[styles.xs, { color: colors.muted }]}>{fmt.time(run.startedAt)}</Text>
        {rb ? <Status tone={rb.tone} icon={rb.icon} label={rb.label} size="sm" /> : null}
      </View>
      {run.compact ? <View style={[styles.tx, { borderColor: colors.border, backgroundColor: colors.surface, gap: 0 }]}>{body}</View> : body}
      {c ? (
        <View style={[styles.outcome, { backgroundColor: c.matched ? colors.okSoft : colors.humanSoft }]}>
          <Icon name={c.matched ? 'checkCircle' : 'alert'} size={16} color={c.matched ? colors.ok : colors.human} />
          <Text style={[styles.small, { color: colors.text, flex: 1 }]}>
            <Text style={{ fontFamily: fonts.sansSemi }}>{c.matched ? "Conforme à l'attendu." : "Écart avec l'attendu."}</Text> Attendu : {String(c.expected).toLowerCase()}. Obtenu : {c.obtained}.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Feed() {
  const { colors } = useTheme();
  if (!store.runOrder.length) {
    return (
      <View style={[styles.empty, { borderColor: colors.border }]}>
        <Icon name="shield" size={28} color={colors.muted} />
        <Txt variant="strong">Aucune décision pour l'instant.</Txt>
        <Txt variant="small" color="text2" style={{ textAlign: 'center' }}>
          Lancez le cas S1 : le récit montre qui a proposé, qui a contrôlé, qui a décidé et pourquoi. Les vérifications techniques restent repliées ; seules les décisions et les alertes s'affichent.
        </Txt>
      </View>
    );
  }
  const runs = [...store.runOrder].reverse().slice(0, 12);
  return (
    <View style={{ gap: space.s4 }}>
      {runs.map((id) => {
        const run = store.runs.get(id);
        return run ? <RunCard key={id} run={run} /> : null;
      })}
      {store.runOrder.length > runs.length ? (
        <Txt variant="xs" color="muted">
          {store.runOrder.length - runs.length} séquence(s) plus ancienne(s) dans le journal de preuve.
        </Txt>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ journal de preuve

function AuditRow({ e, i, wide }: { e: AuditEvent; i: number; wide: boolean }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const v = store.verification;
  const broken = v.state === 'broken' && v.broken_at === i;
  const tampered = store.overrides.has(i);
  const selected = ui.selectedLine === i;
  const info = W.statusInfo(e.status);
  const bg = broken ? colors.blockSoft : selected ? colors.accentSoft : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Événement ${i + 1}, ${fmt.actor(e.agent_id)}, ${W.action(e.action)}. Afficher tel qu'enregistré`}
      accessibilityState={{ selected }}
      onPress={() => app.selectLine(selected ? null : i)}
      style={(state: any) => [styles.auditRow, { borderBottomColor: colors.line, backgroundColor: state.hovered && !selected && !broken ? colors.surface2 : bg }, !wide && { flexDirection: 'column', alignItems: 'flex-start' }]}
    >
      <Text style={[styles.mono, styles.cNum, { color: colors.text2 }]}>{i + 1}</Text>
      <Text style={[styles.xs, styles.cTime, { color: colors.text2 }]}>{fmt.time(e.timestamp)}</Text>
      <Text style={[styles.mono, styles.cCorr, { color: colors.text2 }]}>{e.correlation_id}</Text>
      <Text style={[styles.xs, styles.cWho, { color: colors.text, fontFamily: fonts.sansMedium }]}>{fmt.actor(e.agent_id)}</Text>
      <View style={styles.cStep}>
        <Text style={[styles.xs, { color: colors.text }]}>{W.action(e.action)}</Text>
        <Text style={[styles.mono, { color: colors.muted }]}>{e.action}</Text>
      </View>
      <View style={styles.cStatus}>{e.status === 'ok' ? <Text style={[styles.xs, { color: colors.muted }]}>conforme</Text> : <Status tone={info.tone} icon={info.icon} label={info.label} size="sm" />}</View>
      <Text style={[styles.xs, styles.cWhy, { color: colors.text }]}>
        {e.reasoning}
        {tampered ? <Text style={{ color: colors.block, fontFamily: fonts.sansSemi }}> · modifié hors système</Text> : null}
      </Text>
      <Text style={[styles.mono, styles.cHash, { color: colors.muted }]}>
        {e.prev_hash.slice(0, 8)} → <Text style={{ color: colors.text2 }}>{e.hash.slice(0, 8)}</Text>
      </Text>
    </Pressable>
  );
}

function Journal({ wide }: { wide: boolean }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const v = store.verification;
  const n = store.events.length;
  const busy = app.busy();
  let status: { tone: 'ok' | 'block' | 'idle'; icon: 'link' | 'linkBroken' | 'info'; text: string };
  if (v.state === 'valid') {
    const added = n - v.checked;
    status = {
      tone: 'ok', icon: 'link',
      text: `verify_chain() : ${plural(v.checked, 'événement')} recalculé${v.checked > 1 ? 's' : ''}, aucun n'a été modifié. Dernière empreinte ${fmt.shortHash(v.last_hash)}${added > 0 ? ` · ${plural(added, 'événement')} ajouté${added > 1 ? 's' : ''} depuis` : ''}.`,
    };
  } else if (v.state === 'broken') {
    const why = v.reason === 'hash' ? 'son contenu ne correspond plus à son empreinte' : "le chaînage avec l'événement précédent est rompu";
    status = { tone: 'block', icon: 'linkBroken', text: `verify_chain() en échec à l'événement n° ${v.broken_at + 1} : ${why}. Empreinte enregistrée ${fmt.shortHash(v.expected)}, recalculée ${fmt.shortHash(v.found)}.` };
  } else {
    status = { tone: 'idle', icon: 'info', text: "Chaîne non vérifiée. Chaque événement porte l'empreinte du précédent (prev_hash) et la sienne (hash) : lancez la vérification." };
  }
  const MAX = 120;
  const rows: number[] = [];
  for (let i = n - 1; i >= Math.max(0, n - MAX); i--) rows.push(i);
  const brokenAt = v.state === 'broken' ? v.broken_at : -1;
  if (brokenAt >= 0 && brokenAt < n - MAX) rows.push(brokenAt);
  const selected = ui.selectedLine !== null && store.events[ui.selectedLine] ? ui.selectedLine : null;
  return (
    <View style={{ gap: space.s3 }}>
      <View style={styles.row}>
        <Button label="Vérifier la chaîne" icon="link" size="sm" variant="primary" disabled={!n} onPress={app.verifyAndAnnounce} />
        <Button label="Rejouer la séance" icon="replay" size="sm" disabled={!n || busy} onPress={app.startReplay} />
        <Button label="Exporter audit.jsonl" icon="download" size="sm" disabled={!n} onPress={app.exportJournal} />
        {store.tampered ? (
          transport.mode === 'sim' ? <Button label="Restaurer le journal" icon="reset" size="sm" onPress={app.restore} /> : null
        ) : (
          <Button label="Simuler une falsification" icon="edit" size="sm" variant="dangerOutline" disabled={!n || busy || transport.mode === 'live'} onPress={app.tamper} />
        )}
      </View>
      <View style={[styles.auditStatus, { backgroundColor: status.tone === 'idle' ? colors.surface2 : toneSoft(colors, status.tone), borderLeftColor: status.tone === 'idle' ? colors.borderStrong : toneColor(colors, status.tone) }]}>
        <Icon name={status.icon} size={16} color={status.tone === 'idle' ? colors.text2 : toneColor(colors, status.tone)} />
        <Text style={[styles.small, { color: colors.text, flex: 1 }]}>{status.text}</Text>
      </View>
      <View style={[styles.table, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {wide ? (
          <View style={[styles.auditRow, styles.auditHead, { borderBottomColor: colors.border, backgroundColor: colors.surface2 }]}>
            {[['#', styles.cNum], ['Heure', styles.cTime], ['Dossier', styles.cCorr], ['Qui', styles.cWho], ['Étape', styles.cStep], ['Statut', styles.cStatus], ['Pourquoi', styles.cWhy], ['Empreinte', styles.cHash]].map(([label, st]) => (
              <Text key={label as string} style={[styles.th, st as object, { color: colors.text2 }]}>
                {label as string}
              </Text>
            ))}
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: 520 }} nestedScrollEnabled>
          {n ? rows.map((i) => <AuditRow key={i} e={store.journalLine(i)} i={i} wide={wide} />) : <Text style={[styles.small, { color: colors.muted, padding: space.s4 }]}>Journal vide.</Text>}
        </ScrollView>
      </View>
      {selected !== null ? (
        <View style={[styles.json, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <Text style={[styles.xs, { color: colors.text2, fontFamily: fonts.sansSemi }]}>Événement n° {selected + 1}, tel qu'enregistré dans audit.jsonl :</Text>
          <Text selectable style={[styles.mono, { color: colors.text }, Platform.OS === 'web' ? ({ whiteSpace: 'pre-wrap' } as any) : null]}>
            {JSON.stringify(store.journalLine(selected), null, 2)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Onglet « Récit » : bilan de la séance et fil des décisions, séquence par séquence. */
export function RecitTab() {
  return (
    <View style={{ gap: space.s4 }}>
      <SectionHead title="Récit des décisions" hint="Qui a proposé, qui a contrôlé, qui a décidé et pourquoi. Les vérifications techniques restent repliées." right={<Kpis />} />
      <Feed />
    </View>
  );
}

/** Onglet « Journal de preuve » : chaîne d'empreintes, vérification, tableau des événements. */
export function JournalTab({ tx, wide }: { tx: Tx | null; wide: boolean }) {
  return (
    <View style={{ gap: space.s4 }}>
      <SectionHead title="Journal de preuve" hint="AI Act art. 12 · journalisation chaînée : chaque événement porte l'empreinte du précédent." />
      <ProofStrip tx={tx} />
      <Journal wide={wide} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 20 },
  smallStrong: { fontFamily: fonts.sansSemi, fontSize: fs.sm, lineHeight: 20 },
  strong: { fontFamily: fonts.sansSemi, fontSize: fs.md },
  xs: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 17 },
  mono: { fontFamily: fonts.mono, fontSize: fs.xs, lineHeight: 17 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s4 },
  kpi: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  kpiValue: { fontFamily: fonts.serifSemi, fontSize: fs.lg },
  strip: { borderWidth: 1, borderRadius: radius.md, padding: space.s4, gap: space.s4 },
  stripHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s3 },
  cells: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  cell: { width: 14, height: 10, borderWidth: 1, borderRadius: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: space.s6, alignItems: 'center', gap: space.s3 },
  run: { borderTopWidth: 1, paddingTop: space.s3, gap: space.s3 },
  runHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s3 },
  caseId: { fontFamily: fonts.monoMedium, fontSize: fs.xs, borderWidth: 1, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  runTitle: { fontFamily: fonts.serifSemi, fontSize: fs.md + 1, flexShrink: 1 },
  tx: { borderWidth: 1, borderRadius: radius.md, padding: space.s3, gap: space.s3 },
  txHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s3 },
  compact: { borderBottomWidth: 1, paddingVertical: 4, gap: space.s2 },
  compactRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s3, minHeight: 40 },
  msg: { flexDirection: 'row', gap: space.s3, alignItems: 'flex-start' },
  avatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  msgMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.s2, rowGap: 2 },
  tag: { borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  tagText: { fontFamily: fonts.sansSemi, fontSize: 12, letterSpacing: 0.4 },
  rule: { fontFamily: fonts.mono, fontSize: fs.xs, borderWidth: 1, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  micro: { borderTopWidth: 1, paddingTop: space.s2, gap: 4 },
  microToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  microRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2, paddingLeft: space.s5 },
  outcome: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s2, padding: space.s3, borderRadius: radius.md },
  auditStatus: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s2, padding: space.s3, borderRadius: radius.sm, borderLeftWidth: 3 },
  table: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  auditHead: { minHeight: 36 },
  auditRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: space.s3, paddingVertical: space.s2, borderBottomWidth: 1, minHeight: 44 },
  th: { fontFamily: fonts.sansSemi, fontSize: fs.xs },
  cNum: { width: 30 },
  cTime: { width: 62 },
  cCorr: { width: 70 },
  cWho: { width: 120 },
  cStep: { width: 150 },
  cStatus: { width: 120 },
  cWhy: { flex: 1, minWidth: 160 },
  cHash: { width: 150 },
  json: { borderWidth: 1, borderRadius: radius.md, padding: space.s3, gap: space.s2 },
});
