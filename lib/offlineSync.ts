import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { fetchWithTimeout, isOnline } from '@/lib/net';
import { uploadMediaFile } from '@/lib/uploadMedia';

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

// ─── Persistance locale des médias (native uniquement) ───────────────────────

const OFFLINE_MEDIA_DIR = (FileSystem.documentDirectory ?? '') + 'offline_media/';

export async function persistMediaForOffline(
  media: { uri: string; type: 'photo' | 'video' }[],
): Promise<{ uri: string; type: 'photo' | 'video' }[]> {
  if (Platform.OS === 'web' || media.length === 0) return [];

  try {
    const dirInfo = await FileSystem.getInfoAsync(OFFLINE_MEDIA_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(OFFLINE_MEDIA_DIR, { intermediates: true });
    }
  } catch (e) {
    console.warn('[Offline] Impossible de créer le dossier offline_media', e);
    return [];
  }

  const persisted: { uri: string; type: 'photo' | 'video' }[] = [];
  for (const item of media) {
    try {
      const ext = item.type === 'video' ? 'mp4' : 'jpg';
      const destUri = `${OFFLINE_MEDIA_DIR}${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      await FileSystem.copyAsync({ from: item.uri, to: destUri });
      persisted.push({ uri: destUri, type: item.type });
    } catch (e) {
      console.warn('[Offline] Impossible de copier le media', item.uri, e);
    }
  }
  return persisted;
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

    const res = await fetchWithTimeout(url, {}, 8000);
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

// Verrou anti-doublons : SyncManager (retour réseau) et log-catch (montage)
// peuvent appeler trySyncOfflineCatches en même temps. Sans verrou, la même
// prise en file serait insérée deux fois dans Supabase.
let syncInProgress = false;

export async function trySyncOfflineCatches(userId: string): Promise<void> {
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!existing) return;

    const queue: OfflineQueuedCatch[] = JSON.parse(existing);
    if (!Array.isArray(queue) || queue.length === 0) return;

    // Hors-ligne → inutile de tenter (et ça peut bloquer longtemps sur Android)
    if (!(await isOnline())) return;

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

        // Timeout avec annulation réelle : si la requête est abandonnée,
        // elle n'atteint pas le serveur (pas de risque de doublon).
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        let insertedCatch: { id: string } | null = null;
        let error: unknown = null;
        try {
          const res = await supabase
            .from('catches')
            .insert(insertPayload)
            .select('id')
            .abortSignal(controller.signal)
            .single();
          insertedCatch = res.data;
          error = res.error;
        } finally {
          clearTimeout(timer);
        }

        if (error) {
          console.warn('[Offline] Erreur sync', error);
          remaining.push(item);
          continue;
        }

        // Upload des médias persistés
        if (insertedCatch && item.media && item.media.length > 0) {
          for (const mediaItem of item.media) {
            try {
              let fileExists = true;
              if (Platform.OS !== 'web') {
                const info = await FileSystem.getInfoAsync(mediaItem.uri);
                fileExists = info.exists;
              }
              if (!fileExists) continue;

              const { storagePath } = await uploadMediaFile(
                mediaItem.uri,
                userId,
                insertedCatch.id,
                mediaItem.type,
              );
              await supabase.from('catch_media').insert({
                catch_id: insertedCatch.id,
                media_type: mediaItem.type,
                storage_path: storagePath,
                uploaded: true,
              });

              if (Platform.OS !== 'web') {
                await FileSystem.deleteAsync(mediaItem.uri, { idempotent: true });
              }
            } catch (mediaErr) {
              console.warn('[Offline] Erreur upload media', mediaErr);
            }
          }
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
  } finally {
    syncInProgress = false;
  }
}
