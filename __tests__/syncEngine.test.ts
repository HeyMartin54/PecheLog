import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { server } from './helpers/fakeSupabase';

jest.mock('@/lib/supabase', () => require('./helpers/fakeSupabase'));
jest.mock('@/lib/uploadMedia', () => ({
  UploadError: class UploadError extends Error {},
  uploadMediaFile: jest.fn(),
}));

import { getCatchStoreSnapshot, resetCatchStoreForTests, setCatchStoreUser } from '@/lib/catchStore';
import { enqueueCatch, getQueue } from '@/lib/offlineQueue';
import {
  getSyncEngineState,
  setSyncIdentity,
  startSyncEngine,
  stopSyncEngine,
  syncNow,
} from '@/lib/syncEngine';
import type { CatchPayload } from '@/lib/types';

const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };
const USER = 'user-1';
const catches = () => server.rows('catches');

function payload(overrides: Partial<CatchPayload> = {}): CatchPayload {
  return {
    user_id: USER, map_id: null, trip_id: null, species: 'Doré jaune', lure: null,
    latitude: 47.5, longitude: -71.5, lake_name: null, depth_meters: null, depth_source: null,
    temperature_c: 18, wind_speed_kmh: 5, wind_direction_deg: 90, speed_kmh: null,
    weather_conditions: 'Ensoleillé', size_category: null, weight_lbs: null, length_inches: null,
    notes: null, caught_at: '2026-06-01T12:00:00.000Z', local_id: null,
    ...overrides,
  };
}

/** Laisse passer le temps simulé ET les promesses en attente. */
const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

let appStateHandler: ((status: string) => void) | null = null;

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  server.reset();
  net.__reset();
  resetCatchStoreForTests();
  await setCatchStoreUser(USER);
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (s: string) => void) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as never);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  // les voyages n'ont rien à pousser dans ces tests
  await AsyncStorage.setItem('@pechelog_trips_dirty', '0');
});

