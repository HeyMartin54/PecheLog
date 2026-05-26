import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { SPECIES_CONFIG } from '../species';
import { useCustomSpecies } from './useCustomSpecies';

const STORAGE_KEY = 'pechelog_active_species_v1';

const BUILTIN_SPECIES = Object.keys(SPECIES_CONFIG);

export function useActiveSpecies() {
  const { customSpecies, refresh: refreshCustom } = useCustomSpecies();
  // null = not loaded yet (all active by default)
  const [activeSet, setActiveSet] = useState<Set<string> | null>(null);

  const loadActiveSet = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      setActiveSet(raw ? new Set(JSON.parse(raw) as string[]) : new Set(BUILTIN_SPECIES));
    } catch {
      setActiveSet(new Set(BUILTIN_SPECIES));
    }
  }, []);

  useEffect(() => {
    loadActiveSet();
  }, [loadActiveSet]);

  const persist = useCallback(async (set: Set<string>) => {
    setActiveSet(set);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  }, []);

  const isActive = useCallback(
    (species: string) => {
      if (activeSet === null) return true;
      return activeSet.has(species);
    },
    [activeSet],
  );

  const toggleActive = useCallback(
    async (species: string) => {
      const current = activeSet ?? new Set(BUILTIN_SPECIES);
      const next = new Set(current);
      if (next.has(species)) {
        next.delete(species);
      } else {
        next.add(species);
      }
      await persist(next);
    },
    [activeSet, persist],
  );

  const activateSpecies = useCallback(
    async (species: string) => {
      const current = activeSet ?? new Set(BUILTIN_SPECIES);
      if (current.has(species)) return;
      const next = new Set(current);
      next.add(species);
      await persist(next);
    },
    [activeSet, persist],
  );

  const deactivateSpecies = useCallback(
    async (species: string) => {
      const current = activeSet ?? new Set(BUILTIN_SPECIES);
      if (!current.has(species)) return;
      const next = new Set(current);
      next.delete(species);
      await persist(next);
    },
    [activeSet, persist],
  );

  const allSpecies = useMemo(() => {
    const customNames = customSpecies.map((s) => s.name);
    return [...BUILTIN_SPECIES, ...customNames];
  }, [customSpecies]);

  const activeSpecies = useMemo(() => {
    if (activeSet === null) return allSpecies;
    return allSpecies.filter((s) => activeSet.has(s));
  }, [allSpecies, activeSet]);

  const refresh = useCallback(async () => {
    await refreshCustom();
    await loadActiveSet();
  }, [refreshCustom, loadActiveSet]);

  return { activeSpecies, allSpecies, isActive, toggleActive, activateSpecies, deactivateSpecies, refresh };
}
