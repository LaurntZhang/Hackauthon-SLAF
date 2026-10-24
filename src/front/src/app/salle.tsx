/*
 * Salle de contrôle (vue technique complète, port de dashboard.html) :
 * dossier, décision, chaîne, preuve et récit, pilotage des cas, système sous contrôle.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog, DetailsSheet, PhoneModal, ScenarioMenu } from '../components/Overlays';
import { CaseRow } from '../components/room/CaseFile';
import { Chain } from '../components/room/Chain';
import { Pilot } from '../components/room/Pilot';
import { ProofAudit } from '../components/room/Proof';
import { Charter, RoomBanners, RoomHeader, StatusBar } from '../components/room/RoomChrome';
import { SystemUnderControl } from '../components/room/System';
import { XaiSheet } from '../components/room/XaiSheet';
import * as app from '../state/app';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

export default function Salle() {
  const { colors } = useTheme();
  app.useApp();
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

  const main = (
    <View style={{ gap: space.s7 - 8 }}>
      <CaseRow tx={tx} stacked={!mid} />
      <Chain tx={tx} />
      <ProofAudit tx={tx} wide={mid} />
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.root, { backgroundColor: colors.bg }]}>
      <RoomHeader />
      <ScrollView contentContainerStyle={{ padding: pad, gap: space.s5 }} keyboardShouldPersistTaps="handled">
        <RoomBanners />
        <Charter />
        {wide ? (
          <View style={styles.layout}>
            <View style={{ flex: 1, minWidth: 0 }}>{main}</View>
            <View style={[styles.aside, { borderLeftColor: colors.line }]}>
              <Pilot />
            </View>
          </View>
        ) : (
          <View style={{ gap: space.s6 }}>
            {main}
            <Pilot />
          </View>
        )}
        <SystemUnderControl columns={mid ? 3 : 1} />
        {mid ? null : <StatusBar inline />}
      </ScrollView>
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
  layout: { flexDirection: 'row', gap: space.s6, alignItems: 'flex-start' },
  aside: { width: 340, borderLeftWidth: 1, paddingLeft: space.s5 },
});
