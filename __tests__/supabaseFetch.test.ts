import AsyncStorage from '@react-native-async-storage/async-storage';

import { isStateOnline, resetServerReachable } from '@/lib/net';
import {
  AUTH_STORAGE_KEY,
  SESSION_MISSING_MESSAGE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  readStoredAuthUser,
  supabase,
  supabaseFetch,
} from '@/lib/supabase';

const REST = `${SUPABASE_URL}/rest/v1/catches?select=*`;
const ok = () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response;

let fetchMock: jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetServerReachable();
  fetchMock = jest.fn(async () => ok());
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(async () => {
  await supabase.auth.stopAutoRefresh();
});

describe('client Supabase : garde « session absente »', () => {
  it('refuse une requête de données envoyée avec la clé anonyme', async () => {
    // C'est ce que fait supabase-js quand le jeton n'a pas pu être rafraîchi. Le
    // serveur répondrait « 0 ligne » sans erreur → le cache local serait écrasé.
    await expect(
      supabaseFetch(REST, { headers: new Headers({ Authorization: `Bearer ${SUPABASE_ANON_KEY}` }) }),
    ).rejects.toThrow(SESSION_MISSING_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse une requête de données sans en-tête d\'autorisation', async () => {
    await expect(supabaseFetch(REST, {})).rejects.toThrow(SESSION_MISSING_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('laisse passer une requête de données authentifiée', async () => {
    await supabaseFetch(REST, { headers: new Headers({ Authorization: 'Bearer jwt-utilisateur' }) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepte les en-têtes sous forme d\'objet simple', async () => {
    await supabaseFetch(REST, { headers: { authorization: 'Bearer jwt-utilisateur' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ne bloque pas l\'authentification (connexion, rafraîchissement du jeton)', async () => {
    await supabaseFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('protège aussi les appels RPC et l\'envoi de fichiers', async () => {
    const anon = { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } };
    await expect(supabaseFetch(`${SUPABASE_URL}/rest/v1/rpc/get_zone_catches`, { ...anon, method: 'POST' }))
      .rejects.toThrow(SESSION_MISSING_MESSAGE);
    await expect(supabaseFetch(`${SUPABASE_URL}/storage/v1/object/catch-media/u/c/p.jpg`, { ...anon, method: 'POST' }))
      .rejects.toThrow(SESSION_MISSING_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('via le client : une lecture sans session retourne une ERREUR, jamais une liste vide', async () => {
    const { data, error } = await supabase.from('catches').select('*');
    expect(data).toBeNull();
    expect(error?.message).toContain(SESSION_MISSING_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('client Supabase : délais', () => {
  /** fetch qui ne répond jamais, mais respecte l'annulation */
  const hangingFetch = () =>
    jest.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );

  it('abandonne une requête de données qui ne répond pas (signal faible)', async () => {
    jest.useFakeTimers();
    try {
      const hanging = hangingFetch();
      global.fetch = hanging as unknown as typeof fetch;
      const pending = supabaseFetch(REST, { headers: { Authorization: 'Bearer jwt' } });
      const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await jest.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('abandonne plus vite un rafraîchissement de jeton', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = hangingFetch() as unknown as typeof fetch;
      let settled = false;
      const pending = supabaseFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })
        .catch(() => { settled = true; });
      await jest.advanceTimersByTimeAsync(14_000);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1_500);
      await pending;
      expect(settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('respecte aussi l\'annulation demandée par l\'appelant', async () => {
    global.fetch = hangingFetch() as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = supabaseFetch(REST, { headers: { Authorization: 'Bearer jwt' }, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('une réponse du serveur prouve que le réseau fonctionne', async () => {
    const osSaysNoInternet = { isConnected: true, isInternetReachable: false };
    expect(isStateOnline(osSaysNoInternet)).toBe(false);
    await supabaseFetch(REST, { headers: { Authorization: 'Bearer jwt' } });
    expect(isStateOnline(osSaysNoInternet)).toBe(true);
  });
});

describe('client Supabase : identité locale', () => {
  it('la clé de stockage est celle que supabase-js utilisait déjà (sessions conservées)', () => {
    expect(SUPABASE_URL).toBe('https://qgkwbjnqzhcesxtucrvt.supabase.co');
    expect(AUTH_STORAGE_KEY).toBe('sb-qgkwbjnqzhcesxtucrvt-auth-token');
  });

  it('lit l\'utilisateur de la session persistée sans aucun appel réseau', async () => {
    await AsyncStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        access_token: 'expiré', refresh_token: 'r', expires_at: 1,
        user: { id: 'user-1', email: 'pecheur@example.com' },
      }),
    );
    expect(await readStoredAuthUser()).toEqual({ id: 'user-1', email: 'pecheur@example.com' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retourne null sans session ou si le stockage est illisible', async () => {
    expect(await readStoredAuthUser()).toBeNull();
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, 'pas du json');
    expect(await readStoredAuthUser()).toBeNull();
  });
});
