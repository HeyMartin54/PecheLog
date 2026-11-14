import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { server } from './helpers/fakeSupabase';

jest.mock('@/lib/supabase', () => require('./helpers/fakeSupabase'));

import {
  createUserLure,
  getCachedLures,
  loadLuresWithCache,
  setCachedLures,
  syncPendingLures,
  watchLures,
  type UserLure,
} from '@/lib/lureStorage';
import { isUuid } from '@/lib/uuid';

const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };
const USER = 'user-1';
const serverLures = () => server.rows('user_lures');
const goOffline = () => net.__setState({ isConnected: false, isInternetReachable: false });
const goOnline = () => net.__setState({ isConnected: true, isInternetReachable: true });

function lure(id: string, name: string): UserLure {
  return { id, user_id: USER, name, size: null, color: null, notes: null, photo_url: null, created_at: '2026-01-01T00:00:00Z' };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  server.reset();
  net.__reset();
});

describe('leurres : lecture', () => {
  it('régression : hors-ligne, la liste vient du cache et le cache N\'EST PAS vidé', async () => {
    await setCachedLures(USER, [lure('l1', 'Rapala'), lure('l2', 'Williams')]);
    goOffline();

    const lures = await loadLuresWithCache(USER);

    expect(lures.map((l) => l.name)).toEqual(['Rapala', 'Williams']);
    expect(await getCachedLures(USER)).toHaveLength(2);
  });

  it('régression : une erreur serveur ne vide pas le cache', async () => {
    await setCachedLures(USER, [lure('l1', 'Rapala')]);
    server.online = false; // « connecté » selon l'OS, mais rien ne passe

    const lures = await loadLuresWithCache(USER);

    expect(lures.map((l) => l.name)).toEqual(['Rapala']);
    expect(await getCachedLures(USER)).toHaveLength(1);
  });

  it('en ligne : le cache est mis à jour depuis le serveur', async () => {
    await setCachedLures(USER, [lure('l1', 'Ancien')]);
    serverLures().push(lure('l1', 'Rapala'), lure('l2', 'Mepps'));

    const lures = await loadLuresWithCache(USER);

    expect(lures.map((l) => l.name)).toEqual(['Mepps', 'Rapala']);
    expect((await getCachedLures(USER)).map((l) => l.name)).toEqual(['Mepps', 'Rapala']);
  });

  it('un serveur réellement sans leurre vide bien la liste', async () => {
    await setCachedLures(USER, [lure('l1', 'Supprimé ailleurs')]);
    expect(await loadLuresWithCache(USER)).toEqual([]);
  });

  it('watchLures donne le cache tout de suite, puis la version à jour', async () => {
    await setCachedLures(USER, [lure('l1', 'Cache')]);
    serverLures().push(lure('l1', 'Serveur'));
    server.latencyMs = 15;

    const updates: string[][] = [];
    await new Promise<void>((resolve) => {
      watchLures(USER, (lures) => {
        updates.push(lures.map((l) => l.name));
        if (updates.length === 2) resolve();
      });
    });

    expect(updates).toEqual([['Cache'], ['Serveur']]);
  });
});

describe('leurres : création hors-ligne', () => {
  it('crée le leurre localement, utilisable tout de suite', async () => {
    goOffline();

    const created = await createUserLure(USER, { name: 'Leurre du jour', size: null, color: 'Or', notes: null });

    expect(created).not.toBeNull();
    expect(isUuid(created?.id)).toBe(true);
    expect(created?.pending).toBe(true);
    expect((await getCachedLures(USER)).map((l) => l.name)).toEqual(['Leurre du jour']);
    expect(server.log).toEqual([]);
  });

  it('l\'envoie au retour du réseau, avec le même identifiant', async () => {
    goOffline();
    const created = await createUserLure(USER, { name: 'Leurre du jour', size: null, color: null, notes: null });

    goOnline();
    expect(await syncPendingLures(USER)).toBe(true);

    expect(serverLures()).toHaveLength(1);
    expect(serverLures()[0]).toMatchObject({ id: created?.id, name: 'Leurre du jour', user_id: USER });
    expect((await getCachedLures(USER))[0].pending).toBeUndefined();
  });

  it('un envoi rejoué ne crée pas de doublon', async () => {
    goOffline();
    const created = await createUserLure(USER, { name: 'X', size: null, color: null, notes: null });
    goOnline();
    serverLures().push({ id: created?.id, user_id: USER, name: 'X' }); // déjà reçu par le serveur

    expect(await syncPendingLures(USER)).toBe(true);
    expect(serverLures()).toHaveLength(1);
  });

  it('un leurre en attente survit à un rafraîchissement depuis le serveur', async () => {
    goOffline();
    await createUserLure(USER, { name: 'Local', size: null, color: null, notes: null });
    goOnline();
    serverLures().push(lure('l1', 'Serveur'));
    // l'envoi du leurre local échoue cette fois-ci
    server.failures.push({
      table: 'user_lures', op: 'insert',
      result: { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 },
    });

    const lures = await loadLuresWithCache(USER);

    expect(lures.map((l) => l.name)).toEqual(['Local', 'Serveur']);
    expect(lures.find((l) => l.name === 'Local')?.pending).toBe(true);
  });

  it('en ligne : création directe sur le serveur', async () => {
    const created = await createUserLure(USER, { name: 'En ligne', size: '3', color: null, notes: null });
    expect(created?.pending).toBeUndefined();
    expect(serverLures()).toHaveLength(1);
  });

  it('refus explicite du serveur : null (l\'écran affiche une erreur)', async () => {
    server.failures.push({
      table: 'user_lures', op: 'insert',
      result: { data: null, error: { message: 'value too long', code: '22001' }, status: 400 },
    });
    expect(await createUserLure(USER, { name: 'Trop long', size: null, color: null, notes: null })).toBeNull();
    expect(await getCachedLures(USER)).toEqual([]);
  });
});
