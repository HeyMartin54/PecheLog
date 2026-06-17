import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOnline, withTimeout } from '@/lib/net';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TempUnit = 'C' | 'F';
export type WeightUnit = 'lb' | 'kg';
export type LengthUnit = 'in' | 'cm';
export type Language = 'fr' | 'en';

export type AppSettings = {
  tempUnit: TempUnit;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  language: Language;
};

export const DEFAULT_SETTINGS: AppSettings = {
  tempUnit: 'C',
  weightUnit: 'lb',
  lengthUnit: 'in',
  language: 'fr',
};

// ─── Persistance locale (source de vérité) ───────────────────────────────────

const SETTINGS_KEY = '@pechelog_settings_v1';

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[Settings] Impossible de sauvegarder les réglages', e);
  }
}

// ─── Sync Supabase (best-effort, jamais bloquant) ─────────────────────────────
// Les colonnes units_temp / units_weight / units_length existent sur profiles.
// La langue reste locale (préférence d'appareil).

export async function pushSettingsToProfile(userId: string, settings: AppSettings): Promise<void> {
  try {
    if (!(await isOnline())) return;
    const { error } = await withTimeout(
      supabase
        .from('profiles')
        .update({
          units_temp: settings.tempUnit,
          units_weight: settings.weightUnit,
          units_length: settings.lengthUnit,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId),
      8000,
      'pushSettingsToProfile',
    );
    if (error) console.warn('[Settings] push profil error:', error.message);
  } catch (e) {
    console.warn('[Settings] push profil error:', e);
  }
}

/** Récupère les unités du profil Supabase (premier lancement sur un nouvel appareil). */
export async function pullSettingsFromProfile(userId: string): Promise<Partial<AppSettings> | null> {
  try {
    if (!(await isOnline())) return null;
    const { data, error } = await withTimeout(
      supabase
        .from('profiles')
        .select('units_temp, units_weight, units_length')
        .eq('id', userId)
        .maybeSingle(),
      8000,
      'pullSettingsFromProfile',
    );
    if (error || !data) return null;
    const partial: Partial<AppSettings> = {};
    if (data.units_temp === 'C' || data.units_temp === 'F') partial.tempUnit = data.units_temp;
    if (data.units_weight === 'lb' || data.units_weight === 'kg') partial.weightUnit = data.units_weight;
    if (data.units_length === 'in' || data.units_length === 'cm') partial.lengthUnit = data.units_length;
    return partial;
  } catch {
    return null;
  }
}

// ─── Conversions ──────────────────────────────────────────────────────────────
// Le stockage reste toujours en unités canoniques : °C, lb, pouces.
// Les conversions ne servent qu'à l'affichage et à la saisie.

export const lbsToKg = (lbs: number): number => lbs * 0.45359237;
export const kgToLbs = (kg: number): number => kg / 0.45359237;
export const inchesToCm = (inches: number): number => inches * 2.54;
export const cmToInches = (cm: number): number => cm / 2.54;
export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const fToC = (f: number): number => ((f - 32) * 5) / 9;

/** Convertit un poids stocké (lb) vers l'unité d'affichage. */
export function displayWeight(lbs: number, unit: WeightUnit): number {
  return unit === 'kg' ? lbsToKg(lbs) : lbs;
}

/** Convertit un poids saisi dans l'unité d'affichage vers l'unité de stockage (lb). */
export function storeWeight(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? kgToLbs(value) : value;
}

/** Convertit une longueur stockée (pouces) vers l'unité d'affichage. */
export function displayLength(inches: number, unit: LengthUnit): number {
  return unit === 'cm' ? inchesToCm(inches) : inches;
}

/** Convertit une longueur saisie dans l'unité d'affichage vers l'unité de stockage (pouces). */
export function storeLength(value: number, unit: LengthUnit): number {
  return unit === 'cm' ? cmToInches(value) : value;
}

/** Convertit une température stockée (°C) vers l'unité d'affichage. */
export function displayTemp(celsius: number, unit: TempUnit): number {
  return unit === 'F' ? cToF(celsius) : celsius;
}

/** Convertit une température saisie dans l'unité d'affichage vers l'unité de stockage (°C). */
export function storeTemp(value: number, unit: TempUnit): number {
  return unit === 'F' ? fToC(value) : value;
}
