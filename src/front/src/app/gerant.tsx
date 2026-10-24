/*
 * Écran mobile du gérant : la carte Approuver / Refuser, signée et liée à l'empreinte de l'ordre.
 * Source de la demande : le moteur local (même appareil) ou, sur le web, une tour de contrôle ouverte dans un autre onglet.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HitlCard } from '../components/HitlCard';
import { Icon } from '../components/Icon';
import { Brand, ThemeToggle } from '../components/Tower';
import { Button, Txt } from '../components/ui';
import { store } from '../engine';
import type { HitlCardData } from '../engine/types';
import * as app from '../state/app';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, fs, radius, space } from '../theme/tokens';

export default function Gerant() {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const { width } = useWindowDimensions();
  const [card, setCard] = useState<HitlCardData | null>(null);

  const localPending = store.pending;
  const remote = !localPending && ui.remote ? ui.remote : null;

  // La carte reste affichée après la décision (écran « signée ») jusqu'à la demande suivante.
  useEffect(() => {
    const next = localPending ? localPending.card : remote ? remote.card : null;
    if (next && (!card || card.thread_id !== next.thread_id)) setCard(next);
  }, [localPending, remote, card]);

  const tx = card ? store.txs.get(card.correlation_id) : null;
  // Carte reçue d'un autre onglet : la tour de contrôle distante vérifie et applique la décision.
  const isRemote = Boolean(card && !tx);
  let resolved: string | null = null;
  if (card && isRemote) resolved = ui.remoteResolved && ui.remoteResolved.thread_id === card.thread_id ? ui.remoteResolved.status : null;
  else if (tx && tx.hitl && tx.hitl.status !== 'pending') resolved = tx.hitl.status;
  const linkState = localPending || remote ? 'demande reçue' : app.busy() ? 'traitement…' : 'en veille';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.bar, { borderBottomColor: colors.line, backgroundColor: colors.surface }]}>
        <Brand subtitle="Gérant du fonds Alpha · validation" />
        <ThemeToggle compact />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingHorizontal: width < 480 ? space.s4 : space.s5 }]}>
        <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', gap: space.s4 }}>
          <View style={styles.barRight}>
            <Button label="Tour de contrôle" icon="chevronLeft" variant="ghost" size="sm" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
            <View style={[styles.chip, { borderColor: colors.border }]} accessibilityLiveRegion="polite">
              <Text style={[styles.chipText, { color: colors.text2 }]}>{linkState}</Text>
            </View>
          </View>
          {card ? (
            <HitlCard
              key={card.thread_id}
              card={card}
              resolvedStatus={resolved}
              onDecide={(decision) => (isRemote ? app.decideRemote(card.thread_id, decision) : app.decide(card.thread_id, decision))}
              onReport={() => (isRemote ? app.requestReportRemote(card.thread_id) : app.requestReport(card.thread_id))}
              getRecord={() => (isRemote ? (ui.remote && ui.remote.record) || null : store.decisionRecord(card.correlation_id))}
            />
          ) : (
            <View style={[styles.idle, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={[styles.idleIcon, { backgroundColor: colors.accentSoft }]}>
                <Icon name="phone" size={28} color={colors.accent} />
              </View>
              <Txt variant="serif" accessibilityRole="header" style={{ textAlign: 'center' }}>
                Aucune décision en attente
              </Txt>
              <Txt variant="small" color="text2" style={{ textAlign: 'center' }}>
                La demande apparaît dès qu'une opération est escaladée : montant au-delà du seuil, veto ou abstention d'un contrôle.
              </Txt>
              <Button
                label="Simuler une demande (S2 · 85 000 €)"
                icon="play"
                variant="primary"
                disabled={app.busy()}
                busy={ui.running === 'veto_hitl'}
                onPress={() => app.runScenario('veto_hitl')}
              />
            </View>
          )}
          <Text style={[styles.foot, { color: colors.muted }]}>
            Écran simulé du gérant. La biométrie est remplacée par un code ; chaque décision est signée, liée à l'empreinte de l'ordre et inscrite au journal de preuve.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s3, paddingHorizontal: space.s4, paddingVertical: space.s3, borderBottomWidth: 1 },
  barRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s2 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.s3, paddingVertical: 4 },
  chipText: { fontFamily: fonts.sansMedium, fontSize: fs.xs },
  body: { paddingVertical: space.s4, paddingBottom: space.s7 },
  idle: { borderWidth: 1, borderRadius: radius.lg, padding: space.s5, gap: space.s3, alignItems: 'center' },
  idleIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  foot: { fontFamily: fonts.sans, fontSize: fs.xs, lineHeight: 18 },
});
