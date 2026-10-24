/*
 * Salle de contrôle (vue technique complète, port de dashboard.html), organisée en onglets :
 * Opération en cours · Récit des décisions · Journal de preuve · Système sous contrôle · Scénarios.
 * Grand écran : les scénarios restent dans une colonne de pilotage à droite, qui défile séparément.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog, DetailsSheet, PhoneModal, ScenarioMenu } from '../components/Overlays';
import { CaseRow } from '../components/room/CaseFile';
import { Chain } from '../components/room/Chain';
import { Pilot } from '../components/room/Pilot';
import { JournalTab, RecitTab } from '../components/room/Proof';
import { Charter, RoomBanners, RoomHeader, StatusBar } from '../components/room/RoomChrome';
import { RoomTabs } from '../components/room/RoomTabs';
import { SystemUnderControl } from '../components/room/System';
import { XaiSheet } from '../components/room/XaiSheet';
import * as app from '../state/app';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

export default function Salle() {
  const { colors } = useTheme();
  const { ui } = app.useApp();
  const { width } = useWindowDimensions();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const wide = width >= 1180;
  const mid = width >= 860;
  const pad = width < 600 ? space.s4 : space.s5;
  const tx = app.roomTx();
  // En grand écran, les scénarios sont toujours visibles à droite : l'onglet dédié n'existe pas.
  const tab: app.RoomTab = wide && ui.tab === 'cases' ? 'operation' : ui.tab;

  let content: ReactNode;
  switch (tab) {
    case 'feed':
      content = <RecitTab />;
      break;
    case 'audit':
      content = <JournalTab tx={tx} wide={mid} />;
      break;
    case 'system':
      content = <SystemUnderControl columns={mid ? 3 : 1} />;
      break;
    case 'cases':
      content = <Pilot />;
      break;
    default:
      content = (
        <View style={{ gap: space.s6 }}>
          <Charter />
          <CaseRow tx={tx} stacked={!mid} />
          <Chain tx={tx} />
        </View>
      );
  }

  // La clé remet le défilement en haut à chaque changement d'onglet.
  const main = (
    <ScrollView key={tab} style={{ flex: 1 }} contentContainerStyle={{ padding: pad, gap: space.s5 }} keyboardShouldPersistTaps="handled">
      {content}
      {mid ? null : <StatusBar inline />}
    </ScrollView>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.root, { backgroundColor: colors.bg }]}>
      <RoomHeader />
      <RoomBanners />
      <RoomTabs showCases={!wide} short={width < 900} />
      {wide ? (
        <View style={styles.layout}>
          <View style={{ flex: 1, minWidth: 0 }}>{main}</View>
          <ScrollView style={[styles.aside, { borderLeftColor: colors.line, backgroundColor: colors.canvas }]} contentContainerStyle={{ padding: space.s5 }} keyboardShouldPersistTaps="handled">
            <Pilot />
          </ScrollView>
        </View>
      ) : (
        main
      )}
      {mid ? <StatusBar /> : null}
      {focused ? (
        <>
          <XaiSheet />
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
  root: { flex: 1 },
  layout: { flex: 1, flexDirection: 'row' },
  aside: { width: 380, flexGrow: 0, borderLeftWidth: 1 },
});
