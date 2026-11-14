import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';

import { server } from './helpers/fakeSupabase';

jest.mock('@/lib/supabase', () => require('./helpers/fakeSupabase'));

// Envoi de fichiers piloté par les tests (le vrai passe par le système natif)
const mockUpload = jest.fn();
jest.mock('@/lib/uploadMedia', () => {
  class UploadError extends Error {
    status: number;
    transient: boolean;
    constructor(message: string, status: number, transient: boolean) {
      super(message);
      this.name = 'UploadError';
      this.status = status;
      this.transient = transient;
    }
  }
  return {
    UploadError,
    uploadMediaFile: (...args: unknown[]) => mockUpload(...args),
  };
});

import { getCatchStoreSnapshot, resetCatchStoreForTests, setCatchStoreUser } from '@/lib/catchStore';
import { enqueueCatch, getQueue, updateQueueItem } from '@/lib/offlineQueue';
import { trySyncOfflineCatches } from '@/lib/offlineSync';
import type { CatchPayload } from '@/lib/types';
import { UploadError } from '@/lib/uploadMedia';

const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };
const fs = FileSystem as unknown as { __addFile: (u: string) => void; __hasFile: (u: string) => boolean; __reset: () => void };

const USER = 'user-1';

function payload(overrides: Partial<CatchPayload> = {}): CatchPayload {
  return {
    user_id: USER,
    map_id: null,
    trip_id: null,
    species: 'Doré jaune',
    lure: 'Rapala',
    latitude: 47.5,
    longitude: -71.5,
    lake_name: null,
    depth_meters: null,
    depth_source: null,
    // météo renseignée par défaut → pas d'appel météo, sauf test dédié
    temperature_c: 18,
    wind_speed_kmh: 10,
    wind_direction_deg: 180,
    speed_kmh: null,
    weather_conditions: 'Ensoleillé',
    size_category: 'medium',
    weight_lbs: null,
    length_inches: null,
    notes: null,
    caught_at: '2026-06-01T12:00:00.000Z',
    local_id: null,
    ...overrides,
  };
}

const catches = () => server.rows('catches');

