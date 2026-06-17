import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { dateLocale, translate } from '@/lib/i18n';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  displayLength,
  displayTemp,
  displayWeight,
  loadSettings,
  pullSettingsFromProfile,
  pushSettingsToProfile,
  saveSettings,
} from '@/lib/settingsStorage';

type SettingsContextValue = {
  settings: AppSettings;
  settingsLoaded: boolean;
  updateSettings: (partial: Partial<AppSettings>) => void;
  /** Traduction UI : t('settings.units') */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Locale pour toLocaleDateString / toLocaleTimeString */
  locale: string;
  /** Formate une température stockée en °C selon la préférence (ex: "21.3 °C"). */
  fmtTemp: (celsius: number, decimals?: number) => string;
  /** Formate un poids stocké en lb selon la préférence (ex: "3.2 lb" / "1.5 kg"). */
  fmtWeight: (lbs: number, decimals?: number) => string;
  /** Formate une longueur stockée en pouces selon la préférence (ex: "18.0 po" / "45.7 cm"). */
  fmtLength: (inches: number, decimals?: number) => string;
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  updateSettings: () => {},
  t: (key) => key,
  locale: 'fr-CA',
  fmtTemp: (c) => `${c.toFixed(1)} °C`,
  fmtWeight: (lbs) => `${lbs.toFixed(1)} lb`,
  fmtLength: (inches) => `${inches.toFixed(1)} po`,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const hasLocalValue = useRef(false);

  // Chargement initial : AsyncStorage est la source de vérité.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await loadSettings();
      if (cancelled) return;
      setSettings(local);
      setSettingsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Premier lancement sur un nouvel appareil : récupérer les unités du profil
  // (best-effort, ne remplace jamais un choix local déjà fait).
  useEffect(() => {
    if (!settingsLoaded || !user?.id || hasLocalValue.current) return;
    let cancelled = false;
    (async () => {
      const remote = await pullSettingsFromProfile(user.id);
      if (cancelled || !remote || hasLocalValue.current) return;
      setSettings((prev) => {
        const merged = { ...prev, ...remote };
        saveSettings(merged);
        return merged;
      });
    })();
    return () => { cancelled = true; };
  }, [settingsLoaded, user?.id]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    hasLocalValue.current = true;
    setSettings((prev) => {
      const merged = { ...prev, ...partial };
      saveSettings(merged);
      if (user?.id) pushSettingsToProfile(user.id, merged); // best-effort, non bloquant
      return merged;
    });
  }, [user?.id]);

  const value = useMemo<SettingsContextValue>(() => {
    const { language, tempUnit, weightUnit, lengthUnit } = settings;
    const t = (key: string, vars?: Record<string, string | number>) => translate(language, key, vars);
    return {
      settings,
      settingsLoaded,
      updateSettings,
      t,
      locale: dateLocale(language),
      fmtTemp: (celsius, decimals = 1) =>
        `${displayTemp(celsius, tempUnit).toFixed(decimals)} ${t(`unit.${tempUnit}`)}`,
      fmtWeight: (lbs, decimals = 1) =>
        `${displayWeight(lbs, weightUnit).toFixed(decimals)} ${t(`unit.${weightUnit}`)}`,
      fmtLength: (inches, decimals = 1) =>
        `${displayLength(inches, lengthUnit).toFixed(decimals)} ${t(`unit.${lengthUnit}`)}`,
    };
  }, [settings, settingsLoaded, updateSettings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
