import AsyncStorage from '@react-native-async-storage/async-storage';

// Type complet — couvre tous les champs utilisés par tous les écrans
export type CachedCatch = {
  id: string;
  species: string;
  latitude: number | null;
  longitude: number | null;
  lake_name: string | null;
  lure: string | null;
  weight_lbs: number | null;
  length_inches: number | null;
  depth_meters: number | null;
  depth_source: string | null;
  size_category: string | null;
  weather_conditions: string | null;
  temperature_c: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  speed_kmh: number | null;
  notes: string | null;
  caught_at: string;
};

// Champs à sélectionner dans Supabase pour populer un cache complet
export const CATCH_SELECT_ALL =
  'id, species, latitude, longitude, lake_name, lure, weight_lbs, length_inches, ' +
  'depth_meters, depth_source, size_category, weather_conditions, temperature_c, ' +
  'wind_speed_kmh, wind_direction_deg, speed_kmh, notes, caught_at';

const cacheKey  = (userId: string) => `catches_cache_${userId}`;
const metaKey   = (userId: string) => `catches_cache_meta_${userId}`;

export async function saveCatchesCache(userId: string, catches: CachedCatch[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(catches));
    await AsyncStorage.setItem(metaKey(userId), JSON.stringify({ savedAt: Date.now() }));
  } catch (e) {
    console.warn('[CatchCache] Erreur sauvegarde', e);
  }
}

export async function loadCatchesCache(userId: string): Promise<CachedCatch[] | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    return raw ? (JSON.parse(raw) as CachedCatch[]) : null;
  } catch (e) {
    console.warn('[CatchCache] Erreur lecture', e);
    return null;
  }
}

export async function getCacheDate(userId: string): Promise<Date | null> {
  try {
    const raw = await AsyncStorage.getItem(metaKey(userId));
    if (!raw) return null;
    const meta = JSON.parse(raw) as { savedAt: number };
    return new Date(meta.savedAt);
  } catch {
    return null;
  }
}
