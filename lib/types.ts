// ─── Types partagés du domaine PêcheLog ──────────────────────────────────────
// Les types de lignes propres à un écran (sous-ensembles de colonnes) restent
// définis localement ; ici on centralise les formes utilisées par plusieurs
// fichiers (payload d'insertion, médias, catégories).

export type SizeCategory = 'small' | 'medium' | 'large' | 'trophy';

export type DepthSource = 'manual' | 'sonar' | 'bathymetric';

export type MediaType = 'photo' | 'video';

/** Média local (avant upload) — photo ou vidéo prise / choisie par l'utilisateur. */
export type MediaItem = {
  uri: string;
  type: MediaType;
};

/** Ligne de la table catch_media. */
export type CatchMedia = {
  id: string;
  media_type: MediaType;
  storage_path: string;
  thumbnail_path: string | null;
  local_uri: string | null;
  uploaded: boolean;
};

/**
 * Payload d'insertion dans la table catches.
 * `local_id` sert au suivi hors-ligne et est retiré avant l'insert.
 * Stockage canonique : °C, lb, pouces, mètres, km/h.
 */
export type CatchPayload = {
  user_id: string;
  map_id: string | null;
  trip_id: string | null;
  species: string;
  lure: string | null;
  latitude: number;
  longitude: number;
  lake_name: string | null;
  depth_meters: number | null;
  depth_source: DepthSource | null;
  temperature_c: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  speed_kmh: number | null;
  weather_conditions: string | null;
  size_category: SizeCategory | null;
  weight_lbs: number | null;
  length_inches: number | null;
  notes: string | null;
  caught_at: string;
  local_id: string | null;
};

// Ré-exports pour avoir un point d'entrée unique
export type { CachedCatch } from '@/lib/catchCache';
export type { Trip, TripLake, LastCatchSettings } from '@/lib/tripStorage';
