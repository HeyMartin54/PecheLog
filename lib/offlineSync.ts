import { CATCH_SELECT_ALL, type CachedCatch } from '@/lib/catchCache';
import { applyServerCatch } from '@/lib/catchStore';
import { fetchWithTimeout, isNetworkError, mayReachNetwork } from '@/lib/net';
import {
  deleteLocalMedia,
  getQueue,
  getQueueItem,
  localMediaExists,
  queueItemToCatch,
  removeQueueItem,
  resolveMediaUri,
  summarizeQueue,
  updateQueueItem,
  type QueueItem,
} from '@/lib/offlineQueue';
import { SESSION_MISSING_MESSAGE, supabase } from '@/lib/supabase';
import { UploadError, uploadMediaFile } from '@/lib/uploadMedia';

// Ré-exports : les écrans importent tout ce qui touche à la file depuis ici.
export {
  OFFLINE_QUEUE_KEY,
  enqueueCatch,
  enqueueOfflineCatch,
  getOfflineQueueCount,
  getQueue,
  getQueueSummary,
  getQueuedTripCatchCount,
  persistMediaForOffline,
  removeQueueItem,
  subscribeQueue,
  type OfflineQueuedCatch,
  type QueueItem,
  type QueueSummary,
} from '@/lib/offlineQueue';

// ─── Synchronisation de la file vers Supabase ────────────────────────────────
//
// Principes :
//  • IDEMPOTENT. Chaque prise porte un UUID créé sur l'appareil. Si un envoi
//    est rejoué (réponse perdue, timeout, app tuée en cours de route), la base
//    répond « clé déjà présente » (23505) : on le traite comme un succès.
//    Aucun doublon possible.
//  • RIEN N'EST RETIRÉ SANS CONFIRMATION. Un élément ne quitte la file que
//    lorsque le serveur a confirmé la prise ET tous ses médias.
//  • BORNÉ. Chaque étape réseau a un timeout : un passage ne peut pas rester
//    suspendu et bloquer les suivants.
//  • TRANSITOIRE ≠ DÉFINITIF. Panne réseau → on arrête le passage et on
//    réessaiera. Refus du serveur → l'élément est marqué « bloqué », reste dans
//    la file (aucune perte) et apparaît dans Réglages.

export type SyncStatus = 'done' | 'empty' | 'offline' | 'interrupted';

export type SyncResult = {
  status: SyncStatus;
  /** Prises confirmées par le serveur pendant ce passage. */
  synced: number;
  /** Photos / vidéos envoyées pendant ce passage. */
  mediaUploaded: number;
  /** Éléments restant dans la file pour cet utilisateur. */
  remaining: number;
  /** Éléments refusés par le serveur (intervention requise). */
  blocked: number;
  /** Dernier message d'erreur rencontré, s'il y en a un. */
  error: string | null;
};

const INSERT_TIMEOUT_MS = 20_000;
/** Après ce nombre d'échecs d'envoi d'un média, l'élément est marqué « bloqué ». */
const MAX_MEDIA_ATTEMPTS = 6;

type StepOutcome = 'ok' | 'network' | 'blocked';

// ─── Classement des erreurs ──────────────────────────────────────────────────

type PgError = { message?: string; code?: string; details?: string | null } | null;

/** Erreur passagère : réseau, timeout, session à rafraîchir, serveur surchargé. */
function isTransient(error: PgError | unknown, status: number): boolean {
  const e = (error ?? {}) as { message?: string; code?: string };
  const message = e.message ?? '';
  if (message.includes(SESSION_MISSING_MESSAGE)) return true;
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) return true;
  if (e.code === 'PGRST301' || e.code === 'PGRST302' || e.code === 'PGRST303') return true; // JWT
  return isNetworkError(error);
}

function describe(error: unknown): string {
  const e = error as { message?: string; code?: string } | null;
  if (!e) return 'Erreur inconnue';
  const text = e.message ?? String(error);
  return e.code ? `${text} (${e.code})` : text;
}

// ─── Météo historique (prises saisies sans réseau) ───────────────────────────