beforeEach(async () => {
  await AsyncStorage.clear();
  server.reset();
  net.__reset();
  fs.__reset();
  mockUpload.mockReset();
  mockUpload.mockImplementation(async (_uri: string, userId: string, catchId: string, _type: string, mediaId: string) => ({
    storagePath: `${userId}/${catchId}/${mediaId}.jpg`,
  }));
  resetCatchStoreForTests();
  await setCatchStoreUser(USER);
  global.fetch = jest.fn(() => Promise.reject(new Error('aucun appel réseau attendu'))) as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('synchronisation : cas nominal', () => {
  it('envoie les prises en attente avec LEUR identifiant et vide la file', async () => {
    const a = await enqueueCatch({ payload: payload({ notes: 'A' }) });
    const b = await enqueueCatch({ payload: payload({ notes: 'B' }) });

    const result = await trySyncOfflineCatches(USER);

    expect(result).toMatchObject({ status: 'done', synced: 2, remaining: 0, blocked: 0 });
    expect(catches().map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(catches().every((r) => !('local_id' in r))).toBe(true);
    expect(await getQueue()).toEqual([]);
  });

  it('rend la prise visible dans le magasin local dès la confirmation', async () => {
    const item = await enqueueCatch({ payload: payload() });
    expect(getCatchStoreSnapshot().pendingCount).toBe(0); // le magasin se met à jour de façon asynchrone
    await trySyncOfflineCatches(USER);
    await new Promise((r) => setTimeout(r, 0));

    const snap = getCatchStoreSnapshot();
    expect(snap.pendingCount).toBe(0);
    expect(snap.catches.map((c) => c.id)).toEqual([item.id]);
    expect(snap.catches[0].pending).toBeUndefined();
  });

  it('ne fait rien quand la file est vide', async () => {
    const result = await trySyncOfflineCatches(USER);
    expect(result.status).toBe('empty');
    expect(server.log).toEqual([]);
  });

  it('ne touche pas aux prises d\'un autre compte', async () => {
    await enqueueCatch({ payload: payload({ user_id: 'user-2' }) });
    const result = await trySyncOfflineCatches(USER);
    expect(result.status).toBe('empty');
    expect(catches()).toHaveLength(0);
    expect(await getQueue()).toHaveLength(1);
  });
});

describe('synchronisation : pas de doublon', () => {
  it('un envoi dont la réponse s\'est perdue est reconnu comme déjà fait', async () => {
    const item = await enqueueCatch({ payload: payload() });
    // La 1re tentative a atteint le serveur mais l'app n'a jamais reçu la réponse
    catches().push({ ...item.payload });

    const result = await trySyncOfflineCatches(USER);

    expect(result).toMatchObject({ status: 'done', synced: 1, remaining: 0 });
    expect(catches()).toHaveLength(1); // toujours UNE seule ligne
    expect(await getQueue()).toEqual([]);
  });

  it('rejouer la synchronisation 3 fois n\'insère la prise qu\'une fois', async () => {
    await enqueueCatch({ payload: payload() });
    await trySyncOfflineCatches(USER);
    await trySyncOfflineCatches(USER);
    await trySyncOfflineCatches(USER);
    expect(catches()).toHaveLength(1);
    expect(server.count('catches', 'insert')).toBe(1);
  });

  it('deux déclenchements simultanés partagent le même passage', async () => {
    await enqueueCatch({ payload: payload() });
    server.latencyMs = 20;
    const [r1, r2] = await Promise.all([trySyncOfflineCatches(USER), trySyncOfflineCatches(USER)]);
    expect(r1).toBe(r2);
    expect(server.count('catches', 'insert')).toBe(1);
    expect(catches()).toHaveLength(1);
  });

  it('une file au format ancien (sans UUID) est envoyée une seule fois malgré une coupure', async () => {
    await AsyncStorage.setItem(
      'offline_catches_queue_v1',
      JSON.stringify([{ payload: { ...payload(), local_id: 'local_1' }, media: [] }]),
    );

    server.online = false;
    const failed = await trySyncOfflineCatches(USER);
    expect(failed.status).toBe('interrupted');

    // Le serveur avait en réalité reçu la prise : même UUID à la 2e tentative
    const [queued] = await getQueue();
    catches().push({ ...queued.payload });
    server.online = true;

    await trySyncOfflineCatches(USER);
    expect(catches()).toHaveLength(1);
    expect(await getQueue()).toEqual([]);
  });
});

describe('synchronisation : pannes', () => {
  it('sans réseau : rien n\'est tenté, rien n\'est perdu', async () => {
    await enqueueCatch({ payload: payload() });
    net.__setState({ isConnected: false, isInternetReachable: false });

    const result = await trySyncOfflineCatches(USER);

    expect(result).toMatchObject({ status: 'offline', synced: 0, remaining: 1 });
    expect(server.log).toEqual([]);
    expect(await getQueue()).toHaveLength(1);
  });

  it('tente quand même si le réseau est présent mais « non validé » par l\'OS', async () => {
    // Situation au retour du signal : connecté, accès internet pas encore confirmé.
    // L'ancienne synchro abandonnait ici et ne réessayait jamais.
    await enqueueCatch({ payload: payload() });
    net.__setState({ isConnected: true, isInternetReachable: false });

    const result = await trySyncOfflineCatches(USER);

    expect(result).toMatchObject({ status: 'done', synced: 1, remaining: 0 });
  });

  it('coupure réseau : le passage s\'arrête, les prises restent, puis repartent', async () => {
    await enqueueCatch({ payload: payload({ notes: 'A' }) });
    await enqueueCatch({ payload: payload({ notes: 'B' }) });
    server.online = false;

    const failed = await trySyncOfflineCatches(USER);
    expect(failed).toMatchObject({ status: 'interrupted', synced: 0, remaining: 2, blocked: 0 });
    // une seule tentative : inutile d'essayer B si le réseau ne répond pas
    expect(server.count('catches', 'insert')).toBe(1);
    const [first] = await getQueue();
    expect(first.attempts).toBe(1);
    expect(first.lastError).toContain('Network request failed');
    expect(first.blocked).toBe(false);

    server.online = true;
    const ok = await trySyncOfflineCatches(USER);
    expect(ok).toMatchObject({ status: 'done', synced: 2, remaining: 0 });
    expect(catches()).toHaveLength(2);
  });

  it('session absente : considéré comme passager, rien n\'est bloqué', async () => {
    await enqueueCatch({ payload: payload() });
    server.sessionUserId = null;

    const result = await trySyncOfflineCatches(USER);
    expect(result).toMatchObject({ status: 'interrupted', remaining: 1, blocked: 0 });

    server.sessionUserId = USER;
    expect((await trySyncOfflineCatches(USER)).synced).toBe(1);
  });

  it('refus du serveur : la prise est marquée bloquée, CONSERVÉE, et les autres passent', async () => {
    const bad = await enqueueCatch({ payload: payload({ notes: 'refusée' }) });
    await new Promise((r) => setTimeout(r, 2));
    const good = await enqueueCatch({ payload: payload({ notes: 'ok' }) });
    server.failures.push({
      table: 'catches',
      op: 'insert',
      result: { data: null, error: { message: 'violates check constraint', code: '23514' }, status: 400 },
    });

    const result = await trySyncOfflineCatches(USER);

    expect(result).toMatchObject({ status: 'done', synced: 1, remaining: 1, blocked: 1 });
    expect(catches().map((r) => r.id)).toEqual([good.id]);
    const [left] = await getQueue();
    expect(left.id).toBe(bad.id);
    expect(left.blocked).toBe(true);
    expect(left.lastError).toContain('23514');
  });

  it('un élément bloqué n\'est réessayé que sur demande explicite', async () => {
    const item = await enqueueCatch({ payload: payload() });
    await updateQueueItem(item.id, { blocked: true, lastError: 'ancien refus' });

    const auto = await trySyncOfflineCatches(USER);
    expect(auto.synced).toBe(0);
    expect(server.count('catches', 'insert')).toBe(0);

    const manual = await trySyncOfflineCatches(USER, { includeBlocked: true });
    expect(manual).toMatchObject({ synced: 1, remaining: 0, blocked: 0 });
  });

  it('régression : une prise saisie PENDANT l\'envoi n\'est pas perdue', async () => {
    await enqueueCatch({ payload: payload({ notes: 'A' }) });

    let injected = false;
    server.onRequest = async (table, op) => {
      if (table === 'catches' && op === 'insert' && !injected) {
        injected = true;
        await enqueueCatch({ payload: payload({ notes: 'B, saisie pendant la synchro' }) });
      }
    };

    await trySyncOfflineCatches(USER);
    // B n'était pas dans la liste lue au départ : elle doit être intacte dans la file
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.notes).toContain('B');

    await trySyncOfflineCatches(USER);
    expect(catches()).toHaveLength(2);
    expect(await getQueue()).toEqual([]);
  });
});

describe('synchronisation : photos et vidéos', () => {
  const PHOTO_1 = 'file:///documents/offline_media/p1.jpg';
  const PHOTO_2 = 'file:///documents/offline_media/p2.jpg';

  it('envoie les médias, crée catch_media et supprime les copies locales', async () => {
    fs.__addFile(PHOTO_1);
    const item = await enqueueCatch({ payload: payload(), media: [{ uri: PHOTO_1, type: 'photo' }] });

    const result = await trySyncOfflineCatches(USER);

    expect(result).toMatchObject({ status: 'done', synced: 1, mediaUploaded: 1, remaining: 0 });
    const media = server.rows('catch_media');
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ catch_id: item.id, id: item.media[0].id, media_type: 'photo', uploaded: true });
    expect(fs.__hasFile(PHOTO_1)).toBe(false);
  });

  it('régression : une photo dont l\'envoi échoue n\'est plus perdue', async () => {
    fs.__addFile(PHOTO_1);
    fs.__addFile(PHOTO_2);
    await enqueueCatch({
      payload: payload(),
      media: [{ uri: PHOTO_1, type: 'photo' }, { uri: PHOTO_2, type: 'photo' }],
    });
    mockUpload
      .mockImplementationOnce(async (_u: string, u: string, c: string, _t: string, m: string) => ({ storagePath: `${u}/${c}/${m}.jpg` }))
      .mockRejectedValueOnce(new UploadError('Timeout envoi média', 0, true));

    const first = await trySyncOfflineCatches(USER);
    expect(first).toMatchObject({ status: 'interrupted', synced: 1, mediaUploaded: 1, remaining: 1 });
    expect(catches()).toHaveLength(1); // la prise, elle, est en sécurité

    const [left] = await getQueue();
    expect(left.catchSynced).toBe(true);
    expect(left.media.map((m) => m.uploaded)).toEqual([true, false]);
    expect(fs.__hasFile(PHOTO_2)).toBe(true); // la photo restante est toujours là

    const second = await trySyncOfflineCatches(USER);
    expect(second).toMatchObject({ status: 'done', synced: 0, mediaUploaded: 1, remaining: 0 });
    expect(server.count('catches', 'insert')).toBe(1); // la prise n'est PAS renvoyée
    expect(server.rows('catch_media')).toHaveLength(2);
    expect(mockUpload).toHaveBeenCalledTimes(3);
  });

  it('une prise synchronisée dont il reste des médias n\'est plus comptée « en attente »', async () => {
    fs.__addFile(PHOTO_1);
    const item = await enqueueCatch({ payload: payload(), media: [{ uri: PHOTO_1, type: 'photo' }] });
    mockUpload.mockRejectedValue(new UploadError('réseau', 0, true));

    await trySyncOfflineCatches(USER);
    await new Promise((r) => setTimeout(r, 0));

    const snap = getCatchStoreSnapshot();
    expect(snap.pendingCount).toBe(0);
    expect(snap.catches.map((c) => c.id)).toEqual([item.id]); // présente une seule fois
  });

  it('abandonne un fichier local disparu sans bloquer la prise', async () => {
    await enqueueCatch({ payload: payload(), media: [{ uri: 'file:///documents/offline_media/absent.jpg', type: 'photo' }] });
    const result = await trySyncOfflineCatches(USER);
    expect(result).toMatchObject({ status: 'done', synced: 1, mediaUploaded: 0, remaining: 0 });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('abandonne un fichier refusé définitivement par le serveur', async () => {
    fs.__addFile(PHOTO_1);
    await enqueueCatch({ payload: payload(), media: [{ uri: PHOTO_1, type: 'photo' }] });
    mockUpload.mockRejectedValue(new UploadError('Payload too large', 413, false));

    const result = await trySyncOfflineCatches(USER);
    expect(result).toMatchObject({ status: 'done', synced: 1, remaining: 0 });
    expect(server.rows('catch_media')).toHaveLength(0);
  });

  it('un média dont la ligne catch_media existe déjà est reconnu comme envoyé', async () => {
    fs.__addFile(PHOTO_1);
    const item = await enqueueCatch({ payload: payload(), media: [{ uri: PHOTO_1, type: 'photo' }] });
    server.rows('catch_media').push({ id: item.media[0].id, catch_id: item.id });

    const result = await trySyncOfflineCatches(USER);
    expect(result).toMatchObject({ status: 'done', mediaUploaded: 1, remaining: 0 });
    expect(server.rows('catch_media')).toHaveLength(1);
  });
});

describe('synchronisation : météo rétroactive', () => {
  const openMeteo = {
    hourly: {
      time: ['2026-06-01T11:00', '2026-06-01T12:00', '2026-06-01T13:00'],
      temperature_2m: [15, 17.5, 19],
      windspeed_10m: [5, 12, 9],
      winddirection_10m: [90, 181.6, 200],
      weathercode: [0, 3, 61],
    },
  };
  const noWeather = { temperature_c: null, wind_speed_kmh: null, wind_direction_deg: null, weather_conditions: null };

  it('complète la météo d\'une prise saisie sans réseau', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => openMeteo })) as unknown as typeof fetch;
    await enqueueCatch({ payload: payload(noWeather) });

    await trySyncOfflineCatches(USER);

    expect(catches()[0]).toMatchObject({
      temperature_c: 17.5,
      wind_speed_kmh: 12,
      wind_direction_deg: 182, // arrondi : la colonne est un entier
      weather_conditions: 'Nuageux',
    });
  });

  it('la prise est envoyée même si le service météo ne répond pas', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('timeout'))) as unknown as typeof fetch;
    await enqueueCatch({ payload: payload(noWeather) });

    const result = await trySyncOfflineCatches(USER);

    expect(result).toMatchObject({ status: 'done', synced: 1, remaining: 0 });
    expect(catches()[0].temperature_c).toBeNull();
  });

  it('ne met pas de météo sur un « Site prometteur »', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => openMeteo }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await enqueueCatch({ payload: payload({ ...noWeather, species: 'Site prometteur' }) });

    await trySyncOfflineCatches(USER);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(catches()[0].temperature_c).toBeNull();
  });
});
