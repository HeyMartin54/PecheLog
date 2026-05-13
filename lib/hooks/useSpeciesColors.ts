import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { getSpeciesColor } from '@/lib/species';

const STORAGE_KEY = 'pechelog_species_colors';

export type SpeciesColorMap = Record<string, string>;

export function useSpeciesColors() {
  const [customColors, setCustomColors] = useState<SpeciesColorMap>({});

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => { if (raw) setCustomColors(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

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

  return { getColor, setColor, resetColor, customColors };
}
