import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  OFFLINE_QUEUE_KEY,
  enqueueCatch,
  getQueue,
  getQueueSummary,
  getQueuedTripCatchCount,
  queueItemToCatch,
  removeQueueItem,
  subscribeQueue,
  updateQueueItem,
} from '@/lib/offlineQueue';
import type { CatchPayload } from '@/lib/types';
import { isUuid } from '@/lib/uuid';

function payload(overrides: Partial<CatchPayload> = {}): CatchPayload {
  return {
    user_id: 'user-1',
    map_id: null,
    trip_id: null,
    species: 'Doré jaune',
    lure: null,
    latitude: 47.5,
    longitude: -71.5,
    lake_name: null,
    depth_meters: null,
    depth_source: null,
    temperature_c: null,
    wind_speed_kmh: null,
    wind_direction_deg: null,
    speed_kmh: null,
    weather_conditions: null,
    size_category: 'medium',
    weight_lbs: null,
    length_inches: null,
    notes: null,
    caught_at: '2026-06-01T12:00:00.000Z',
    local_id: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('file d\'attente : enregistrement', () => {
  it('attribue un UUID à la prise et le conserve tel quel', async () => {
    const item = await enqueueCatch({ payload: payload() });
    expect(isUuid(item.id)).toBe(true);
    expect(item.payload.id).toBe(item.id);

    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(item.id);
  });

  it('respecte l\'UUID fourni par le formulaire', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const item = await enqueueCatch({ payload: payload({ id }) });
    expect(item.id).toBe(id);
  });

  it('ré-enregistrer la même prise ne crée pas de doublon', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    await enqueueCatch({ payload: payload({ id, notes: 'v1' }) });
    await enqueueCatch({ payload: payload({ id, notes: 'v2' }) });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.notes).toBe('v2');
  });

  it('LÈVE une erreur si l\'écriture échoue (pas de faux « enregistré »)', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(enqueueCatch({ payload: payload() })).rejects.toThrow('disk full');
    // et la file reste utilisable ensuite
    await enqueueCatch({ payload: payload() });
    expect(await getQueue()).toHaveLength(1);
  });
});

describe('file d\'attente : écritures concurrentes', () => {
  it('ne perd aucune prise quand 25 enregistrements arrivent en même temps', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => enqueueCatch({ payload: payload({ notes: `prise ${i}` }) })),
    );
    const queue = await getQueue();
    expect(queue).toHaveLength(25);
    expect(new Set(queue.map((i) => i.id)).size).toBe(25);
  });

  it('régression : une prise ajoutée PENDANT une synchronisation n\'est pas écrasée', async () => {
    // Avant : la synchro lisait la file, travaillait, puis réécrivait SA copie
    // → toute prise ajoutée entre-temps disparaissait.
    const a = await enqueueCatch({ payload: payload({ notes: 'A' }) });

    const snapshotLuParLaSynchro = await getQueue(); // la synchro démarre
    expect(snapshotLuParLaSynchro).toHaveLength(1);

    const b = await enqueueCatch({ payload: payload({ notes: 'B' }) }); // saisie pendant l'envoi

    await removeQueueItem(a.id); // la synchro termine A : elle retire A, et seulement A

    const queue = await getQueue();
    expect(queue.map((i) => i.id)).toEqual([b.id]);
  });

  it('mises à jour et retraits entremêlés restent cohérents', async () => {
    const items = await Promise.all(
      Array.from({ length: 10 }, (_, i) => enqueueCatch({ payload: payload({ notes: String(i) }) })),
    );
    await Promise.all([
      ...items.slice(0, 5).map((i) => removeQueueItem(i.id)),
      ...items.slice(5).map((i) => updateQueueItem(i.id, { attempts: 3, lastError: 'x' })),
      enqueueCatch({ payload: payload({ notes: 'nouvelle' }) }),
    ]);
    const queue = await getQueue();
    expect(queue).toHaveLength(6);
    expect(queue.filter((i) => i.attempts === 3)).toHaveLength(5);
  });

  it('une mise à jour ne peut pas changer l\'identité d\'un élément', async () => {
    const item = await enqueueCatch({ payload: payload() });
    const updated = await updateQueueItem(item.id, (current) => ({
      ...current,
      id: 'autre',
      payload: { ...current.payload, id: 'autre' },
    }));
    expect(updated?.id).toBe(item.id);
    expect(updated?.payload.id).toBe(item.id);
  });
});

