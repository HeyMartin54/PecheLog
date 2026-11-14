/* eslint-env jest */

// ─── Stockage local : implémentation en mémoire fournie par la bibliothèque ───
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// ─── Réseau : état pilotable depuis les tests (NetInfo.__setState) ────────────
jest.mock('@react-native-community/netinfo', () => {
  let state = { type: 'wifi', isConnected: true, isInternetReachable: true, details: null };
  const listeners = new Set();
  const api = {
    fetch: jest.fn(() => Promise.resolve(state)),
    addEventListener: jest.fn((listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    }),
    /** Change l'état réseau et prévient les abonnés, comme le ferait l'OS. */
    __setState(next) {
      state = { ...state, ...next };
      listeners.forEach((l) => l(state));
    },
    __getState() {
      return state;
    },
    __reset() {
      state = { type: 'wifi', isConnected: true, isInternetReachable: true, details: null };
      listeners.clear();
    },
  };
  return { __esModule: true, default: api, ...api };
});

// ─── Système de fichiers : fichiers en mémoire ───────────────────────────────
jest.mock('expo-file-system/legacy', () => {
  const files = new Set();
  const dirs = new Set();
  return {
    __esModule: true,
    documentDirectory: 'file:///documents/',
    cacheDirectory: 'file:///cache/',
    FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
    getInfoAsync: jest.fn(async (uri) => ({ exists: files.has(uri) || dirs.has(uri), uri })),
    makeDirectoryAsync: jest.fn(async (uri) => { dirs.add(uri); }),
    copyAsync: jest.fn(async ({ from, to }) => {
      if (!files.has(from)) throw new Error(`ENOENT ${from}`);
      files.add(to);
    }),
    deleteAsync: jest.fn(async (uri) => { files.delete(uri); }),
    createUploadTask: jest.fn(),
    /** Tests : déclare un fichier existant. */
    __addFile(uri) { files.add(uri); },
    __hasFile(uri) { return files.has(uri); },
    __reset() { files.clear(); dirs.clear(); },
  };
});
