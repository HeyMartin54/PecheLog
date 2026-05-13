import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TripLake = {
  name: string;
  targetSpecies: string[];
};

export type Trip = {
  id: string;
  startedAt: string;
  endedAt?: string;
  lakes: TripLake[];
  companions: string[];
  luresSelected: string[];
  notes?: string;
};

export type LastCatchSettings = {
  species?: string;
  lure?: string;
  sizeCategory?: 'small' | 'medium' | 'large' | 'trophy';
};

// ─── Clés AsyncStorage ────────────────────────────────────────────────────────

const ACTIVE_TRIP_KEY = '@pechelog_active_trip';
const TRIP_HISTORY_KEY = '@pechelog_trip_history';
const LAST_CATCH_KEY = '@pechelog_last_catch';
const FREQUENT_COMPANIONS_KEY = '@pechelog_frequent_companions';
const PREFILL_TRIP_KEY = '@pechelog_prefill_trip';
const HISTORY_MAX = 20;

// ─── Voyage actif ─────────────────────────────────────────────────────────────

export async function saveActiveTrip(trip: Trip): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(trip));
}

export async function loadActiveTrip(): Promise<Trip | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function endActiveTrip(): Promise<void> {
  const raw = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
  if (!raw) return;

  const trip: Trip = JSON.parse(raw);
  const ended: Trip = { ...trip, endedAt: new Date().toISOString() };

  const histRaw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
  const history: Trip[] = histRaw ? JSON.parse(histRaw) : [];
  history.unshift(ended);
  if (history.length > HISTORY_MAX) history.splice(HISTORY_MAX);

  await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(history));
  await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
}

// ─── Historique ───────────────────────────────────────────────────────────────

export async function loadTripHistory(): Promise<Trip[]> {
  const raw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
}

// ─── Pré-remplissage (Relancer ce voyage) ────────────────────────────────────

export async function savePrefillTrip(trip: Trip): Promise<void> {
  await AsyncStorage.setItem(PREFILL_TRIP_KEY, JSON.stringify(trip));
}

export async function loadPrefillTrip(): Promise<Trip | null> {
  const raw = await AsyncStorage.getItem(PREFILL_TRIP_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearPrefillTrip(): Promise<void> {
  await AsyncStorage.removeItem(PREFILL_TRIP_KEY);
}

// ─── Derniers réglages de prise ───────────────────────────────────────────────

export async function saveLastCatchSettings(settings: LastCatchSettings): Promise<void> {
  await AsyncStorage.setItem(LAST_CATCH_KEY, JSON.stringify(settings));
}

export async function loadLastCatchSettings(): Promise<LastCatchSettings | null> {
  const raw = await AsyncStorage.getItem(LAST_CATCH_KEY);
  return raw ? JSON.parse(raw) : null;
}

// ─── Compagnons fréquents ─────────────────────────────────────────────────────

export async function addFrequentCompanions(names: string[]): Promise<void> {
  const raw = await AsyncStorage.getItem(FREQUENT_COMPANIONS_KEY);
  const existing: string[] = raw ? JSON.parse(raw) : [];
  for (const name of names) {
    if (name.trim() && !existing.includes(name.trim())) {
      existing.unshift(name.trim());
    }
  }
  if (existing.length > 30) existing.splice(30);
  await AsyncStorage.setItem(FREQUENT_COMPANIONS_KEY, JSON.stringify(existing));
}

export async function loadFrequentCompanions(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(FREQUENT_COMPANIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}
