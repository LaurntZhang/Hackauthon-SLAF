/*
 * Sections 01 et 02 de la salle de contrôle : dossier de la transaction et décision actuelle.
 */
import { StyleSheet, Text, View } from 'react-native';

import { C, fmt } from '../../engine';
import type { Tx } from '../../engine/types';
import { decisionModel, expectedDecision, riskLevel, RISK_LEVELS, threshold, txBadge, VERDICT_OPTIONS } from '../../domain/dashboard';
import { effectiveMax } from '../../domain/steps';
import * as app from '../../state/app';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft } from '../../theme/tokens';
import { Icon, type IconName } from '../Icon';
import { Button, Pill, SectionHead, Status, Txt } from '../ui';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fact, { borderColor: colors.line }]}>
      <Text style={[styles.factLabel, { color: colors.muted }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Note({ icon, text, tone = 'neutral' }: { icon?: IconName; text: string; tone?: 'neutral' | 'ok' | 'human' | 'block' }) {
  const { colors } = useTheme();
  const color = tone === 'neutral' ? colors.muted : toneColor(colors, tone);
  return (
    <View style={styles.note}>
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Text style={[styles.noteText, { color }]}>{text}</Text>
    </View>
  );
}

export function Dossier({ tx }: { tx: Tx | null }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  if (!tx || !tx.intent) {
    return (
      <View style={[styles.empty, { borderColor: colors.borderStrong }]}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.surface2 }]}>
          <Icon name="folder" size={30} color={colors.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 200, gap: 6 }}>
          <Txt variant="serif">{tx ? `Dossier ${tx.corr} en préparation` : 'Aucune transaction en cours'}</Txt>
          <Txt variant="small" color="text2">
            {tx
              ? "Les données externes sont filtrées avant que l'agent ne formule sa proposition."
              : "Lancez un cas de démonstration : le dossier s'ouvre ici avec le montant, l'actif, la contrepartie et le niveau de risque."}
          </Txt>
        </View>
      </View>
    );
  }
  const i = tx.intent;
  const amount = Number(i.amount);
  const max = effectiveMax(tx);
  const kyc = C.COUNTERPARTIES.includes(i.counterparty);
  const th = threshold(amount, max);
  const level = riskLevel(tx);
  const expected = expectedDecision(tx);
  const b = txBadge(tx);
  const reduced = max < C.LIMITS.autonomousMax ? ' (réduit : score de confiance sous 70)' : '';
  return (
    <View accessibilityLabel={`Dossier ${tx.corr}`}>
      <View style={[styles.tab, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name="folder" size={14} color={colors.text2} />
        <Text style={[styles.small, { color: colors.text2 }]}>
          Dossier <Text style={styles.mono}>{tx.corr}</Text> <Text style={{ color: colors.muted }}>· ouvert à {fmt.time(tx.startedAt)}</Text>
        </Text>
        {ui.roomCorr ? <Button label="Suivre en direct" icon="replay" size="sm" variant="ghost" onPress={() => app.pinDossier(null)} style={{ marginLeft: 'auto', minHeight: 36 }} /> : null}
      </View>
      <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.sheetHead}>
          <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
            <View style={styles.note}>
              <Icon name={i.side === 'sell' ? 'arrowDownRight' : 'arrowUpRight'} size={14} color={colors.text2} />
              <Text style={[styles.factLabel, { color: colors.text2 }]}>{fmt.side(i.side).toUpperCase()}</Text>
            </View>
            <Text style={[styles.amount, { color: colors.text }]}>{fmt.eur(amount)}</Text>
            <Text style={[styles.asset, { color: colors.text }]}>
              {tx.assetLabel || i.asset} <Text style={{ color: colors.muted, fontFamily: fonts.sans }}>· {C.ASSET_TYPE_LABELS[i.asset_type || ''] || i.asset_type}</Text>
            </Text>
          </View>
          <Pill tone={b.tone} icon={b.icon} label={b.label} />
        </View>
        <View style={[styles.facts, { borderColor: colors.line }]}>
          <Fact label="Contrepartie">
            <Text style={[styles.factValue, { color: colors.text }]}>{i.counterparty}</Text>
            <Note icon={kyc ? 'check' : 'lock'} tone={kyc ? 'ok' : 'block'} text={kyc ? 'En liste blanche KYC' : 'Hors liste blanche KYC'} />
          </Fact>
          <Fact label="Seuil d'autonomie">
            <Text style={[styles.factValue, { color: colors.text }]}>
              {fmt.eur(max)}
              {reduced}
            </Text>
            <View style={[styles.threshold, { backgroundColor: colors.surface2, borderColor: colors.border }]} accessibilityLabel={th.text}>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${th.fill * 100}%`, backgroundColor: colors.accent }} />
              {th.over ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${th.overStart * 100}%`, width: `${th.overWidth * 100}%`, backgroundColor: colors.human, opacity: 0.85 }} /> : null}
              <View style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${th.mark * 100}%`, backgroundColor: colors.text }} />
            </View>
            <Note tone={th.over ? 'human' : 'neutral'} text={th.text} />
          </Fact>
          <Fact label="Niveau de risque">
            <View style={styles.note}>
              <View style={styles.riskBars} accessibilityElementsHidden>
                {[1, 2, 3].map((n) => (
                  <View key={n} style={[styles.riskBar, { height: 6 + n * 4, backgroundColor: level >= n ? colors.text : colors.border }]} />
                ))}
              </View>
              <Text style={[styles.factValue, { color: level ? colors.text : colors.muted }]}>{RISK_LEVELS[level]}</Text>
            </View>
            <Note text="Synthèse des contrôles journalisés" />
          </Fact>
          <Fact label="Décision attendue">
            <Text style={[styles.factValue, { color: expected.tone === 'neutral' ? colors.text : toneColor(colors, expected.tone) }]}>{expected.text}</Text>
            {tx.hitl && tx.hitl.status === 'pending' ? <Note icon="clock" tone="human" text="Aucun ordre ne part sans signature" /> : null}
          </Fact>
        </View>
        <View style={styles.foot}>
          <Text style={[styles.small, { color: colors.text2, flex: 1, minWidth: 220 }]}>
            Proposé par l'agent Proposer, confiance {fmt.dec(i.confidence)}. <Text style={{ fontFamily: fonts.serifItalic }}>« {i.rationale} »</Text>
          </Text>
          <Button label="Fiche de décision" icon="file" size="sm" variant="ghost" onPress={() => app.openXai(tx.corr)} />
        </View>
        {tx.tool && tx.tool !== 'intent.emit' ? <Note icon="lock" tone="block" text={`Outil demandé : ${tx.tool}, interdit par le mandat`} /> : null}
      </View>
    </View>
  );
}

export function CurrentDecision({ tx }: { tx: Tx | null }) {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const m = decisionModel(tx);
  return (
    <View style={{ gap: space.s4 }}>
      <View style={[styles.options, { borderColor: colors.border, backgroundColor: colors.surface }]} accessibilityLabel="Issues possibles">
        {VERDICT_OPTIONS.map((o, idx) => {
          const selected = m.sel === o.id;
          const c = toneColor(colors, o.tone);
          return (
            <View
              key={o.id}
              accessibilityLabel={`${o.label}${selected ? ' : décision retenue' : ''}`}
              style={[styles.option, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.line }, selected && { backgroundColor: toneSoft(colors, o.tone) }]}
            >
              <View style={[styles.optionMark, { borderColor: selected ? c : colors.border, backgroundColor: selected ? c : 'transparent' }]}>
                <Icon name={o.icon} size={16} color={selected ? colors.surface : colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionLabel, { color: selected ? colors.text : colors.text2 }]}>{o.label}</Text>
                <Text style={[styles.xs, { color: selected ? c : colors.muted, fontFamily: selected ? fonts.sansSemi : fonts.sans }]}>{selected ? 'DÉCISION RETENUE' : o.hint}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={[styles.reason, { color: m.waiting ? colors.text2 : colors.text }]}>{m.reason}</Text>
      {m.outcome ? <Status tone="neutral" icon={m.outcome[0]} label={m.outcome[1]} /> : null}
      {m.pending && !ui.replay ? <Button label="Ouvrir la validation du gérant" icon="phone" variant="primary" onPress={app.openPhone} style={{ alignSelf: 'flex-start' }} /> : null}
      {!tx ? <Button label="Choisir un cas" variant="outline" onPress={() => app.setMenu(true)} style={{ alignSelf: 'flex-start' }} /> : null}
      <View style={[styles.guarantees, { borderTopColor: colors.line }]} accessibilityLabel="Garanties">
        {(
          [
            ['lock', 'Les agents ne peuvent pas exécuter directement.'],
            ['gate', "Le contrôle FinGuard est la seule porte vers l'action."],
            ['send', "L'exécuteur ne décide pas : il applique l'autorisation."],
          ] as [IconName, string][]
        ).map(([ic, t]) => (
          <View key={t} style={styles.note}>
            <Icon name={ic} size={14} color={colors.text2} />
            <Text style={[styles.small, { color: colors.text2 }]}>{t}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function CaseRow({ tx, stacked }: { tx: Tx | null; stacked: boolean }) {
  return (
    <View style={[styles.caseRow, stacked && { flexDirection: 'column' }]}>
      <View style={[styles.caseCol, !stacked && { flex: 1.1 }]}>
        <SectionHead num="01" title="Transaction en cours" />
        <Dossier tx={tx} />
      </View>
      <View style={[styles.caseCol, !stacked && { flex: 1 }]}>
        <SectionHead num="02" title="Décision actuelle" />
        <CurrentDecision tx={tx} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caseRow: { flexDirection: 'row', gap: space.s6 },
  caseCol: { gap: space.s4 },
  empty: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s5, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: space.s5 },
  emptyIcon: { width: 72, height: 72, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, paddingHorizontal: space.s3, paddingVertical: 6, minWidth: 220 },
  sheet: { borderWidth: 1, borderRadius: radius.md, borderTopLeftRadius: 0, padding: space.s4, gap: space.s4 },
  sheetHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.s3 },
  amount: { fontFamily: fonts.serifSemi, fontSize: 38, lineHeight: 44 },
  asset: { fontFamily: fonts.serif, fontSize: fs.md + 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1 },
  fact: { flexBasis: '50%', flexGrow: 1, minWidth: 200, paddingVertical: space.s3, paddingRight: space.s3, gap: 4, borderBottomWidth: 1 },
  factLabel: { fontFamily: fonts.sansSemi, fontSize: 12, letterSpacing: 0.6 },
  factValue: { fontFamily: fonts.sansMedium, fontSize: fs.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteText: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 17, flexShrink: 1 },
  threshold: { height: 8, borderRadius: 2, borderWidth: StyleSheet.hairlineWidth, marginVertical: 4, maxWidth: 220 },
  riskBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 },
  riskBar: { width: 5, borderRadius: 1 },
  foot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s3 },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 20 },
  xs: { fontSize: fs.xs, lineHeight: 17 },
  mono: { fontFamily: fonts.mono, fontSize: fs.xs },
  options: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.s3, padding: space.s3, minHeight: 60 },
  optionMark: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { fontFamily: fonts.sansSemi, fontSize: fs.md },
  reason: { fontFamily: fonts.serif, fontSize: fs.md + 1, lineHeight: 25 },
  guarantees: { borderTopWidth: 1, paddingTop: space.s3, gap: 6 },
});
