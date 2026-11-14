import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { server } from './helpers/fakeSupabase';

jest.mock('@/lib/supabase', () => require('./helpers/fakeSupabase'));

import { loadCatchesCache, saveCatchesCache, type CachedCatch } from '@/lib/catchCache';
import {
  applyServerCatch,
  getCatchStoreSnapshot,
  refreshCatches,
  removeLocalCatch,
  resetCatchStoreForTests,
  setCatchStoreUser,
  subscribeCatchStore,
} from '@/lib/catchStore';
import { enqueueCatch, removeQueueItem } from '@/lib/offlineQueue';
import type { CatchPayload } from '@/lib/types';

const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };
const USER = 'user-1';

function row(id: string, caughtAt: string, extra: Partial<CachedCatch> = {}): CachedCatch {
  return {
    id,
    species: 'Doré jaune',
    latitude: 47.5,
    longitude: -71.5,
    lake_name: 'Lac Test',
    lure: null,
    weight_lbs: null,
    length_inches: null,
    depth_meters: null,
    depth_source: null,
    size_category: null,
    weather_conditions: null,
    temperature_c: null,
    wind_speed_kmh: null,
    wind_direction_deg: null,
    speed_kmh: null,
    notes: null,
    caught_at: caughtAt,
    trip_id: null,
    ...extra,
  };
}

