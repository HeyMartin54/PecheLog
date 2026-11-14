import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { server } from './helpers/fakeSupabase';

jest.mock('@/lib/supabase', () => require('./helpers/fakeSupabase'));

import {
  deleteTripFromHistory,
  endActiveTrip,
  loadActiveTrip,
  loadTripHistory,
  refreshTripsFromServer,
  saveActiveTrip,
  syncLocalTripsToSupabase,
  type Trip,
} from '@/lib/tripStorage';

const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };
const USER = 'user-1';
const trips = () => server.rows('trips');
const goOffline = () => net.__setState({ isConnected: false, isInternetReachable: false });
const goOnline = () => net.__setState({ isConnected: true, isInternetReachable: true });

function trip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    startedAt: '2026-06-01T08:00:00.000Z',
    lakes: [{ name: 'Lac Test', targetSpecies: ['Doré jaune'] }],
    companions: [],
    luresSelected: [],
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  server.reset();
  net.__reset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await syncLocalTripsToSupabase(); // laisse finir un éventuel envoi en arrière-plan
  jest.restoreAllMocks();
});

describe('voyages : fonctionnement sans réseau', () => {
  it('démarrer un voyage hors-ligne est immédiat et ne contacte pas le serveur', async () => {
    goOffline();
    await saveActiveTrip(trip('t1'));
    expect((await loadActiveTrip())?.id).toBe('t1');
    await syncLocalTripsToSupabase();
    expect(server.log).toEqual([]);
  });

  it('lire le voyage actif ne fait jamais de requête (le formulaire de prise en dépend)', async () => {
    await saveActiveTrip(trip('t1'));
    await syncLocalTripsToSupabase();
    server.log.length = 0;
    await loadActiveTrip();
    await loadTripHistory();
    expect(server.log).toEqual([]);
  });

  it('un voyage créé hors-ligne est envoyé au retour du réseau', async () => {
    goOffline();
    await saveActiveTrip(trip('t1'));
    await syncLocalTripsToSupabase();
    expect(trips()).toHaveLength(0);

    goOnline();
    expect(await syncLocalTripsToSupabase()).toBe(true);
    expect(trips()).toHaveLength(1);
    expect(trips()[0]).toMatchObject({ id: 't1', user_id: USER, ended_at: null });
  });

  it('une fois à jour, plus aucune requête d\'envoi', async () => {
    await saveActiveTrip(trip('t1'));
    await syncLocalTripsToSupabase();
    const before = server.log.length;
    await syncLocalTripsToSupabase();
    await syncLocalTripsToSupabase();
    expect(server.log.length).toBe(before);
  });
});

describe('voyages : réconciliation avec le serveur', () => {
  it('régression : un voyage terminé hors-ligne ne « ressuscite » pas', async () => {
    await saveActiveTrip(trip('t1'));
    await syncLocalTripsToSupabase();
    expect(trips()[0].ended_at).toBeNull();

    goOffline();
    await endActiveTrip();
    expect(await loadActiveTrip()).toBeNull();
    expect((await loadTripHistory())[0].endedAt).toBeDefined();

    goOnline();
    // Le serveur croit encore le voyage actif : la réconciliation doit d'abord
    // pousser la fin du voyage, pas rétablir l'état du serveur.
    const result = await refreshTripsFromServer();

    expect(result?.active).toBeNull();
    expect(result?.history.map((t) => t.id)).toEqual(['t1']);
    expect(trips()[0].ended_at).not.toBeNull();
    expect(await loadActiveTrip()).toBeNull();
  });

  it('une suppression hors-ligne est rejouée et le voyage ne revient pas', async () => {
    await saveActiveTrip(trip('t1'));
    await endActiveTrip();
    await syncLocalTripsToSupabase();
    expect(trips()).toHaveLength(1);

    goOffline();
    await deleteTripFromHistory('t1');
    expect(await loadTripHistory()).toEqual([]);

    goOnline();
    const result = await refreshTripsFromServer();
    expect(trips()).toHaveLength(0);
    expect(result?.history).toEqual([]);
  });

  it('récupère un voyage démarré sur un autre appareil', async () => {
    trips().push({
      id: 'autre-appareil', user_id: USER, started_at: '2026-06-02T08:00:00.000Z', ended_at: null,
      lakes: [], companions: ['Paul'], lures_selected: [], notes: null,
    });
    await AsyncStorage.setItem('@pechelog_trips_dirty', '0');

    const result = await refreshTripsFromServer();

    expect(result?.active?.id).toBe('autre-appareil');
    expect((await loadActiveTrip())?.companions).toEqual(['Paul']);
  });

  it('serveur injoignable : null, et l\'état local reste valide', async () => {
    await saveActiveTrip(trip('t1'));
    await syncLocalTripsToSupabase();
    server.online = false;
    await AsyncStorage.setItem('@pechelog_trips_dirty', '1');

    expect(await refreshTripsFromServer()).toBeNull();
    expect((await loadActiveTrip())?.id).toBe('t1');
  });

  it('installation existante : un voyage terminé ailleurs n\'est pas ré-ouvert', async () => {
    // État laissé par une ancienne version : voyage actif local, pas d'indicateur
    await AsyncStorage.setItem('@pechelog_active_trip', JSON.stringify(trip('t1')));
    // …alors que le serveur sait qu'il a été terminé sur un autre appareil
    trips().push({
      id: 't1', user_id: USER, started_at: '2026-06-01T08:00:00.000Z', ended_at: '2026-06-01T18:00:00.000Z',
      lakes: [], companions: [], lures_selected: [], notes: null,
    });

    const result = await refreshTripsFromServer();

    expect(trips()[0].ended_at).toBe('2026-06-01T18:00:00.000Z'); // pas écrasé
    expect(result?.active).toBeNull();
    expect(await loadActiveTrip()).toBeNull();
  });

  it('une modification faite pendant l\'envoi est poussée aussi', async () => {
    await saveActiveTrip(trip('t1', { notes: 'v1' }));
    let edited = false;
    server.onRequest = async (table, op) => {
      if (table === 'trips' && op === 'upsert' && !edited) {
        edited = true;
        await AsyncStorage.setItem('@pechelog_active_trip', JSON.stringify(trip('t1', { notes: 'v2' })));
      }
    };
    expect(await syncLocalTripsToSupabase()).toBe(true);
    expect(trips()[0].notes).toBe('v2');
  });
});
