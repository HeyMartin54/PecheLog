import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

// ─── Clé de la file d'attente ─────────────────────────────────────────────────

export const OFFLINE_QUEUE_KEY = 'offline_catches_queue_v1';

// ─── Types ────────────────────────────────────────────────────────────────────

type CatchPayload = {
  user_id: string;
  map_id: string | null;
  trip_id: string | null;
  species: string;
  lure: string | null;
  latitude: number;
  longitude: number;
  lake_name: string | null;
  depth_meters: number | null;
  depth_source: 'manual' | 'sonar' | 'bathymetric' | null;
  temperature_c: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  speed_kmh: number | null;
  weather_conditions: string | null;
  size_category: string | null;
  weight_lbs: number | null;
  length_inches: number | null;
  notes: string | null;
  caught_at: string;
  local_id: string | null;
};

export type OfflineQueuedCatch = {
  payload: CatchPayload;
  media: { uri: string; type: 'photo' | 'video' }[];
};

// ─── File d'attente ───────────────────────────────────────────────────────────

export async function enqueueOfflineCatch(item: OfflineQueuedCatch): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const parsed: OfflineQueuedCatch[] = existing ? JSON.parse(existing) : [];
    parsed.push(item);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(parsed));
  } catch (error) {
    console.warn("[Offline] Impossible d'enregistrer la prise hors-ligne", error);
  }
}

export async function getOfflineQueueCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return 0;
    const queue: OfflineQueuedCatch[] = JSON.parse(raw);
    return Array.isArray(queue) ? queue.length : 0;
  } catch {
    return 0;
  }
}

// ─── Météo historique (pour enrichir les prises hors-ligne à la sync) ─────────

function wmoCodeToCondition(code: number): string {
  if (code === 0) return 'Ensoleillé';
  if (code === 1) return 'Peu nuageux';
  if (code === 2) return 'Partiellement nuageux';
  if (code === 3) return 'Nuageux';
  if (code === 45 || code === 48) return 'Brume';
  if (code >= 51 && code <= 55) return 'Bruine';
  if (code >= 61 && code <= 65) return 'Pluie';
  if (code >= 71 && code <= 75) return 'Neige';
  if (code >= 80 && code <= 82) return 'Averses';
  if (code >= 95) return 'Orage';
  return '—';
}

async function fetchWeatherAtTime(
  latitude: number,
  longitude: number,
  isoDateTime: string,
): Promise<{ tempC: number | null; windKmh: number | null; windDeg: number | null; conditions: string | null } | null> {
  try {
    const catchDate = new Date(isoDateTime);
    const dateStr = catchDate.toISOString().split('T')[0];
    const daysDiff = Math.floor((Date.now() - catchDate.getTime()) / (1000 * 60 * 60 * 24));

    const params = 'hourly=temperature_2m,windspeed_10m,winddirection_10m,weathercode&windspeed_unit=kmh&timezone=auto';
    const coords = `latitude=${latitude}&longitude=${longitude}`;

    const url =
      daysDiff <= 16
        ? `https://api.open-meteo.com/v1/forecast?${coords}&past_days=${Math.min(daysDiff + 1, 16)}&forecast_days=1&${params}`
        : `https://archive-api.open-meteo.com/v1/archive?${coords}&start_date=${dateStr}&end_date=${dateStr}&${params}`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const times: string[] = data?.hourly?.time ?? [];
    if (times.length === 0) return null;

    const catchTs = catchDate.getTime();
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(new Date(times[i]).getTime() - catchTs);
      if (diff < minDiff) { minDiff = diff; closestIdx = i; }
    }

    return {
      tempC:       data?.hourly?.temperature_2m?.[closestIdx] ?? null,
      windKmh:     data?.hourly?.windspeed_10m?.[closestIdx] ?? null,
      windDeg:     data?.hourly?.winddirection_10m?.[closestIdx] ?? null,
      conditions:  wmoCodeToCondition(data?.hourly?.weathercode?.[closestIdx] ?? -1),
    };
  } catch {
    return null;
  }
}

// ─── Synchronisation ─────────────────────────────────────────────────────────

export async function trySyncOfflineCatches(userId: string): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!existing) return;

    const queue: OfflineQueuedCatch[] = JSON.parse(existing);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining: OfflineQueuedCatch[] = [];

    for (const item of queue) {
      try {
        if (item.payload.user_id !== userId) {
          remaining.push(item);
          continue;
        }

        let payload = item.payload;

        // Enrichir avec la météo si manquante
        const weatherMissing =
          payload.weather_conditions == null &&
          payload.wind_speed_kmh == null &&
          payload.temperature_c == null;

        if (weatherMissing) {
          const weather = await fetchWeatherAtTime(payload.latitude, payload.longitude, payload.caught_at);
          if (weather) {
            payload = {
              ...payload,
              temperature_c: weather.tempC,
              wind_speed_kmh: weather.windKmh,
              wind_direction_deg: weather.windDeg,
              weather_conditions: weather.conditions,
            };
          }
        }

        // Retirer local_id avant l'insert
        const { local_id: _localId, ...insertPayload } = payload;

        const { error } = await supabase.from('catches').insert(insertPayload);
        if (error) {
          console.warn('[Offline] Erreur sync', error);
          remaining.push(item);
        }
      } catch (err) {
        console.warn('[Offline] Erreur inattendue sync', err);
        remaining.push(item);
      }
    }

    if (remaining.length === 0) {
      await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
    } else {
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    }

    console.log(`[Offline] Sync terminée — ${queue.length - remaining.length} prises envoyées, ${remaining.length} restantes`);
  } catch (error) {
    console.warn('[Offline] Impossible de synchroniser', error);
  }
}
