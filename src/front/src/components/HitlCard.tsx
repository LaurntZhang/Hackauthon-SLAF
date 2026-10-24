/*
 * Carte de validation du gérant (port de hitl-card.js) : Approuver / Refuser / Décider plus tard / Fiche explicative.
 * Le code PIN simule la biométrie ; la décision est signée en HMAC et liée à l'empreinte de l'intention.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, cryptoLib, fmt, transport } from '../engine';
import type { Decision, DecisionRecord, HitlCardData } from '../engine/types';
import * as W from '../domain/wording';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, fs, radius, space, toneColor, toneSoft } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Button, Facts, Status } from './ui';

const JUDGE_NAMES: Record<string, string> = { risk_judge: 'Contrôle risque', compliance_judge: 'Contrôle conformité' };
const JUDGE_SUBJECT: Record<string, string> = { risk_judge: 'Le contrôle risque', compliance_judge: 'Le contrôle conformité' };

/** Retire le préfixe technique (ALLOW : / ESCALATE : / BLOCK :) d'une explication journalisée. */
function plain(text?: string) {
  const t = String(text || '').replace(/^(ALLOW|ESCALATE|BLOCK)\s*:\s*/, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

type View_ = 'review' | 'pin' | 'report' | 'later' | 'done';

type Props = {
  card: HitlCardData;
  onDecide: (decision: Decision) => Promise<{ ok: boolean; error?: string; signature?: string }>;
  onReport?: () => void;
  getRecord?: () => DecisionRecord | null;
  /** Statut si la décision a été prise sur un autre écran. */
  resolvedStatus?: string | null;
};

export function HitlCard({ card, onDecide, onReport, getRecord, resolvedStatus }: Props) {
  const { colors } = useTheme();
  const [view, setView] = useState<View_>('review');
  const [act, setAct] = useState<'approve' | 'reject'>('approve');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ signature?: string; elsewhere?: string } | null>(null);
  const [record, setRecord] = useState<DecisionRecord | null>(null);

  const intent = card.intent;
  const amount = fmt.eur(intent.amount);
  const maxAmount = (card.policy && card.policy.effective_max) || C.LIMITS.autonomousMax;

  // Décision prise ailleurs : on l'affiche, sauf si c'est notre propre signature en cours de transmission.
  useEffect(() => {
    if (resolvedStatus && view !== 'done' && !busy) {
      setAct(resolvedStatus === 'approved' ? 'approve' : 'reject');
      setResult({ elsewhere: resolvedStatus === 'approved' ? 'approuvée' : 'refusée' });
      setView('done');
    }
  }, [resolvedStatus, view, busy]);

  function reasonText(ruleId: string) {
    if (ruleId === 'QRM-001') {
      const dissent = (card.verdicts || []).filter((v) => v.vote !== 'approve');
      if (dissent.length) {
        const who = dissent.map((v) => `${JUDGE_SUBJECT[v.judge_id] || fmt.actor(v.judge_id)} ${v.vote === 'veto' ? 'oppose son veto' : "s'abstient"}`).join(' et ');
        return `${who} : seul un humain peut trancher.`;
      }
    }
    return W.rule(ruleId, { max: fmt.eur(maxAmount) });
  }

  function start(action: 'approve' | 'reject') {
    setAct(action);
    setPin('');
    setError(null);
    setView('pin');
  }

  function press(key: string) {
    if (busy) return;
    setError(null);
    if (key === 'del') setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < 4 ? p + key : p));
  }

  async function submit() {
    if (busy) return;
    if (!/^\d{4}$/.test(pin)) return setError('Saisissez les 4 chiffres du code.');
    if (transport.mode === 'sim' && pin !== C.DEMO_PIN) {
      setPin('');
      return setError("Code incorrect. La décision n'a pas été signée.");
    }
    const timestamp = new Date().toISOString();
    const payload = cryptoLib.hitlPayload(card.thread_id, act, C.APPROVER_ID, timestamp, card.intent_hash);
    const decision: Decision = { action: act, approver_id: C.APPROVER_ID, timestamp, pin, signature: transport.mode === 'sim' ? cryptoLib.hmacHex(C.DEMO_HMAC_KEY, payload) : '' };
    setBusy(true);
    const res = await onDecide(decision);
    setBusy(false);
    if (!res || !res.ok) return setError((res && res.error) || "La décision n'a pas pu être transmise.");
    setResult({ signature: res.signature || decision.signature || undefined });
    setView('done');
  }

  const Head = (
    <View style={{ gap: 6 }}>
      <View style={styles.eyebrow}>
        <Icon name="pen" size={15} color={colors.human} />
        <Text style={[styles.eyebrowText, { color: colors.human }]}>VALIDATION DU GÉRANT · AI ACT ART. 14</Text>
      </View>
      <Text style={[styles.lead, { color: colors.text }]}>Une décision est attendue</Text>
      <Text accessibilityRole="header" style={[styles.amount, { color: colors.text }]}>
        {fmt.side(intent.side)} de {amount}
      </Text>
      <Text style={[styles.asset, { color: colors.text }]}>
        {card.asset_label} <Text style={{ color: colors.muted }}>· {C.ASSET_TYPE_LABELS[intent.asset_type || ''] || intent.asset_type}</Text>
      </Text>
      <View style={{ marginTop: space.s2 }}>
        <Facts rows={[['Contrepartie', intent.counterparty], ['Demandée à', card.requested_at ? fmt.time(card.requested_at) : 'Heure indisponible'], ['Dossier', card.correlation_id]]} />
      </View>
    </View>
  );

  if (view === 'pin') {
    const approve = act === 'approve';
    return (
      <View style={styles.wrap}>
        <BackLink label="Retour, sans signer" onPress={() => setView('review')} />
        <View style={styles.eyebrow}>
          <Icon name="pen" size={15} color={colors.human} />
          <Text style={[styles.eyebrowText, { color: colors.human }]}>SIGNATURE</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.amountSm, { color: colors.text }]}>
          {approve ? 'Approuver' : 'Refuser'} {amount}
        </Text>
        <Text style={[styles.asset, { color: colors.muted }]}>
          {card.asset_label} · {intent.counterparty}
        </Text>
        <Text style={[styles.text, { color: colors.text2 }]}>
          La décision sera signée (HMAC-SHA256) et liée à l'empreinte de l'ordre <Text style={styles.mono}>{fmt.shortHash(card.intent_hash)}</Text>. Elle sera inscrite au journal de preuve.
        </Text>
        <View accessibilityLabel={`Code de confirmation : ${pin.length} chiffre${pin.length > 1 ? 's' : ''} sur 4`} accessibilityLiveRegion="polite" style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.dot, { borderColor: error ? colors.block : colors.borderStrong, backgroundColor: i < pin.length ? colors.text : 'transparent' }]} />
          ))}
        </View>
        <View style={styles.help}>
          <Icon name="fingerprint" size={16} color={colors.muted} />
          <Text style={[styles.small, { color: colors.muted }]}>
            Simule la biométrie du téléphone. {transport.mode === 'sim' ? `Code de démo : ${C.DEMO_PIN}.` : 'Saisissez le code configuré sur le serveur.'}
          </Text>
        </View>
        {error ? (
          <View accessibilityRole="alert" style={styles.help}>
            <Icon name="alert" size={16} color={colors.block} />
            <Text style={[styles.small, { color: colors.block, fontFamily: fonts.sansMedium }]}>{error}</Text>
          </View>
        ) : null}
        <View style={styles.keypad} accessibilityLabel="Pavé numérique">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
            <Key key={k} k={k} disabled={busy} onPress={() => (k === 'ok' ? submit() : press(k))} />
          ))}
        </View>
        <Button
          label={busy ? 'Signature en cours…' : `Signer et ${approve ? 'approuver' : 'refuser'}`}
          icon="lock"
          variant={approve ? 'approve' : 'danger'}
          size="lg"
          block
          busy={busy}
          onPress={submit}
        />
      </View>
    );
  }

  if (view === 'report') {
    return (
      <View style={styles.wrap}>
        <BackLink label="Retour à la décision" onPress={() => setView('review')} />
        {record ? (
          <>
            <Text accessibilityRole="header" style={[styles.amountSm, { color: colors.text }]}>
              Fiche explicative · {record.correlation_id}
            </Text>
            <Text style={[styles.text, { color: colors.text2 }]}>{record.summary}</Text>
            <Section title="Facteurs journalisés">
              {record.factors.map((f) => {
                const tone = f.effect === 'favorable' ? 'ok' : f.effect === 'adverse' ? 'block' : 'human';
                return (
                  <View key={`${f.line}`} style={[styles.factor, { borderLeftColor: toneColor(colors, tone), backgroundColor: colors.surface }]}>
                    <Text style={[styles.small, { color: colors.text, fontFamily: fonts.sansSemi }]}>
                      {f.actor} <Text style={[styles.mono, { color: colors.muted }]}>n° {f.line}</Text>
                    </Text>
                    <Text style={[styles.small, { color: colors.text2 }]}>{f.text}</Text>
                  </View>
                );
              })}
            </Section>
            <Section title="Incertitudes">
              {record.uncertainties.map((u) => (
                <Text key={u} style={[styles.small, { color: colors.text2 }]}>
                  • {u}
                </Text>
              ))}
            </Section>
            <Text style={[styles.small, { color: colors.muted }]}>
              Cette fiche reprend les règles et votes journalisés. Elle ne reconstitue pas un raisonnement interne de modèle.
            </Text>
          </>
        ) : (
          <Text style={[styles.text, { color: colors.text2 }]}>Fiche indisponible.</Text>
        )}
      </View>
    );
  }

  if (view === 'later') {
    return (
      <View style={[styles.wrap, styles.center]} accessibilityLiveRegion="polite">
        <DoneIcon icon="pause" tone="human" />
        <Text accessibilityRole="header" style={[styles.amountSm, { color: colors.text, textAlign: 'center' }]}>
          Décision mise en attente
        </Text>
        <Text style={[styles.text, { color: colors.text2, textAlign: 'center' }]}>
          L'opération de {amount} sur {card.asset_label} reste suspendue : aucun ordre ne part sans votre signature.
        </Text>
        <Button label="Reprendre la décision" icon="replay" variant="primary" size="lg" onPress={() => setView('review')} />
      </View>
    );
  }

  if (view === 'done') {
    const approved = act === 'approve';
    const elsewhere = result && result.elsewhere;
    const title = elsewhere ? 'Décision déjà prise' : approved ? 'Approbation signée' : 'Refus signé';
    const text = elsewhere
      ? `Cette demande a été traitée sur un autre écran (${elsewhere}).`
      : approved
        ? `Signature vérifiée. Le traitement reprend sur ${card.thread_id} ; l'ordre reste soumis aux contrôles d'intégrité et aux limites du jour.`
        : "Signature vérifiée. L'exécuteur ne sera pas sollicité.";
    return (
      <View style={[styles.wrap, styles.center]} accessibilityLiveRegion="polite">
        <DoneIcon icon={elsewhere ? 'info' : approved ? 'checkCircle' : 'xCircle'} tone={elsewhere ? 'neutral' : approved ? 'ok' : 'block'} />
        <Text accessibilityRole="header" style={[styles.amountSm, { color: colors.text, textAlign: 'center' }]}>
          {title}
        </Text>
        <Text style={[styles.text, { color: colors.text2, textAlign: 'center' }]}>{text}</Text>
        {result && result.signature ? (
          <Text style={[styles.small, { color: colors.muted, textAlign: 'center' }]}>
            Signature HMAC <Text style={styles.mono}>{result.signature.slice(0, 24)}…</Text> · inscrite au journal de preuve
          </Text>
        ) : null}
      </View>
    );
  }

  // Vue principale : contexte, raisons, contrôles, preuve, puis actions.
  return (
    <View style={styles.wrap}>
      {Head}
      <View style={[styles.why, { backgroundColor: colors.humanSoft, borderLeftColor: colors.humanLine }]}>
        <Text style={[styles.sectionTitle, { color: colors.human }]}>POURQUOI VOUS ÊTES SOLLICITÉ</Text>
        {(card.reasons || []).map((r) => (
          <View key={r} style={{ gap: 2 }}>
            <Text style={[styles.text, { color: colors.text }]}>{reasonText(r)}</Text>
            <Text style={[styles.small, { color: colors.muted }]}>
              Règle <Text style={styles.mono}>{r}</Text>
            </Text>
          </View>
        ))}
      </View>
      <Section title="CONTRÔLES DÉJÀ EFFECTUÉS">
        {card.policy ? (
          <Check name="Analyse du mandat" status={card.policy.outcome} label={card.policy.outcome === 'ESCALATE' ? 'Seuil dépassé' : undefined} text={plain(card.policy.explanation)} />
        ) : null}
        {(card.verdicts || []).map((v) => (
          <Check key={v.judge_id} name={JUDGE_NAMES[v.judge_id] || fmt.actor(v.judge_id)} status={v.vote} text={v.justification} />
        ))}
        {card.quorum ? <Check name="Décision des contrôles" status={card.quorum.outcome} text={plain(card.quorum.explanation)} /> : null}
      </Section>
      <Section title="CE QUE PROPOSE L'AGENT">
        <Text style={[styles.text, { color: colors.text2 }]}>
          {intent.rationale} <Text style={{ color: colors.muted }}>Confiance déclarée {fmt.dec(intent.confidence)}.</Text>
        </Text>
      </Section>
      <Section title="ÉLÉMENTS DE PREUVE">
        <Facts
          rows={[
            ["Empreinte de l'ordre", fmt.shortHash(card.intent_hash)],
            ['Traitement suspendu', card.thread_id],
            ['Règles appliquées', (card.policy && card.policy.policy_version) || C.POLICY_VERSION],
          ]}
        />
        <Text style={[styles.small, { color: colors.muted }]}>Votre signature sera liée à cette empreinte : si l'ordre change ensuite, il sera bloqué avant le marché.</Text>
      </Section>
      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        <View style={styles.row}>
          <Button label="Approuver" icon="check" variant="approve" size="lg" style={styles.flex} onPress={() => start('approve')} />
          <Button label="Refuser" icon="x" variant="dangerOutline" size="lg" style={styles.flex} onPress={() => start('reject')} />
        </View>
        <View style={styles.row}>
          <Button label="Décider plus tard" icon="pause" variant="ghost" style={styles.flex} onPress={() => setView('later')} />
          <Button
            label="Fiche explicative"
            icon="file"
            variant="ghost"
            style={styles.flex}
            onPress={() => {
              setRecord(getRecord ? getRecord() : null);
              if (onReport) onReport();
              setView('report');
            }}
          />
        </View>
        <View style={styles.help}>
          <Icon name="lock" size={15} color={colors.muted} />
          <Text style={[styles.small, { color: colors.muted, flex: 1 }]}>Rien n'est exécuté sans votre signature. Vous pouvez revenir en arrière jusqu'au moment de signer.</Text>
        </View>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text2 }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Check({ name, status, label, text }: { name: string; status: string; label?: string; text?: string }) {
  const { colors } = useTheme();
  const info = W.statusInfo(status);
  return (
    <View style={[styles.check, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.checkHead}>
        <Text style={[styles.small, { color: colors.text, fontFamily: fonts.sansSemi, flex: 1 }]}>{name}</Text>
        <Status tone={info.tone} icon={info.icon} label={label || info.label} size="sm" />
      </View>
      {text ? <Text style={[styles.small, { color: colors.text2 }]}>{text}</Text> : null}
    </View>
  );
}

function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.back} hitSlop={8}>
      <Icon name="chevronLeft" size={16} color={colors.accent} />
      <Text style={[styles.small, { color: colors.accent, fontFamily: fonts.sansMedium }]}>{label}</Text>
    </Pressable>
  );
}

