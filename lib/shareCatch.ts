// ─── Partage d'une prise ──────────────────────────────────────────────────────
// Construit le message texte de partage et déclenche la feuille de partage
// native (mobile) ou navigator.share / presse-papiers (web).
// Les coordonnées GPS ne sont incluses que si l'utilisateur l'a demandé
// explicitement — un spot de pêche, ça se protège.

import { Platform, Share } from 'react-native';

import type { SizeCategory } from '@/lib/types';

export type ShareableCatch = {
  species: string;
  lure: string | null;
  latitude: number | null;
  longitude: number | null;
  lake_name: string | null;
  temperature_c: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  weather_conditions: string | null;
  size_category: SizeCategory | null;
  weight_lbs: number | null;
  length_inches: number | null;
  notes: string | null;
  caught_at: string;
};

export type ShareMessageOptions = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  locale: string;
  fmtTemp: (celsius: number, decimals?: number) => string;
  fmtWeight: (lbs: number, decimals?: number) => string;
  fmtLength: (inches: number, decimals?: number) => string;
  includeCoords: boolean;
};

function windDegToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}

/** Ligne taille : catégorie approximative et/ou mesures réelles. */
export function formatSizeLine(
  c: Pick<ShareableCatch, 'size_category' | 'weight_lbs' | 'length_inches'>,
  opts: Pick<ShareMessageOptions, 't' | 'fmtWeight' | 'fmtLength'>,
): string | null {
  const parts: string[] = [];
  if (c.size_category) parts.push(opts.t(`size.${c.size_category}`));
  if (c.weight_lbs != null) parts.push(opts.fmtWeight(c.weight_lbs));
  if (c.length_inches != null) parts.push(opts.fmtLength(c.length_inches));
  return parts.length ? parts.join(' · ') : null;
}

/** Ligne météo : conditions, température, vent — seulement ce qui existe. */
export function formatWeatherLine(
  c: Pick<ShareableCatch, 'weather_conditions' | 'temperature_c' | 'wind_speed_kmh' | 'wind_direction_deg'>,
  opts: Pick<ShareMessageOptions, 't' | 'fmtTemp'>,
): string | null {
  const parts: string[] = [];
  if (c.weather_conditions) parts.push(c.weather_conditions);
  if (c.temperature_c != null) parts.push(opts.fmtTemp(c.temperature_c));
  if (c.wind_speed_kmh != null) {
    const dir = c.wind_direction_deg != null ? `${windDegToCompass(c.wind_direction_deg)} ` : '';
    parts.push(`${opts.t('share.wind')} ${dir}${c.wind_speed_kmh.toFixed(0)} km/h`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** Date + heure localisées de la prise. */
export function formatCaughtAt(caughtAt: string, locale: string): string {
  const d = new Date(caughtAt);
  const date = d.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Construit le message texte multi-lignes prêt à partager. */
export function buildCatchShareMessage(c: ShareableCatch, opts: ShareMessageOptions): string {
  const lines: string[] = [];

  lines.push(opts.t('share.msgTitle', { species: c.species }));

  const size = formatSizeLine(c, opts);
  if (size) lines.push(`🏆 ${size}`);

  if (c.lake_name) lines.push(`📍 ${c.lake_name}`);
  if (opts.includeCoords && c.latitude != null && c.longitude != null) {
    lines.push(`🧭 ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`);
  }

  lines.push(`📅 ${formatCaughtAt(c.caught_at, opts.locale)}`);

  if (c.lure) lines.push(`🪝 ${c.lure}`);

  const weather = formatWeatherLine(c, opts);
  if (weather) lines.push(`🌤 ${weather}`);

  if (c.notes) lines.push(`📝 ${c.notes}`);

  lines.push('');
  lines.push(opts.t('share.footer'));

  return lines.join('\n');
}

/**
 * Partage un message texte.
 * Mobile : feuille de partage native. Web : navigator.share si dispo,
 * sinon copie dans le presse-papiers (même pattern que le partage de zones).
 */
export async function shareCatchText(message: string, copiedNotice: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) {
        await nav.share({ text: message });
      } else if (nav?.clipboard) {
        await nav.clipboard.writeText(message);
        window.alert(copiedNotice);
      }
    } catch {}
    return;
  }
  try {
    await Share.share({ message });
  } catch {}
}
