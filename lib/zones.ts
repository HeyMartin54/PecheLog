import AsyncStorage from '@react-native-async-storage/async-storage';

import { isOnline, withTimeout } from '@/lib/net';
import { supabase } from '@/lib/supabase';
import type { CachedCatch } from '@/lib/catchCache';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ZonePoint = { latitude: number; longitude: number };

export type SharedZone = {
  id: string;
  owner_id: string;
  name: string;
  polygon: ZonePoint[];
  invite_code: string;
  created_at: string;
};

// ─── Géométrie ────────────────────────────────────────────────────────────────

/** Test point-dans-polygone (ray casting) — même algorithme que la fonction SQL. */
export function pointInPolygon(point: ZonePoint, polygon: ZonePoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    if (
      yi > point.latitude !== yj > point.latitude &&
      point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

/**
 * Génère un polygone circulaire (approx. par segments) autour d'un centre.
 * Utilisé par le mode « Zone rapide » : un cercle ajustable autour d'un lac/secteur.
 */
export function makeCirclePolygon(
  center: ZonePoint,
  radiusMeters: number,
  segments = 24,
): ZonePoint[] {
  const points: ZonePoint[] = [];
  const dLat = radiusMeters / 111320; // ~mètres par degré de latitude
  const cosLat = Math.cos((center.latitude * Math.PI) / 180);
  const dLng = radiusMeters / (111320 * (Math.abs(cosLat) < 0.01 ? 0.01 : cosLat));
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    points.push({
      latitude: center.latitude + dLat * Math.sin(angle),
      longitude: center.longitude + dLng * Math.cos(angle),
    });
  }
  return points;
}

/** Paliers de rayon (m) pour le mode « Zone rapide ». */
export const QUICK_ZONE_RADII = [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];

/** Index du rayon par défaut (500 m) — indépendant de l'ordre des paliers. */
export const DEFAULT_QUICK_ZONE_RADIUS_IDX = Math.max(0, QUICK_ZONE_RADII.indexOf(500));

/** Centre de secours (Québec) quand la vue de la carte est encore inconnue. */
export const DEFAULT_MAP_CENTER: ZonePoint = { latitude: 47.5, longitude: -71.5 };

/** Formatte un rayon en m/km pour l'affichage (métrique dans les deux langues). */
export function formatRadius(radiusMeters: number): string {
  if (radiusMeters < 1000) return `${radiusMeters} m`;
  const km = radiusMeters / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

// ─── Cache local (lecture hors-ligne) ────────────────────────────────────────

const zonesCacheKey = (userId: string) => `@pechelog_zones_${userId}`;
const zoneCatchesCacheKey = (zoneId: string) => `@pechelog_zone_catches_${zoneId}`;

async function saveZonesCache(userId: string, zones: SharedZone[]): Promise<void> {
  try {
    await AsyncStorage.setItem(zonesCacheKey(userId), JSON.stringify(zones));
  } catch {}
}

async function loadZonesCache(userId: string): Promise<SharedZone[] | null> {
  try {
    const raw = await AsyncStorage.getItem(zonesCacheKey(userId));
    return raw ? (JSON.parse(raw) as SharedZone[]) : null;
  } catch {
    return null;
  }
}

// ─── API zones ────────────────────────────────────────────────────────────────

/**
 * Charge toutes les zones visibles (les miennes + celles reçues — le RLS fait le tri).
 * Hors-ligne : retombe sur le cache local.
 */
export async function loadZones(userId: string): Promise<SharedZone[]> {
  try {
    if (await isOnline()) {
      const { data, error } = await withTimeout(
        supabase.from('shared_zones').select('*').order('created_at', { ascending: false }),
        10000,
        'loadZones',
      );
      if (!error && data) {
        const zones = data as SharedZone[];
        await saveZonesCache(userId, zones);
        return zones;
      }
      if (error) console.warn('[Zones] loadZones error:', error.message);
    }
  } catch (e) {
    console.warn('[Zones] loadZones network error:', e);
  }
  return (await loadZonesCache(userId)) ?? [];
}

export async function createZone(
  userId: string,
  name: string,
  polygon: ZonePoint[],
): Promise<SharedZone | null> {
  try {
    if (!(await isOnline())) return null;
    const { data, error } = await withTimeout(
      supabase
        .from('shared_zones')
        .insert({ owner_id: userId, name: name.trim(), polygon })
        .select('*')
        .single(),
      10000,
      'createZone',
    );
    if (error) {
      console.warn('[Zones] createZone error:', error.message);
      return null;
    }
    return data as SharedZone;
  } catch (e) {
    console.warn('[Zones] createZone network error:', e);
    return null;
  }
}

export async function deleteZone(zoneId: string): Promise<boolean> {
  try {
    if (!(await isOnline())) return false;
    const { error } = await withTimeout(
      supabase.from('shared_zones').delete().eq('id', zoneId),
      10000,
      'deleteZone',
    );
    if (error) console.warn('[Zones] deleteZone error:', error.message);
    return !error;
  } catch (e) {
    console.warn('[Zones] deleteZone network error:', e);
    return false;
  }
}

/** Quitter une zone reçue (supprime mon adhésion, pas la zone). */
export async function leaveZone(zoneId: string, userId: string): Promise<boolean> {
  try {
    if (!(await isOnline())) return false;
    const { error } = await withTimeout(
      supabase.from('zone_shares').delete().eq('zone_id', zoneId).eq('shared_with', userId),
      10000,
      'leaveZone',
    );
    if (error) console.warn('[Zones] leaveZone error:', error.message);
    return !error;
  } catch (e) {
    console.warn('[Zones] leaveZone network error:', e);
    return false;
  }
}

export type RedeemResult =
  | { ok: true; zoneId: string; zoneName: string }
  | { ok: false; reason: 'invalid_code' | 'own_zone' | 'offline' | 'error' };

/** Rejoindre une zone avec un code d'invitation (RPC SECURITY DEFINER). */
export async function redeemZoneCode(code: string): Promise<RedeemResult> {
  try {
    if (!(await isOnline())) return { ok: false, reason: 'offline' };
    const { data, error } = await withTimeout(
      supabase.rpc('redeem_zone_code', { p_code: code.trim().toLowerCase() }),
      10000,
      'redeemZoneCode',
    );
    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('invalid_code')) return { ok: false, reason: 'invalid_code' };
      if (msg.includes('own_zone')) return { ok: false, reason: 'own_zone' };
      console.warn('[Zones] redeemZoneCode error:', msg);
      return { ok: false, reason: 'error' };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, reason: 'error' };
    return { ok: true, zoneId: row.zone_id, zoneName: row.zone_name };
  } catch (e) {
    console.warn('[Zones] redeemZoneCode network error:', e);
    return { ok: false, reason: 'error' };
  }
}

// ─── Prises d'une zone partagée ───────────────────────────────────────────────

/**
 * Prises du propriétaire à l'intérieur de la zone (RPC get_zone_catches).
 * Hors-ligne : retombe sur le dernier résultat mis en cache.
 */
export async function fetchZoneCatches(zoneId: string): Promise<CachedCatch[]> {
  try {
    if (await isOnline()) {
      const { data, error } = await withTimeout(
        supabase.rpc('get_zone_catches', { p_zone_id: zoneId }),
        15000,
        'fetchZoneCatches',
      );
      if (!error && data) {
        const catches = data as CachedCatch[];
        try {
          await AsyncStorage.setItem(zoneCatchesCacheKey(zoneId), JSON.stringify(catches));
        } catch {}
        return catches;
      }
      if (error) console.warn('[Zones] fetchZoneCatches error:', error.message);
    }
  } catch (e) {
    console.warn('[Zones] fetchZoneCatches network error:', e);
  }
  try {
    const raw = await AsyncStorage.getItem(zoneCatchesCacheKey(zoneId));
    return raw ? (JSON.parse(raw) as CachedCatch[]) : [];
  } catch {
    return [];
  }
}
