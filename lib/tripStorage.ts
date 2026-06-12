import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOnline, withTimeout } from '@/lib/net';
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Retourne l'ID utilisateur depuis la session locale (pas de requête réseau). */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

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

// ─── Voyage actif ─────────────────────────────────────────────────────────────

export async function saveActiveTrip(trip: Trip): Promise<void> {
  // Cache local immédiat (UI réactive)
  await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(trip));

  // Sync Supabase — seulement si en ligne (sinon syncLocalTripsToSupabase s'en chargera)
  try {
    if (!(await isOnline())) return;
    const userId = await getCurrentUserId();
    if (!userId) {
      console.warn('[TripStorage] saveActiveTrip: pas de session, voyage non envoyé à Supabase');
      return;
    }
    const { error } = await withTimeout(
      supabase.from('trips').upsert(tripToRow(trip, userId)),
      10000,
      'saveActiveTrip',
    );
    if (error) console.warn('[TripStorage] saveActiveTrip upsert error:', error.message);
  } catch (e) {
    console.warn('[TripStorage] saveActiveTrip sync error:', e);
  }
}

export async function loadActiveTrip(): Promise<Trip | null> {
  // Supabase en priorité — filtre explicite par user_id + RLS.
  // Hors-ligne, on saute directement au cache local (rapide, pas de blocage).
  try {
    const userId = await getCurrentUserId();
    if (userId && (await isOnline())) {
      const { data, error } = await withTimeout(
        supabase
          .from('trips')
          .select('*')
          .eq('user_id', userId)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        10000,
        'loadActiveTrip',
      );

      if (error) {
        console.warn('[TripStorage] loadActiveTrip error:', error.message);
      } else if (data) {
        const trip = rowToTrip(data as Record<string, unknown>);
        await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(trip));
        return trip;
      } else {
        // Aucun voyage actif sur Supabase. ATTENTION : un voyage créé
        // hors-ligne n'existe pas encore côté serveur — ne pas le supprimer !
        const raw = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
        if (raw) {
          const localTrip: Trip = JSON.parse(raw);
          const { data: remote } = await withTimeout(
            supabase.from('trips').select('id, ended_at').eq('id', localTrip.id).maybeSingle(),
            10000,
            'loadActiveTrip remote check',
          );
          if (remote) {
            // Le voyage existe côté serveur (terminé sur un autre appareil) → respecter le serveur
            await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
            return null;
          }
          // Créé hors-ligne, jamais envoyé → le pousser au lieu de le perdre
          const { error: upErr } = await supabase.from('trips').upsert(tripToRow(localTrip, userId));
          if (upErr) console.warn('[TripStorage] loadActiveTrip upsert local trip error:', upErr.message);
          return localTrip;
        }
        return null;
      }
    }
  } catch (e) {
    console.warn('[TripStorage] loadActiveTrip network error, fallback AsyncStorage:', e);
  }

  // Fallback hors-ligne
  const raw = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function endActiveTrip(): Promise<void> {
  const raw = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
  if (!raw) return;

  const trip: Trip = JSON.parse(raw);
  const endedAt = new Date().toISOString();
  const ended: Trip = { ...trip, endedAt };

  // Cache local
  const histRaw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
  const history: Trip[] = histRaw ? JSON.parse(histRaw) : [];
  history.unshift(ended);
  if (history.length > HISTORY_MAX) history.splice(HISTORY_MAX);
  await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(history));
  await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);

  // Sync Supabase — si hors-ligne, syncLocalTripsToSupabase poussera le
  // ended_at de l'historique local au retour du signal.
  try {
    if (!(await isOnline())) return;
    const userId = await getCurrentUserId();
    if (!userId) return;
    const { error } = await withTimeout(
      supabase
        .from('trips')
        .update({ ended_at: endedAt, updated_at: new Date().toISOString() })
        .eq('id', trip.id)
        .eq('user_id', userId),
      10000,
      'endActiveTrip',
    );
    if (error) console.warn('[TripStorage] endActiveTrip error:', error.message);
  } catch (e) {
    console.warn('[TripStorage] endActiveTrip sync error:', e);
  }
}