function payload(overrides: Partial<CatchPayload> = {}): CatchPayload {
  return {
    user_id: USER, map_id: null, trip_id: null, species: 'Brochet', lure: null,
    latitude: 46, longitude: -72, lake_name: null, depth_meters: null, depth_source: null,
    temperature_c: null, wind_speed_kmh: null, wind_direction_deg: null, speed_kmh: null,
    weather_conditions: null, size_category: null, weight_lbs: null, length_inches: null,
    notes: null, caught_at: '2026-07-01T10:00:00.000Z', local_id: null,
    ...overrides,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const serverRows = () => server.rows('catches');
const ids = () => getCatchStoreSnapshot().catches.map((c) => c.id);

beforeEach(async () => {
  await AsyncStorage.clear();
  server.reset();
  net.__reset();
  resetCatchStoreForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('magasin des prises : lecture locale', () => {
  it('affiche le cache immédiatement, sans aucune requête réseau', async () => {
    await saveCatchesCache(USER, [row('a', '2026-06-01T10:00:00Z'), row('b', '2026-06-03T10:00:00Z')], 1000);
    net.__setState({ isConnected: false, isInternetReachable: false });

    await setCatchStoreUser(USER);

    const snap = getCatchStoreSnapshot();
    expect(snap.hydrated).toBe(true);
    expect(ids()).toEqual(['b', 'a']); // plus récente d'abord
    expect(snap.source).toBe('cache');
    expect(snap.lastServerSyncAt).toBe(1000);
    expect(server.log).toEqual([]);
  });

  it('ajoute les prises en attente à celles du cache, triées par date', async () => {
    await saveCatchesCache(USER, [row('vieille', '2026-06-01T10:00:00Z')]);
    const queued = await enqueueCatch({ payload: payload({ caught_at: '2026-07-01T10:00:00.000Z' }) });

    await setCatchStoreUser(USER);

    const snap = getCatchStoreSnapshot();
    expect(ids()).toEqual([queued.id, 'vieille']);
    expect(snap.pendingCount).toBe(1);
    expect(snap.catches[0].pending).toBe(true);
  });

  it('une prise saisie apparaît tout de suite, sans réseau', async () => {
    net.__setState({ isConnected: false, isInternetReachable: false });
    await setCatchStoreUser(USER);
    const notified = jest.fn();
    const unsubscribe = subscribeCatchStore(notified);

    const queued = await enqueueCatch({ payload: payload() });
    await flush();
    unsubscribe();

    expect(ids()).toEqual([queued.id]);
    expect(notified).toHaveBeenCalled();
  });

  it('une prise retirée de la file disparaît de l\'affichage', async () => {
    await setCatchStoreUser(USER);
    const queued = await enqueueCatch({ payload: payload() });
    await flush();
    await removeQueueItem(queued.id);
    await flush();
    expect(ids()).toEqual([]);
  });

  it('n\'affiche pas les prises en attente d\'un autre compte', async () => {
    await enqueueCatch({ payload: payload({ user_id: 'user-2' }) });
    await setCatchStoreUser(USER);
    expect(ids()).toEqual([]);
  });

  it('changer d\'utilisateur repart de ses propres données', async () => {
    await saveCatchesCache(USER, [row('a', '2026-06-01T10:00:00Z')]);
    await saveCatchesCache('user-2', [row('z', '2026-06-01T10:00:00Z')]);
    await setCatchStoreUser(USER);
    expect(ids()).toEqual(['a']);
    await setCatchStoreUser('user-2');
    expect(ids()).toEqual(['z']);
    await setCatchStoreUser(null);
    expect(ids()).toEqual([]);
  });
});

describe('magasin des prises : rafraîchissement serveur', () => {
  it('remplace le cache par la réponse du serveur', async () => {
    await saveCatchesCache(USER, [row('a', '2026-06-01T10:00:00Z')]);
    serverRows().push(
      { ...row('a', '2026-06-01T10:00:00Z'), user_id: USER },
      { ...row('c', '2026-06-05T10:00:00Z'), user_id: USER },
      { ...row('autre', '2026-06-09T10:00:00Z'), user_id: 'user-2' },
    );
    await setCatchStoreUser(USER);

    expect(await refreshCatches({ force: true })).toBe(true);

    expect(ids()).toEqual(['c', 'a']);
    expect(getCatchStoreSnapshot().source).toBe('server');
    expect((await loadCatchesCache(USER))?.map((c) => c.id)).toEqual(['c', 'a']);
  });

  it('une panne réseau ne modifie ni l\'affichage ni le cache', async () => {
    await saveCatchesCache(USER, [row('a', '2026-06-01T10:00:00Z')]);
    await setCatchStoreUser(USER);
    server.online = false;

    expect(await refreshCatches({ force: true })).toBe(false);

    expect(ids()).toEqual(['a']);
    expect(getCatchStoreSnapshot().source).toBe('cache');
    expect((await loadCatchesCache(USER))?.map((c) => c.id)).toEqual(['a']);
  });

  it('une requête qui échoue (timeout, erreur serveur) laisse le cache intact', async () => {
    await saveCatchesCache(USER, [row('a', '2026-06-01T10:00:00Z')]);
    await setCatchStoreUser(USER);
    server.failures.push({
      table: 'catches',
      op: 'select',
      result: { data: null, error: { message: 'AbortError: Aborted', code: '' }, status: 0 },
    });

    expect(await refreshCatches({ force: true })).toBe(false);

    expect(server.count('catches', 'select')).toBe(1);
    expect(ids()).toEqual(['a']);
    expect(getCatchStoreSnapshot().source).toBe('cache');
    expect((await loadCatchesCache(USER))?.map((c) => c.id)).toEqual(['a']);
  });

  it('régression : sans session valide, une réponse vide ne peut PAS vider le cache', async () => {
    // Le serveur n'a (pour un anonyme) aucune ligne à retourner. Avant, cette
    // réponse « 0 prise, pas d'erreur » était enregistrée par-dessus le cache.
    await saveCatchesCache(USER, [row('a', '2026-06-01T10:00:00Z'), row('b', '2026-06-02T10:00:00Z')]);
    await setCatchStoreUser(USER);
    server.sessionUserId = null;

    expect(await refreshCatches({ force: true })).toBe(false);

    expect(ids()).toEqual(['b', 'a']);
    expect((await loadCatchesCache(USER))).toHaveLength(2);
    expect(server.count('catches', 'select')).toBe(0); // la requête n'est même pas envoyée
  });

  it('ne rafraîchit pas avec la session d\'un autre utilisateur', async () => {
    await saveCatchesCache(USER, [row('a', '2026-06-01T10:00:00Z')]);
    await setCatchStoreUser(USER);
    server.sessionUserId = 'user-2';

    expect(await refreshCatches({ force: true })).toBe(false);
    expect(ids()).toEqual(['a']);
  });

  it('hors-ligne : aucune requête', async () => {
    await setCatchStoreUser(USER);
    net.__setState({ isConnected: false, isInternetReachable: false });
    expect(await refreshCatches({ force: true })).toBe(false);
    expect(server.log).toEqual([]);
  });

  it('les demandes rapprochées (changement d\'onglet) ne multiplient pas les requêtes', async () => {
    await setCatchStoreUser(USER);
    await refreshCatches();
    await refreshCatches();
    await refreshCatches();
    expect(server.count('catches', 'select')).toBe(1);
    await refreshCatches({ force: true });
    expect(server.count('catches', 'select')).toBe(2);
  });

  it('des demandes simultanées partagent la même requête', async () => {
    await setCatchStoreUser(USER);
    server.latencyMs = 15;
    await Promise.all([refreshCatches({ force: true }), refreshCatches({ force: true }), refreshCatches({ force: true })]);
    expect(server.count('catches', 'select')).toBe(1);
  });

  it('récupère plus de 1000 prises (pagination)', async () => {
    for (let i = 0; i < 2300; i++) {
      serverRows().push({ ...row(`c${i}`, new Date(1_700_000_000_000 + i * 60_000).toISOString()), user_id: USER });
    }
    await setCatchStoreUser(USER);
    await refreshCatches({ force: true });
    expect(getCatchStoreSnapshot().catches).toHaveLength(2300);
    expect(server.count('catches', 'select')).toBe(3);
  });
});

describe('magasin des prises : mises à jour locales', () => {
  it('une prise confirmée n\'apparaît qu\'une fois (plus « en attente »)', async () => {
    await setCatchStoreUser(USER);
    const queued = await enqueueCatch({ payload: payload() });
    await flush();
    expect(getCatchStoreSnapshot().pendingCount).toBe(1);

    applyServerCatch(row(queued.id, '2026-07-01T10:00:00.000Z'));

    const snap = getCatchStoreSnapshot();
    expect(ids()).toEqual([queued.id]);
    expect(snap.pendingCount).toBe(0);
    expect(snap.catches[0].pending).toBeUndefined();
  });

  it('une réponse serveur partie AVANT l\'envoi ne fait pas disparaître la prise', async () => {
    await setCatchStoreUser(USER);
    // Le serveur répondra sans la prise « neuve » (elle n'y était pas encore)
    serverRows().push({ ...row('ancienne', '2026-06-01T10:00:00Z'), user_id: USER });
    applyServerCatch(row('neuve', '2026-07-01T10:00:00Z'));

    await refreshCatches({ force: true });

    expect(ids()).toEqual(['neuve', 'ancienne']);
  });

  it('retire une prise supprimée et met le cache à jour', async () => {
    await saveCatchesCache(USER, [row('a', '2026-06-01T10:00:00Z'), row('b', '2026-06-02T10:00:00Z')]);
    await setCatchStoreUser(USER);

    removeLocalCatch('a');
    await flush();

    expect(ids()).toEqual(['b']);
    expect((await loadCatchesCache(USER))?.map((c) => c.id)).toEqual(['b']);
  });

  it('les champs locaux (« en attente ») ne sont jamais écrits dans le cache serveur', async () => {
    await setCatchStoreUser(USER);
    applyServerCatch({ ...row('a', '2026-06-01T10:00:00Z'), pending: true, sync_error: 'x', pending_media: 2 });
    await flush();
    const cached = await loadCatchesCache(USER);
    expect(cached?.[0]).not.toHaveProperty('pending');
    expect(cached?.[0]).not.toHaveProperty('sync_error');
  });
});
