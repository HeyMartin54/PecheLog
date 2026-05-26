import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { getSpeciesColor } from '@/lib/species';

const STORAGE_KEY = 'pechelog_species_colors';

export type SpeciesColorMap = Record<string, string>;

export function useSpeciesColors() {
  const [customColors, setCustomColors] = useState<SpeciesColorMap>({});

  const loadFromStorage = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      setCustomColors(raw ? JSON.parse(raw) : {});
    } catch {
      setCustomColors({});
    }
  }, []);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const getColor = useCallback(
    (species: string): string => customColors[species] ?? getSpeciesColor(species),
    [customColors],
  );

  const setColor = useCallback(async (species: string, color: string) => {
    const updated = { ...customColors, [species]: color };
    setCustomColors(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, [customColors]);

  const resetColor = useCallback(async (species: string) => {
    const updated = { ...customColors };
    delete updated[species];
    setCustomColors(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, [customColors]);

  return { getColor, setColor, resetColor, customColors, refresh: loadFromStorage };
}