function wmoCodeToCondition(code: number): string | null {
  if (code === 0) return 'Ensoleillé';
  if (code === 1) return 'Peu nuageux';
  if (code === 2) return 'Partiellement nuageux';
  if (code === 3) return 'Nuageux';
  if (code === 45 || code === 48) return 'Brume';
  if (code >= 51 && code <= 57) return 'Bruine';
  if (code >= 61 && code <= 67) return 'Pluie';
  if (code >= 71 && code <= 77) return 'Neige';
  if (code >= 80 && code <= 82) return 'Averses';
  if (code >= 85 && code <= 86) return 'Neige';
  if (code >= 95) return 'Orage';
  // Code inconnu : mieux vaut « pas d'information » qu'un tiret stocké comme donnée
  return null;
}

type HistoricalWeather = {
  temperature_c: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  weather_conditions: string | null;
};

async function fetchWeatherAtTime(
  latitude: number,
  longitude: number,
  isoDateTime: string,
): Promise<HistoricalWeather | null> {
  try {
    const catchDate = new Date(isoDateTime);
    const catchTs = catchDate.getTime();
    if (!Number.isFinite(catchTs)) return null;
    const dateStr = catchDate.toISOString().split('T')[0];
    const daysDiff = Math.floor((Date.now() - catchTs) / (1000 * 60 * 60 * 24));

    const params = 'hourly=temperature_2m,windspeed_10m,winddirection_10m,weathercode&windspeed_unit=kmh&timezone=UTC';
    const coords = `latitude=${latitude}&longitude=${longitude}`;
    const url =
      daysDiff <= 16
        ? `https://api.open-meteo.com/v1/forecast?${coords}&past_days=${Math.min(Math.max(daysDiff, 0) + 1, 16)}&forecast_days=1&${params}`
        : `https://archive-api.open-meteo.com/v1/archive?${coords}&start_date=${dateStr}&end_date=${dateStr}&${params}`;

    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) return null;

    const data = await res.json();
    const times: string[] = data?.hourly?.time ?? [];
    if (times.length === 0) return null;

    // timezone=UTC : les heures renvoyées sont en UTC, sans suffixe → on l'ajoute
    // pour que la comparaison ne dépende pas du fuseau du téléphone.
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(Date.parse(`${times[i]}:00Z`) - catchTs);
      if (diff < minDiff) { minDiff = diff; closestIdx = i; }
    }

    const wind = data?.hourly?.winddirection_10m?.[closestIdx];
    return {
      temperature_c: data?.hourly?.temperature_2m?.[closestIdx] ?? null,
      wind_speed_kmh: data?.hourly?.windspeed_10m?.[closestIdx] ?? null,
      // La colonne est INTEGER : une valeur décimale ferait échouer l'écriture
      wind_direction_deg: typeof wind === 'number' ? Math.round(wind) : null,
      weather_conditions: wmoCodeToCondition(data?.hourly?.weathercode?.[closestIdx] ?? -1),
    };
  } catch {
    return null;
  }
}

function needsWeather(row: CachedCatch): boolean {
  // « Site prometteur » : pas de poisson, donc pas de météo (choix du formulaire)
  if (row.species === 'Site prometteur') return false;
  if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return false;
  return row.weather_conditions == null && row.wind_speed_kmh == null && row.temperature_c == null;
}

/** Après l'envoi : complète la météo des prises saisies sans réseau (meilleur effort). */
async function enrichWeather(row: CachedCatch, userId: string): Promise<void> {
  if (!needsWeather(row)) return;
  const weather = await fetchWeatherAtTime(row.latitude as number, row.longitude as number, row.caught_at);
  if (!weather) return;
  if (weather.temperature_c == null && weather.wind_speed_kmh == null && weather.weather_conditions == null) return;
  try {
    const { data, error } = await supabase
      .from('catches')
      .update(weather)
      .eq('id', row.id)
      .select(CATCH_SELECT_ALL)
      .single();
    if (!error && data) applyServerCatch(data as unknown as CachedCatch, userId);
  } catch { /* la prise est déjà sauvegardée : la météo reste facultative */ }
}