afterEach(async () => {
  stopSyncEngine();
  setSyncIdentity(null, null);
  await advance(1000);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('moteur de synchronisation : déclencheurs', () => {
  it('au démarrage, envoie ce qui attendait d\'une session précédente', async () => {
    await enqueueCatch({ payload: payload() });
    setSyncIdentity(USER, USER);
    startSyncEngine();

    await advance(1000);

    expect(catches()).toHaveLength(1);
    expect(await getQueue()).toEqual([]);
  });

  it('une prise enregistrée en ligne part toute seule vers le serveur', async () => {
    setSyncIdentity(USER, USER);
    startSyncEngine();
    await advance(1000);

    await enqueueCatch({ payload: payload() });
    await advance(1000);

    expect(catches()).toHaveLength(1);
    expect(getCatchStoreSnapshot().pendingCount).toBe(0);
  });

  it('RÉGRESSION : au retour du réseau, la synchronisation part même si l\'OS n\'a pas encore validé l\'accès internet', async () => {
    // Séquence réelle sur Android : (1) aucun réseau ; (2) réseau présent,
    // internet « non validé » ; (3) quelques secondes plus tard, validé.
    // L'ancienne version tentait à l'étape 2, abandonnait, et ne réessayait
    // JAMAIS : les prises restaient dans le téléphone.
    net.__setState({ isConnected: false, isInternetReachable: false });
    setSyncIdentity(USER, USER);
    startSyncEngine();
    await enqueueCatch({ payload: payload({ notes: 'saisie hors-ligne' }) });
    await advance(2000);
    expect(catches()).toHaveLength(0);
    expect(await getQueue()).toHaveLength(1);

    net.__setState({ isConnected: true, isInternetReachable: false }); // étape 2
    await advance(1000);

    expect(catches()).toHaveLength(1);
    expect(await getQueue()).toEqual([]);
  });

  it('relance aussi quand l\'accès internet est validé après coup', async () => {
    net.__setState({ isConnected: true, isInternetReachable: false });
    server.online = false; // le réseau est là mais rien ne passe encore
    setSyncIdentity(USER, USER);
    startSyncEngine();
    await enqueueCatch({ payload: payload() });
    await advance(1000);
    expect(catches()).toHaveLength(0);

    server.online = true;
    net.__setState({ isConnected: true, isInternetReachable: true }); // validé
    await advance(1000);

    expect(catches()).toHaveLength(1);
  });

  it('réessaie tout seul, sans aucun événement réseau, tant qu\'il reste des prises', async () => {
    server.online = false; // « connecté », mais le serveur ne répond pas
    setSyncIdentity(USER, USER);
    startSyncEngine();
    await enqueueCatch({ payload: payload() });
    await advance(2000);
    expect(catches()).toHaveLength(0);
    expect(await getQueue()).toHaveLength(1);

    server.online = true; // le signal revient, sans que l'OS ne prévienne
    await advance(16_000); // 1er réessai automatique à 15 s

    expect(catches()).toHaveLength(1);
    expect(await getQueue()).toEqual([]);
  });

  it('espace les réessais (15 s, 30 s, 1 min…) au lieu de marteler le serveur', async () => {
    server.online = false;
    setSyncIdentity(USER, USER);
    startSyncEngine();
    await enqueueCatch({ payload: payload() });
    await advance(1000);
    const afterFirst = server.count('catches', 'insert');
    expect(afterFirst).toBe(1);

    await advance(15_500); // +15 s → 2e tentative
    expect(server.count('catches', 'insert')).toBe(2);
    await advance(15_500); // +15 s : trop tôt (prochain essai à +30 s)
    expect(server.count('catches', 'insert')).toBe(2);
    await advance(15_500);
    expect(server.count('catches', 'insert')).toBe(3);
  });

  it('synchronise au retour de l\'app au premier plan', async () => {
    server.online = false;
    setSyncIdentity(USER, USER);
    startSyncEngine();
    await enqueueCatch({ payload: payload() });
    await advance(1000);
    expect(catches()).toHaveLength(0);

    server.online = true;
    expect(appStateHandler).not.toBeNull();
    appStateHandler?.('active');
    await advance(1000);

    expect(catches()).toHaveLength(1);
  });

  it('une prise saisie pendant un envoi déclenche un nouveau passage', async () => {
    setSyncIdentity(USER, USER);
    startSyncEngine();
    await advance(1000);
    server.latencyMs = 300;

    await enqueueCatch({ payload: payload({ notes: 'A' }) });
    await advance(500); // l'envoi de A est en cours
    await enqueueCatch({ payload: payload({ notes: 'B' }) });
    await advance(3000);

    expect(catches()).toHaveLength(2);
    expect(await getQueue()).toEqual([]);
  });
});

describe('moteur de synchronisation : session', () => {
  it('sans session, les prises attendent ; elles partent dès qu\'elle revient', async () => {
    // Jeton expiré pendant la sortie : utilisateur connu, session pas restaurée
    server.sessionUserId = null;
    setSyncIdentity(null, USER);
    startSyncEngine();
    await enqueueCatch({ payload: payload() });
    await advance(1000);
    expect(catches()).toHaveLength(0);
    expect(getSyncEngineState().lastResult?.status).toBe('no-session');

    server.sessionUserId = USER; // Supabase a rafraîchi le jeton
    setSyncIdentity(USER, USER);
    await advance(1000);

    expect(catches()).toHaveLength(1);
  });

  it('demande la restauration de la session dès qu\'un réseau est là', async () => {
    // L'app ne connaît pas encore la session (setSyncIdentity(null, …)) mais
    // le serveur peut la restaurer : le moteur n'attend pas un autre signal.
    setSyncIdentity(null, USER);
    startSyncEngine();
    await enqueueCatch({ payload: payload() });
    await advance(1000);
    expect(catches()).toHaveLength(1);
  });

  it('personne de connecté : aucune activité', async () => {
    server.sessionUserId = null;
    setSyncIdentity(null, null);
    startSyncEngine();
    await advance(60_000);
    expect(server.log).toEqual([]);
  });
});

describe('moteur de synchronisation : bouton « Synchroniser maintenant »', () => {
  it('rapporte « hors-ligne » sans rien toucher', async () => {
    await enqueueCatch({ payload: payload() });
    net.__setState({ isConnected: false, isInternetReachable: false });
    setSyncIdentity(USER, USER);

    const pending = syncNow();
    await advance(100);
    const result = await pending;

    expect(result).toMatchObject({ status: 'offline', synced: 0, remaining: 1 });
    expect(await getQueue()).toHaveLength(1);
  });

  it('rapporte le résultat réel d\'un envoi réussi', async () => {
    await enqueueCatch({ payload: payload() });
    await enqueueCatch({ payload: payload() });
    setSyncIdentity(USER, USER);

    const pending = syncNow();
    await advance(100);
    const result = await pending;

    expect(result).toMatchObject({ status: 'done', synced: 2, remaining: 0, blocked: 0 });
    expect(getSyncEngineState().running).toBe(false);
  });

  it('rapporte un envoi incomplet quand le serveur ne répond pas', async () => {
    await enqueueCatch({ payload: payload() });
    server.online = false;
    setSyncIdentity(USER, USER);

    const pending = syncNow();
    await advance(100);
    const result = await pending;

    // L'écran Réglages affiche alors « Envoi incomplet … nouvel essai automatique »
    expect(result).toMatchObject({ status: 'interrupted', synced: 0, remaining: 1, blocked: 0 });
    expect(await getQueue()).toHaveLength(1);
  });
});
