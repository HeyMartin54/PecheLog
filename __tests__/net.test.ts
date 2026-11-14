import NetInfo from '@react-native-community/netinfo';

import {
  isNetworkError,
  isOnline,
  isStateConnected,
  isStateOnline,
  mayReachNetwork,
  noteServerReachable,
  resetServerReachable,
  withTimeout,
} from '@/lib/net';

const net = NetInfo as unknown as { __setState: (s: object) => void; __reset: () => void };

beforeEach(() => {
  net.__reset();
  resetServerReachable();
});

describe('réseau : « en ligne » vs « un réseau est présent »', () => {
  it('connecté et joignable → en ligne', () => {
    expect(isStateOnline({ isConnected: true, isInternetReachable: true })).toBe(true);
  });

  it('joignabilité inconnue → on tente (en ligne)', () => {
    expect(isStateOnline({ isConnected: true, isInternetReachable: null })).toBe(true);
  });

  it('1 barre / wifi sans internet → PAS en ligne, mais un réseau est présent', () => {
    const weak = { isConnected: true, isInternetReachable: false };
    expect(isStateOnline(weak)).toBe(false);
    expect(isStateConnected(weak)).toBe(true); // la synchro tentera quand même
  });

  it('mode avion → ni l\'un ni l\'autre', () => {
    const off = { isConnected: false, isInternetReachable: false };
    expect(isStateOnline(off)).toBe(false);
    expect(isStateConnected(off)).toBe(false);
  });

  it('si le serveur vient de répondre, la sonde de l\'OS est ignorée', () => {
    // Certains réseaux bloquent la sonde de connectivité : l'OS annonce « pas
    // d'internet » alors que le serveur répond. Une réponse fait foi.
    const state = { isConnected: true, isInternetReachable: false };
    expect(isStateOnline(state)).toBe(false);
    noteServerReachable();
    expect(isStateOnline(state)).toBe(true);
  });

  it('isOnline / mayReachNetwork lisent l\'état courant', async () => {
    net.__setState({ isConnected: true, isInternetReachable: false });
    expect(await isOnline()).toBe(false);
    expect(await mayReachNetwork()).toBe(true);
    net.__setState({ isConnected: false, isInternetReachable: false });
    expect(await mayReachNetwork()).toBe(false);
  });
});

describe('réseau : utilitaires', () => {
  it('withTimeout rejette après le délai', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'test')).rejects.toThrow('Timeout test');
  });

  it('withTimeout laisse passer une réponse rapide', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it('reconnaît les erreurs réseau, pas les refus du serveur', () => {
    expect(isNetworkError({ message: 'TypeError: Network request failed' })).toBe(true);
    expect(isNetworkError({ message: 'AbortError: Aborted' })).toBe(true);
    expect(isNetworkError(new Error('Timeout getSession (8000 ms)'))).toBe(true);
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isNetworkError({ message: 'duplicate key value', code: '23505' })).toBe(false);
    expect(isNetworkError({ message: 'new row violates row-level security policy', code: '42501' })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});