// ─── Étapes d'envoi d'un élément ─────────────────────────────────────────────

async function recordFailure(item: QueueItem, error: unknown, blocked: boolean): Promise<void> {
  await updateQueueItem(item.id, (current) => ({
    ...current,
    attempts: current.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError: describe(error),
    blocked: blocked || current.blocked,
  }));
}

/** Insère la prise. Retourne la ligne confirmée, ou le motif d'échec. */
async function pushCatch(item: QueueItem): Promise<{ outcome: StepOutcome; row: CachedCatch | null; error: unknown }> {
  // local_id n'existe que côté client
  const { local_id: _localId, ...row } = item.payload;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INSERT_TIMEOUT_MS);
  let data: unknown = null;
  let error: PgError = null;
  let status = 0;
  try {
    const res = await supabase
      .from('catches')
      .insert(row)
      .select(CATCH_SELECT_ALL)
      .abortSignal(controller.signal)
      .single();
    data = res.data;
    error = res.error;
    status = res.status ?? 0;
  } catch (e) {
    error = { message: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }

  if (!error && data) return { outcome: 'ok', row: data as CachedCatch, error: null };

  // Clé primaire déjà présente : un envoi précédent avait réussi sans qu'on le
  // sache. La prise EST sur le serveur → succès.
  if (error?.code === '23505') {
    const local = queueItemToCatch(item);
    return {
      outcome: 'ok',
      row: { ...local, pending: undefined, sync_error: undefined, pending_media: undefined },
      error: null,
    };
  }

  if (isTransient(error, status)) return { outcome: 'network', row: null, error };
  return { outcome: 'blocked', row: null, error };
}

/** Envoie les médias restants d'un élément dont la prise est déjà sur le serveur. */
async function pushMedia(
  itemId: string,
  userId: string,
): Promise<{ outcome: StepOutcome; uploaded: number; error: unknown }> {
  let uploaded = 0;

  // On relit l'élément à chaque tour : il est modifié au fil des envois.
  for (;;) {
    const item = await getQueueItem(itemId);
    if (!item) return { outcome: 'ok', uploaded, error: null };
    const media = item.media.find((m) => !m.uploaded);
    if (!media) return { outcome: 'ok', uploaded, error: null };

    const drop = () =>
      updateQueueItem(itemId, (current) => ({
        ...current,
        media: current.media.filter((m) => m.id !== media.id),
      }));

    if (!(await localMediaExists(media.uri))) {
      console.warn('[Sync] Média local introuvable, abandonné', media.uri);
      await drop();
      continue;
    }

    try {
      const source = resolveMediaUri(media.uri) ?? media.uri;
      const { storagePath } = await uploadMediaFile(source, userId, item.id, media.type, media.id);

      const { error, status } = await supabase.from('catch_media').insert({
        id: media.id,
        catch_id: item.id,
        media_type: media.type,
        storage_path: storagePath,
        uploaded: true,
      });
      if (error && error.code !== '23505') {
        if (isTransient(error, status ?? 0)) return { outcome: 'network', uploaded, error };
        return { outcome: 'blocked', uploaded, error };
      }

      await updateQueueItem(itemId, (current) => ({
        ...current,
        media: current.media.map((m) => (m.id === media.id ? { ...m, uploaded: true } : m)),
      }));
      await deleteLocalMedia(media.uri);
      uploaded++;
    } catch (e) {
      if (e instanceof UploadError && !e.transient) {
        // Le serveur refuse CE fichier (trop gros, format…) : inutile d'insister.
        console.warn('[Sync] Média refusé, abandonné', e.message);
        await drop();
        continue;
      }
      return { outcome: 'network', uploaded, error: e };
    }
  }
}

// ─── Passage de synchronisation ──────────────────────────────────────────────

let running: Promise<SyncResult> | null = null;

