/*
 * Tour de contrôle (mode jury) : une opération, plusieurs garde-fous, une décision traçable.
 * Bureau : barre latérale + parcours en grille. Tablette / mobile : bandeau d'étapes + parcours vertical.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionBar, Brand, ExplainPanel, Notices, SideLinks, StepTracker, SummaryCards, ThemeToggle, Toolbar } from '../components/Tower';
import { FlowCanvas } from '../components/FlowCanvas';
import { ConfirmDialog, DetailsSheet, PhoneModal, ScenarioMenu } from '../components/Overlays';
import { Button, IconButton, Txt } from '../components/ui';
import { autoStep, computeSteps, currentTx, verdictOf } from '../domain/steps';
import * as app from '../state/app';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, fs, radius, space } from '../theme/tokens';

export default function Tower() {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const { width } = useWindowDimensions();
  const [canvasW, setCanvasW] = useState(0);
  const [focused, setFocused] = useState(true);

  // Les couches modales ne s'affichent que si la tour est l'écran actif (pas par-dessus l'écran du gérant).
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const wide = width >= 1100;
  const narrow = width < 700;
  const pad = narrow ? space.s4 : wide ? 28 : space.s5;

  const tx = currentTx();
  const data = computeSteps(tx);
  const shown = ui.pinned && ui.selected ? ui.selected : autoStep(tx, data);
  const verdict = verdictOf(tx, data);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: colors.bg }]}>
      {wide ? (
        <View style={[styles.side, { backgroundColor: colors.side, borderRightColor: colors.line }]}>
          <Brand subtitle="FinGuard · mode jury" />
          <View style={[styles.rule, { backgroundColor: colors.line }]} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.s4 }}>
            <StepTracker tx={tx} data={data} shown={shown} />
          </ScrollView>
          <SideLinks />
        </View>
      ) : null}

      <View style={styles.main}>
        <ScrollView contentContainerStyle={{ padding: pad, paddingTop: wide ? space.s4 : space.s3, gap: space.s4 }} keyboardShouldPersistTaps="handled">
          {wide ? null : (
            <View style={{ gap: space.s3, marginHorizontal: -pad }}>
              <View style={[styles.topBrand, { paddingHorizontal: pad }]}>
                <Brand subtitle="FinGuard · mode jury" />
                <View style={styles.topBrandRight}>
                  {narrow ? (
                    <>
                      <IconButton icon="terminal" label="Vue technique complète" onPress={() => router.push('/salle')} />
                      <IconButton icon="phone" label="Écran mobile du gérant" onPress={() => router.push('/gerant')} />
                    </>
                  ) : (
                    <>
                      <Button label="Vue technique" icon="terminal" size="sm" variant="ghost" onPress={() => router.push('/salle')} />
                      <Button label="Écran du gérant" icon="phone" size="sm" variant="ghost" onPress={() => router.push('/gerant')} />
                    </>
                  )}
                  <ThemeToggle compact />
                </View>
              </View>
              <StepTracker tx={tx} data={data} shown={shown} horizontal />
            </View>
          )}

          <View style={[styles.header, narrow && { flexDirection: 'column', alignItems: 'stretch' }, { borderBottomColor: colors.line }]}>
            <Text style={[styles.tagline, { color: colors.text2 }]}>Une opération, plusieurs garde-fous, une décision traçable.</Text>
            <Toolbar stacked={narrow} />
          </View>

          <Notices />
          <SummaryCards tx={tx} verdict={verdict} columns={width >= 980 ? 3 : 1} />

          <View style={[styles.canvas, { backgroundColor: colors.canvas, borderColor: colors.border, padding: narrow ? space.s4 : space.s5 }]}>
            <View style={styles.canvasHead}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: narrow ? fs.xl : fs.x2 - 4 }]}>
                Une décision contrôlée de bout en bout
              </Text>
              <Txt variant="small" color="text2">
                Les agents proposent. ManAgent vérifie. L'humain garde la main.
              </Txt>
            </View>
            <View onLayout={(e) => setCanvasW(Math.floor(e.nativeEvent.layout.width))} style={{ alignItems: 'center' }}>
              {canvasW > 0 ? (
                <FlowCanvas width={canvasW >= 860 ? canvasW : Math.min(canvasW, 560)} data={data} shown={shown} onSelect={app.selectStep} />
              ) : null}
            </View>
          </View>

          <ExplainPanel tx={tx} data={data} shown={shown} stacked={narrow} />
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: pad, backgroundColor: colors.bg }}>
          <ActionBar narrow={narrow} />
        </SafeAreaView>
      </View>

      {focused ? (
        <>
          <DetailsSheet />
          <PhoneModal />
          <ScenarioMenu />
          <ConfirmDialog />
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  side: { width: 248, borderRightWidth: 1, paddingHorizontal: space.s4, paddingTop: space.s4, paddingBottom: space.s4, gap: space.s3 },
  rule: { height: 1, marginVertical: space.s2 },
  main: { flex: 1 },
  topBrand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s3 },
  topBrandRight: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.s3, paddingBottom: space.s3, borderBottomWidth: 1 },
  tagline: { fontFamily: fonts.serifItalic, fontSize: fs.md + 1, flexShrink: 1 },
  canvas: { borderWidth: 1, borderRadius: radius.md, gap: space.s5 },
  canvasHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.s4, rowGap: 4 },
  title: { fontFamily: fonts.serifSemi },
});
