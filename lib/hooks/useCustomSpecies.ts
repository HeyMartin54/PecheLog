import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'pechelog_custom_species_v1';

export type CustomSpecies = {
  name: string;
  code: string;
};

export function useCustomSpecies() {
  const [customSpecies, setCustomSpecies] = useState<CustomSpecies[]>([]);

  const loadFromStorage = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      setCustomSpecies(raw ? (JSON.parse(raw) as CustomSpecies[]) : []);
    } catch {
      setCustomSpecies([]);
    }
  }, []);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const persist = useCallback(async (list: CustomSpecies[]) => {
    setCustomSpecies(list);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }, []);

  const addSpecies = useCallback(async (name: string) => {
    const trimmed = name.trim();
    const code = trimmed.slice(0, 2).toUpperCase();
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const current: CustomSpecies[] = raw ? JSON.parse(raw) : [];
    const updated = [...current, { name: trimmed, code }];
    await persist(updated);
  }, [persist]);

  const removeSpecies = useCallback(async (name: string) => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const current: CustomSpecies[] = raw ? JSON.parse(raw) : [];
    const updated = current.filter((s) => s.name !== name);
    await persist(updated);
  }, [persist]);

  const isCustom = useCallback((name: string) => {
    return customSpecies.some((s) => s.name === name);
  }, [customSpecies]);

  return { customSpecies, addSpecies, removeSpecies, isCustom, refresh: loadFromStorage };
}
