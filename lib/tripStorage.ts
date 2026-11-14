import AsyncStorage from '@react-native-async-storage/async-storage';
import { mayReachNetwork, withTimeout } from '@/lib/net';
import { getSessionUserId, supabase } from '@/lib/supabase';

// ─── Voyages : local d'abord, serveur en arrière-plan ────────────────────────
//
// L'état des voyages vit dans AsyncStorage et se lit INSTANTANÉMENT, avec ou
// sans réseau. Toute modification (démarrer, modifier, terminer, supprimer) est
// écrite localement, marquée « à pousser », puis envoyée à Supabase dès que
// possible (ici en arrière-plan, et à chaque passage du moteur de synchro).
//
// Lire le voyage actif ne fait JAMAIS de requête réseau : le formulaire de
// prise s'en sert pour étiqueter la prise et ne doit pas attendre.

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

// ─── Clés AsyncStorage ───────────────────────────────────────────────────────

const ACTIVE_TRIP_KEY = '@pechelog_active_trip';
const TRIP_HISTORY_KEY = '@pechelog_trip_history';
const LAST_CATCH_KEY = '@pechelog_last_catch';
const FREQUENT_COMPANIONS_KEY = '@pechelog_frequent_companions';
const PREFILL_TRIP_KEY = '@pechelog_prefill_trip';
/** '1' (ou absent) = des changements locaux restent à pousser ; '0' = à jour. */
const TRIPS_DIRTY_KEY = '@pechelog_trips_dirty';
/** IDs de voyages supprimés localement, à supprimer aussi sur le serveur. */
const TRIP_DELETES_KEY = '@pechelog_trip_deletes';
const HISTORY_MAX = 20;
const REQUEST_TIMEOUT_MS = 10_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Génère un identifiant de voyage — format unique partagé par tous les écrans. */
export function generateTripId(): string {
  return `trip_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
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

function sortHistory(list: Trip[]): Trip[] {
  return [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, HISTORY_MAX);
}

async function markDirty(): Promise<void> {
  try { await AsyncStorage.setItem(TRIPS_DIRTY_KEY, '1'); } catch { /* rien */ }
}

/** Pousse les changements locaux sans faire attendre l'interface. */
function pushInBackground(): void {
  syncLocalTripsToSupabase().catch((e) => console.warn('[TripStorage] push arrière-plan:', e));
}

// ─── Lecture locale (instantanée, aucun réseau) ──────────────────────────────

export async function loadActiveTrip(): Promise<Trip | null> {
  return readJson<Trip | null>(ACTIVE_TRIP_KEY, null);
}

export async function loadTripHistory(): Promise<Trip[]> {
  return readJson<Trip[]>(TRIP_HISTORY_KEY, []);
}

// ─── Écritures (locales, puis poussées en arrière-plan) ──────────────────────

export async function saveActiveTrip(trip: Trip): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(trip));
  await markDirty();
  pushInBackground();
}

export async function endActiveTrip(): Promise<void> {
  const trip = await loadActiveTrip();
  if (!trip) return;

  const ended: Trip = { ...trip, endedAt: new Date().toISOString() };
  const history = (await loadTripHistory()).filter((t) => t.id !== trip.id);
  history.unshift(ended);
  await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(sortHistory(history)));
  await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
  await markDirty();
  pushInBackground();
}

export async function deleteTripFromHistory(tripId: string): Promise<void> {
  const history = await loadTripHistory();
  await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(history.filter((t) => t.id !== tripId)));

  // La suppression est mémorisée : sans réseau, elle sera rejouée plus tard
  // (sinon le voyage réapparaîtrait à la prochaine lecture du serveur).
  const deletes = await readJson<string[]>(TRIP_DELETES_KEY, []);
  if (!deletes.includes(tripId)) deletes.push(tripId);
  await AsyncStorage.setItem(TRIP_DELETES_KEY, JSON.stringify(deletes));
  await markDirty();
  pushInBackground();
}

// ─── Synchronisation avec Supabase ───────────────────────────────────────────

type PushOutcome = 'clean' | 'dirty' | 'failed';

let pushing: Promise<boolean> | null = null;

async function doPush(): Promise<PushOutcome> {
  const dirtyFlag = await AsyncStorage.getItem(TRIPS_DIRTY_KEY);
  if (dirtyFlag === '0') return 'clean';
  if (!(await mayReachNetwork())) return 'failed';
  const userId = await getSessionUserId(REQUEST_TIMEOUT_MS);
  if (!userId) return 'failed';

  // Lecture APRÈS les attentes réseau : c'est l'état local le plus récent.
  const [active, history, deletes] = await Promise.all([
    loadActiveTrip(),
    loadTripHistory(),
    readJson<string[]>(TRIP_DELETES_KEY, []),
  ]);
  const snapshot = JSON.stringify([active, history, deletes]);

  // 1) Suppressions en attente
  if (deletes.length > 0) {
    const { error } = await withTimeout(
      supabase.from('trips').delete().in('id', deletes).eq('user_id', userId),
      REQUEST_TIMEOUT_MS,
      'trips delete',
    );
    if (error) {
      console.warn('[TripStorage] suppression distante:', error.message);
      return 'failed';
    }
  }

  // 2) Voyage actif. Indicateur absent = installation antérieure au suivi des
  //    changements : on ne sait pas si le voyage actif local est plus récent que
  //    le serveur (il a pu être terminé sur un autre appareil). On ne l'envoie
  //    donc que s'il n'existe pas encore côté serveur.
  let pushActive = active != null;
  if (active && dirtyFlag == null) {
    const { data, error } = await withTimeout(
      supabase.from('trips').select('id').eq('id', active.id).maybeSingle(),
      REQUEST_TIMEOUT_MS,
      'trips check',
    );
    if (error) {
      console.warn('[TripStorage] vérification du voyage actif:', error.message);
      return 'failed';
    }
    if (data) pushActive = false;
  }

  // 3) Envoi (upsert : pousse aussi les ended_at posés hors-ligne)
  const rows = [...(active && pushActive ? [active] : []), ...history].map((t) => tripToRow(t, userId));
  if (rows.length > 0) {
    const { error } = await withTimeout(supabase.from('trips').upsert(rows), REQUEST_TIMEOUT_MS, 'trips upsert');
    if (error) {
      console.warn('[TripStorage] envoi des voyages:', error.message);
      return 'failed';
    }
  }

  // Un changement local survenu PENDANT l'envoi n'a pas été poussé : on repasse.
  const [activeNow, historyNow, deletesNow] = await Promise.all([
    loadActiveTrip(),
    loadTripHistory(),
    readJson<string[]>(TRIP_DELETES_KEY, []),
  ]);
  if (JSON.stringify([activeNow, historyNow, deletesNow]) !== snapshot) return 'dirty';

  await AsyncStorage.removeItem(TRIP_DELETES_KEY);
  await AsyncStorage.setItem(TRIPS_DIRTY_KEY, '0');
  return 'clean';
}

async function pushUntilClean(): Promise<boolean> {
  for (let pass = 0; pass < 3; pass++) {
    const outcome = await doPush();
    if (outcome === 'clean') return true;
    if (outcome === 'failed') return false;
  }
  return false;
}

/**
 * Envoie à Supabase les voyages créés / modifiés / terminés / supprimés
 * localement. Sans effet s'il n'y a rien à pousser. Retourne true si le serveur
 * est à jour.
 */
export function syncLocalTripsToSupabase(): Promise<boolean> {
  if (pushing) return pushing;
  const promise = pushUntilClean()
    .catch((e) => {
      console.warn('[TripStorage] syncLocalTripsToSupabase error:', e);
      return false;
    })
    .finally(() => {
      if (pushing === promise) pushing = null;
    });
  pushing = promise;
  return promise;
}

/**
 * Réconcilie l'état local avec le serveur : pousse d'abord les changements
 * locaux, puis récupère ce qui vient d'un autre appareil. Retourne le nouvel
 * état local, ou null si le serveur n'a pas pu être joint (l'état local reste
 * alors inchangé et valide).
 */
export async function refreshTripsFromServer(): Promise<{ active: Trip | null; history: Trip[] } | null> {
  try {
    if (!(await mayReachNetwork())) return null;

    // Pousser AVANT de lire : sinon l'état serveur périmé écraserait un voyage
    // créé ou terminé hors-ligne.
    const pushed = await syncLocalTripsToSupabase();
    if (!pushed) return null;

    const userId = await getSessionUserId(REQUEST_TIMEOUT_MS);
    if (!userId) return null;

    const [activeRes, historyRes] = await Promise.all([
      withTimeout(
        supabase
          .from('trips')
          .select('*')
          .eq('user_id', userId)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        REQUEST_TIMEOUT_MS,
        'trips active',
      ),
      withTimeout(
        supabase
          .from('trips')
          .select('*')
          .eq('user_id', userId)
          .not('ended_at', 'is', null)
          .order('started_at', { ascending: false })
          .limit(HISTORY_MAX),
        REQUEST_TIMEOUT_MS,
        'trips history',
      ),
    ]);
    if (activeRes.error || historyRes.error) {
      console.warn('[TripStorage] lecture distante:', activeRes.error?.message ?? historyRes.error?.message);
      return null;
    }

    // Un changement local est survenu pendant la lecture → il prime ; la
    // prochaine réconciliation le prendra en compte.
    if ((await AsyncStorage.getItem(TRIPS_DIRTY_KEY)) !== '0') {
      return { active: await loadActiveTrip(), history: await loadTripHistory() };
    }

    const history = sortHistory(
      ((historyRes.data ?? []) as Record<string, unknown>[]).map(rowToTrip),
    );
    const active = activeRes.data ? rowToTrip(activeRes.data as Record<string, unknown>) : null;

    await AsyncStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(history));
    if (active) await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(active));
    else await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);

    return { active, history };
  } catch (e) {
    console.warn('[TripStorage] refreshTripsFromServer error:', e);
    return null;
  }
}

// ─── Pré-remplissage (Relancer ce voyage) — local uniquement ─────────────────

export async function savePrefillTrip(trip: Trip): Promise<void> {
  await AsyncStorage.setItem(PREFILL_TRIP_KEY, JSON.stringify(trip));
}

export async function loadPrefillTrip(): Promise<Trip | null> {
  return readJson<Trip | null>(PREFILL_TRIP_KEY, null);
}

export async function clearPrefillTrip(): Promise<void> {
  await AsyncStorage.removeItem(PREFILL_TRIP_KEY);
}

// ─── Derniers réglages de prise — local uniquement ───────────────────────────

export async function saveLastCatchSettings(settings: LastCatchSettings): Promise<void> {
  await AsyncStorage.setItem(LAST_CATCH_KEY, JSON.stringify(settings));
}

export async function loadLastCatchSettings(): Promise<LastCatchSettings | null> {
  return readJson<LastCatchSettings | null>(LAST_CATCH_KEY, null);
}

// ─── Compagnons fréquents — local uniquement ─────────────────────────────────

export async function addFrequentCompanions(names: string[]): Promise<void> {
  const existing = await readJson<string[]>(FREQUENT_COMPANIONS_KEY, []);
  for (const name of names) {
    if (name.trim() && !existing.includes(name.trim())) {
      existing.unshift(name.trim());
    }
  }
  if (existing.length > 30) existing.splice(30);
  await AsyncStorage.setItem(FREQUENT_COMPANIONS_KEY, JSON.stringify(existing));
}

export async function loadFrequentCompanions(): Promise<string[]> {
  return readJson<string[]>(FREQUENT_COMPANIONS_KEY, []);
}