function DoneIcon({ icon, tone }: { icon: IconName; tone: 'ok' | 'block' | 'human' | 'neutral' }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.doneIcon, { backgroundColor: toneSoft(colors, tone) }]}>
      <Icon name={icon} size={30} color={toneColor(colors, tone)} />
    </View>
  );
}

function Key({ k, onPress, disabled }: { k: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const ok = k === 'ok';
  const label = k === 'del' ? 'Effacer le dernier chiffre' : ok ? 'Signer la décision' : k;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={(state: any) => [
        styles.key,
        {
          backgroundColor: ok ? colors.accent : state.pressed || state.hovered ? colors.surface2 : colors.surface,
          borderColor: ok ? colors.accent : colors.border,
        },
      ]}
    >
      {k === 'del' ? (
        <Icon name="backspace" size={20} color={colors.text2} />
      ) : ok ? (
        <Icon name="check" size={22} color={colors.onAccent} />
      ) : (
        <Text style={[styles.keyText, { color: colors.text }]}>{k}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s4 },
  center: { alignItems: 'center', paddingVertical: space.s6 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrowText: { fontFamily: fonts.sansSemi, fontSize: fs.xs, letterSpacing: 0.6 },
  lead: { fontFamily: fonts.serifSemi, fontSize: fs.lg + 2 },
  amount: { fontFamily: fonts.sansSemi, fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  amountSm: { fontFamily: fonts.serifSemi, fontSize: fs.xl, lineHeight: 28 },
  asset: { fontFamily: fonts.sansMedium, fontSize: fs.md + 1 },
  text: { fontFamily: fonts.sans, fontSize: fs.md, lineHeight: 22 },
  small: { fontFamily: fonts.sans, fontSize: fs.sm, lineHeight: 19 },
  mono: { fontFamily: fonts.mono, fontSize: fs.xs },
  why: { borderLeftWidth: 3, padding: space.s4, gap: space.s3, borderRadius: radius.sm },
  sectionTitle: { fontFamily: fonts.sansSemi, fontSize: fs.xs, letterSpacing: 0.6 },
  check: { borderWidth: 1, borderRadius: radius.md, padding: space.s3, gap: 4 },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: space.s2, flexWrap: 'wrap' },
  factor: { borderLeftWidth: 3, padding: space.s3, gap: 2, borderRadius: radius.sm },
  actions: { gap: space.s3, borderTopWidth: 1, paddingTop: space.s4 },
  row: { flexDirection: 'row', gap: space.s3 },
  flex: { flex: 1 },
  help: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, alignSelf: 'flex-start' },
  dots: { flexDirection: 'row', gap: space.s4, alignSelf: 'center', paddingVertical: space.s2 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2, justifyContent: 'space-between' },
  key: { width: '31.5%', height: 54, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontFamily: fonts.sansMedium, fontSize: fs.xl },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