// ─── Historique ───────────────────────────────────────────────────────────────

export async function loadTripHistory(): Promise<Trip[]> {
  // Supabase en priorité — filtre explicite par user_id + RLS.
  // Hors-ligne, on saute directement au cache local.
  try {
    const userId = await getCurrentUserId();
    if (userId && (await isOnline())) {
      const { data, error } = await withTimeout(
        supabase
          .from('trips')
          .select('*')
          .eq('user_id', userId)
          .not('ended_at', 'is', null)
          .order('started_at', { ascending: false })
          .limit(HISTORY_MAX),
        10000,
        'loadTripHistory',
      );

      if (error) {
        console.warn('[TripStorage] loadTripHistory error:', error.message);
      } else if (data) {
        const trips = data.map((row) => rowToTrip(row as Record<string, unknown>));
        // Préserver les voyages terminés hors-ligne pas encore migrés vers
        // Supabase — sinon ils disparaîtraient du cache au retour du signal.
        const raw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
        const local: Trip[] = raw ? JSON.parse(raw) : [];
        const remoteIds = new Set(trips.map((t) => t.id));
        const localOnly = local.filter((t) => !remoteIds.has(t.id));
        const merged = [...localOnly, ...trips]
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, HISTORY_MAX);
        await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(merged));
        return merged;
      }
    }
  } catch (e) {
    console.warn('[TripStorage] loadTripHistory network error, fallback AsyncStorage:', e);
  }

  // Fallback hors-ligne
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
    const userId = await getCurrentUserId();
    if (!userId) return;
    const { error } = await supabase
      .from('trips')
      .delete()
      .eq('id', tripId)
      .eq('user_id', userId);
    if (error) console.warn('[TripStorage] deleteTripFromHistory error:', error.message);
  } catch (e) {
    console.warn('[TripStorage] deleteTripFromHistory sync error:', e);
  }
}

// ─── Migration : envoyer les voyages locaux vers Supabase ────────────────────
// À appeler au démarrage pour récupérer les voyages créés avant l'activation du sync.

export async function syncLocalTripsToSupabase(): Promise<void> {
  try {
    if (!(await isOnline())) return;
    const userId = await getCurrentUserId();
    if (!userId) return;

    // Voyage actif local
    const activeRaw = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
    if (activeRaw) {
      const localActive: Trip = JSON.parse(activeRaw);
      // Vérifie si déjà dans Supabase
      const { data } = await supabase
        .from('trips')
        .select('id')
        .eq('id', localActive.id)
        .maybeSingle();
      if (!data) {
        const { error } = await supabase.from('trips').upsert(tripToRow(localActive, userId));
        if (error) console.warn('[TripStorage] syncLocal active trip error:', error.message);
      }
    }

    // Historique local
    const histRaw = await AsyncStorage.getItem(TRIP_HISTORY_KEY);
    if (!histRaw) return;
    const localHistory: Trip[] = JSON.parse(histRaw);
    if (localHistory.length === 0) return;

    // Upsert TOUS les voyages de l'historique local (pas seulement les
    // manquants) : un voyage terminé hors-ligne existe déjà côté serveur
    // mais sans ended_at — l'upsert pousse le ended_at local et évite
    // qu'il ressuscite comme voyage actif au retour du signal.
    const rows = localHistory.map((t) => tripToRow(t, userId));
    const { error } = await supabase.from('trips').upsert(rows);
    if (error) console.warn('[TripStorage] syncLocal history error:', error.message);
    else console.log(`[TripStorage] ${localHistory.length} voyage(s) local(aux) synchronisés vers Supabase`);
  } catch (e) {
    console.warn('[TripStorage] syncLocalTripsToSupabase error:', e);
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
