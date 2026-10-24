/*
 * Thème jour / nuit : suit le système par défaut, puis mémorise le choix explicite de l'utilisateur.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { palettes, type Palette, type ThemeName } from './tokens';

export type ThemePreference = ThemeName | 'system';

type ThemeContextValue = {
  name: ThemeName;
  preference: ThemePreference;
  colors: Palette;
  setPreference: (pref: ThemePreference) => void;
  toggle: () => void;
};

const STORAGE_KEY = 'managent.theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPref] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (value === 'light' || value === 'dark' || value === 'system') setPref(value);
      })
      .catch(() => undefined);
  }, []);

  const name: ThemeName = preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;
  const colors = palettes[name];

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);
  }, [colors.bg]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPref(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    setPreference(name === 'dark' ? 'light' : 'dark');
  }, [name, setPreference]);

  const value = useMemo(() => ({ name, preference, colors, setPreference, toggle }), [name, preference, colors, setPreference, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme doit être utilisé sous <ThemeProvider>.');
  return ctx;
}
