import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

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

// ─── Clés AsyncStorage (cache local) ─────────────────────────────────────────

const ACTIVE_TRIP_KEY = '@pechelog_active_trip';
const TRIP_HISTORY_KEY = '@pechelog_trip_history';
const LAST_CATCH_KEY = '@pechelog_last_catch';
const FREQUENT_COMPANIONS_KEY = '@pechelog_frequent_companions';
const PREFILL_TRIP_KEY = '@pechelog_prefill_trip';
const HISTORY_MAX = 20;

// ─── Conversion Supabase row → Trip ──────────────────────────────────────────

function rowToTrip(row: Record<string, unknown>): Trip {
  return {
    id: row.id as string,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string | null) ?? undefined,
    lakes: (row.lakes as TripLake[]) ?? [],
    companions: (row.companions as string[]) ?? [],
    luresSelected: (row.lures_selected as string[]) ?? [],
    notes: (row.notes as string | null) ?? undefined,
  };
}

function tripToRow(trip: Trip, userId: string) {
  return {
    id: trip.id,
    user_id: userId,
    started_at: trip.startedAt,
    ended_at: trip.endedAt ?? null,
    lakes: trip.lakes,
    companions: trip.companions,
    lures_selected: trip.luresSelected,
    notes: trip.notes ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Voyage actif ─────────────────────────────────────────────────────────────

export async function saveActiveTrip(trip: Trip): Promise<void> {
  // Cache local immédiat
  await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(trip));

  // Sync Supabase en arrière-plan
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;
    await supabase.from('trips').upsert(tripToRow(trip, userId));
  } catch (e) {
    console.warn('[TripStorage] saveActiveTrip sync error:', e);
  }
}

export async function loadActiveTrip(): Promise<Trip | null> {
  // Supabase en priorité (cross-device)
  try {
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const trip = rowToTrip(data as Record<string, unknown>);
      await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(trip));
      return trip;
    }
  } catch {
    // réseau indisponible → fallback AsyncStorage
  }

  const raw = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function endActiveTrip(): Promise<void> {
  const raw = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
  if (!raw) return;

  const trip: Trip = JSON.parse(raw);
  const endedAt = new Date().toISOString();
  const ended: Trip = { ...trip, endedAt };

  // Mise à jour du cache local
  const histRaw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
  const history: Trip[] = histRaw ? JSON.parse(histRaw) : [];
  history.unshift(ended);
  if (history.length > HISTORY_MAX) history.splice(HISTORY_MAX);
  await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(history));
  await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);

  // Sync Supabase
  try {
    await supabase
      .from('trips')
      .update({ ended_at: endedAt, updated_at: new Date().toISOString() })
      .eq('id', trip.id);
  } catch (e) {
    console.warn('[TripStorage] endActiveTrip sync error:', e);
  }
}

// ─── Historique ───────────────────────────────────────────────────────────────

export async function loadTripHistory(): Promise<Trip[]> {
  // Supabase en priorité
  try {
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(HISTORY_MAX);

    if (!error && data) {
      const trips = data.map((row) => rowToTrip(row as Record<string, unknown>));
      await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(trips));
      return trips;
    }
  } catch {
    // réseau indisponible → fallback AsyncStorage
  }

  const raw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function deleteTripFromHistory(tripId: string): Promise<void> {
  // Cache local
  const raw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
  if (raw) {
    const history: Trip[] = JSON.parse(raw);
    const filtered = history.filter((t) => t.id !== tripId);
    await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(filtered));
  }

  // Supabase
  try {
    await supabase.from('trips').delete().eq('id', tripId);
  } catch (e) {
    console.warn('[TripStorage] deleteTripFromHistory sync error:', e);
  }
}

// ─── Pré-remplissage (Relancer ce voyage) — local uniquement ─────────────────

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

// ─── Derniers réglages de prise — local uniquement ───────────────────────────

export async function saveLastCatchSettings(settings: LastCatchSettings): Promise<void> {
  await AsyncStorage.setItem(LAST_CATCH_KEY, JSON.stringify(settings));
}

export async function loadLastCatchSettings(): Promise<LastCatchSettings | null> {
  const raw = await AsyncStorage.getItem(LAST_CATCH_KEY);
  return raw ? JSON.parse(raw) : null;
}

// ─── Compagnons fréquents — local uniquement ─────────────────────────────────

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
