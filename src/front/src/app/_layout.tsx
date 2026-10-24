// Imports par graisse : seules les polices utilisées entrent dans le bundle.
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSerif_400Regular_Italic } from '@expo-google-fonts/ibm-plex-serif/400Regular_Italic';
import { IBMPlexSerif_500Medium } from '@expo-google-fonts/ibm-plex-serif/500Medium';
import { IBMPlexSerif_600SemiBold } from '@expo-google-fonts/ibm-plex-serif/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

function Shell({ ready }: { ready: boolean }) {
  const { name, colors } = useTheme();
  return (
    <>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      {ready ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
          <Stack.Screen name="index" options={{ title: 'ManAgent · Tour de contrôle' }} />
          <Stack.Screen name="salle" options={{ title: 'ManAgent · Salle de contrôle' }} />
          <Stack.Screen name="gerant" options={{ title: 'ManAgent · Validation du gérant' }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel="Chargement" />
        </View>
      )}
    </>
  );
}

export default function RootLayout() {
  // Web statique : le HTML pré-rendu ne connaît ni le thème du système ni l'heure ; on n'affiche
  // l'interface qu'une fois monté côté client pour éviter tout écart d'hydratation.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [loaded, error] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSerif_400Regular_Italic,
    IBMPlexSerif_500Medium,
    IBMPlexSerif_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });
  if (!mounted) return <View style={{ flex: 1 }} />;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        {/* En cas d'échec de chargement des polices, on affiche quand même l'interface (polices système). */}
        <Shell ready={loaded || Boolean(error)} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