async function runSync(userId: string, includeBlocked: boolean): Promise<SyncResult> {
  const result: SyncResult = { status: 'empty', synced: 0, mediaUploaded: 0, remaining: 0, blocked: 0, error: null };

  const finish = async (status: SyncStatus): Promise<SyncResult> => {
    const summary = summarizeQueue(await getQueue(), userId);
    result.status = status;
    result.remaining = summary.total;
    result.blocked = summary.blocked;
    if (!result.error) result.error = summary.lastError;
    console.log(
      `[Sync] ${status} — ${result.synced} prise(s) envoyée(s), ${result.mediaUploaded} média(s), ${result.remaining} restant(s)`,
    );
    return result;
  };

  const queue = (await getQueue()).filter((i) => i.payload.user_id === userId);
  if (queue.length === 0) return result;

  // Aucun réseau → inutile d'essayer (les éléments restent intacts dans la file)
  if (!(await mayReachNetwork())) return finish('offline');

  const candidates = queue
    .filter((i) => includeBlocked || !i.blocked)
    .sort((a, b) => a.createdAt - b.createdAt);

  const toEnrich: CachedCatch[] = [];

  for (const queued of candidates) {
    // L'élément a pu être modifié/supprimé depuis la lecture initiale
    let item = await getQueueItem(queued.id);
    if (!item) continue;

    // ── 1. La prise ──
    if (!item.catchSynced) {
      const pushed = await pushCatch(item);
      if (pushed.outcome === 'network') {
        await recordFailure(item, pushed.error, false);
        result.error = describe(pushed.error);
        return finish('interrupted'); // le réseau ne répond pas : on s'arrête là
      }
      if (pushed.outcome === 'blocked' || !pushed.row) {
        await recordFailure(item, pushed.error, true);
        result.error = describe(pushed.error);
        continue; // les autres éléments ne sont pas concernés
      }

      // Confirmée : visible partout tout de suite, puis l'entrée de file est mise à jour
      applyServerCatch(pushed.row, userId);
      result.synced++;
      toEnrich.push(pushed.row);

      if (item.media.every((m) => m.uploaded)) {
        await removeQueueItem(item.id);
        continue;
      }
      item = await updateQueueItem(item.id, (current) => ({
        ...current,
        catchSynced: true,
        blocked: false,
        lastError: null,
      }));
      if (!item) continue;
    }

    // ── 2. Ses médias ──
    const media = await pushMedia(item.id, userId);
    result.mediaUploaded += media.uploaded;

    if (media.outcome === 'ok') {
      await removeQueueItem(item.id);
      continue;
    }

    const current = await getQueueItem(item.id);
    const giveUp = media.outcome === 'blocked' || (current?.attempts ?? 0) + 1 >= MAX_MEDIA_ATTEMPTS;
    if (current) await recordFailure(current, media.error, giveUp);
    result.error = describe(media.error);
    if (media.outcome === 'network') return finish('interrupted');
  }

  // ── 3. Météo rétroactive (facultatif, après que tout soit en sécurité) ──
  for (const row of toEnrich) {
    await enrichWeather(row, userId);
  }

  return finish('done');
}

/**
 * Envoie au serveur tout ce qui attend dans la file pour cet utilisateur.
 * Un seul passage à la fois : un appel pendant un passage en cours reçoit le
 * résultat de ce passage (pas de double envoi, pas de verrou qui reste bloqué).
 *
 * `includeBlocked` : réessayer aussi les éléments refusés précédemment
 * (bouton « Synchroniser maintenant »).
 */
export function trySyncOfflineCatches(
  userId: string,
  options: { includeBlocked?: boolean } = {},
): Promise<SyncResult> {
  if (running) return running;

  const promise = runSync(userId, options.includeBlocked === true)
    .catch((e): SyncResult => {
      console.warn('[Sync] Passage interrompu par une erreur inattendue', e);
      return { status: 'interrupted', synced: 0, mediaUploaded: 0, remaining: 0, blocked: 0, error: describe(e) };
    })
    .finally(() => {
      if (running === promise) running = null;
    });
  running = promise;
  return promise;
}

/** Un passage de synchronisation est-il en cours ? */
export function isSyncRunning(): boolean {
  return running != null;
}