describe('file d\'attente : anciennes données', () => {
  it('migre l\'ancien format et FIGE l\'UUID attribué', async () => {
    // Format écrit par les versions précédentes : pas d'id, local_id seulement
    await AsyncStorage.setItem(
      OFFLINE_QUEUE_KEY,
      JSON.stringify([
        { payload: { ...payload(), local_id: 'local_1700000000000' }, media: [{ uri: 'file:///a.jpg', type: 'photo' }] },
        { payload: payload({ species: 'Brochet' }), media: [] },
      ]),
    );

    const first = await getQueue();
    expect(first).toHaveLength(2);
    expect(first.every((i) => isUuid(i.id) && i.payload.id === i.id)).toBe(true);
    expect(isUuid(first[0].media[0].id)).toBe(true);

    // L'identifiant doit être le même à chaque lecture : c'est lui qui empêche
    // les doublons si l'envoi est rejoué.
    const second = await getQueue();
    expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id));
    expect(second[0].media[0].id).toBe(first[0].media[0].id);
  });

  it('met de côté une file illisible au lieu de la détruire', async () => {
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, '{ceci n\'est pas du json');
    expect(await getQueue()).toEqual([]);

    const keys = await AsyncStorage.getAllKeys();
    const backup = keys.find((k) => k.startsWith(`${OFFLINE_QUEUE_KEY}_corrupt_`));
    expect(backup).toBeDefined();
    expect(await AsyncStorage.getItem(backup as string)).toBe('{ceci n\'est pas du json');

    await enqueueCatch({ payload: payload() }); // la file fonctionne de nouveau
    expect(await getQueue()).toHaveLength(1);
  });
});

describe('file d\'attente : résumé et notifications', () => {
  it('résume par utilisateur', async () => {
    const mine = await enqueueCatch({ payload: payload() });
    await enqueueCatch({ payload: payload(), media: [{ uri: 'file:///p.jpg', type: 'photo' }] });
    await enqueueCatch({ payload: payload({ user_id: 'user-2' }) });
    await updateQueueItem(mine.id, { blocked: true, lastError: 'refusé', lastAttemptAt: Date.now() });

    const summary = await getQueueSummary('user-1');
    expect(summary).toMatchObject({
      total: 2,
      pendingCatches: 2,
      pendingMedia: 1,
      blocked: 1,
      otherUsers: 1,
      lastError: 'refusé',
    });
    expect((await getQueueSummary(null)).total).toBe(0);
  });

  it('compte les prises en attente d\'un voyage', async () => {
    await enqueueCatch({ payload: payload({ trip_id: 'trip_1' }) });
    await enqueueCatch({ payload: payload({ trip_id: 'trip_1' }) });
    await enqueueCatch({ payload: payload({ trip_id: 'trip_2' }) });
    expect(await getQueuedTripCatchCount('trip_1')).toBe(2);
  });

  it('distingue un ajout des autres modifications', async () => {
    const events: string[] = [];
    const unsubscribe = subscribeQueue((e) => events.push(e));
    const item = await enqueueCatch({ payload: payload() });
    await updateQueueItem(item.id, { attempts: 1 });
    await removeQueueItem(item.id);
    unsubscribe();
    expect(events).toEqual(['enqueue', 'update', 'update']);
  });

  it('présente un élément de file comme une prise « en attente »', async () => {
    const item = await enqueueCatch({ payload: payload({ lake_name: 'Lac Test' }), media: [{ uri: 'x', type: 'photo' }] });
    const view = queueItemToCatch(item);
    expect(view).toMatchObject({ id: item.id, species: 'Doré jaune', lake_name: 'Lac Test', pending: true, pending_media: 1 });
  });
});
