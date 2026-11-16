// Envoi NATIF des photos/vidéos (branche iOS / Android de lib/uploadMedia.ts).
// Le module système de fichiers est simulé : on vérifie la requête construite
// et la façon dont chaque réponse du Storage est interprétée.

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { server } from './helpers/fakeSupabase';

jest.mock('@/lib/supabase', () => require('./helpers/fakeSupabase'));

import { UploadError, contentTypeForPath, uploadMediaFile } from '@/lib/uploadMedia';

const createUploadTask = FileSystem.createUploadTask as unknown as jest.Mock;
const LOCAL = 'file:///documents/offline_media/11111111-1111-4111-8111-111111111111.jpg';

function respondWith(status: number, body = '') {
  const cancelAsync = jest.fn(async () => undefined);
  createUploadTask.mockImplementation(() => ({ uploadAsync: async () => ({ status, body, headers: {} }), cancelAsync }));
  return cancelAsync;
}

beforeEach(() => {
  server.reset();
  createUploadTask.mockReset();
});

it('ces tests exercent bien la branche mobile', () => {
  expect(Platform.OS).not.toBe('web');
});

describe('envoi natif : requête construite', () => {
  it('envoie le fichier en binaire vers le bon objet du Storage, avec le jeton de l\'utilisateur', async () => {
    respondWith(200, '{"Key":"catch-media/x"}');

    const { storagePath } = await uploadMediaFile(LOCAL, 'user-1', 'catch-1', 'photo', 'media-1');

    expect(storagePath).toBe('user-1/catch-1/media-1.jpg');
    expect(createUploadTask).toHaveBeenCalledTimes(1);
    const [url, fileUri, options] = createUploadTask.mock.calls[0];
    expect(url).toBe('https://fake.supabase.co/storage/v1/object/catch-media/user-1/catch-1/media-1.jpg');
    expect(fileUri).toBe(LOCAL);
    expect(options.httpMethod).toBe('POST');
    expect(options.uploadType).toBe(FileSystem.FileSystemUploadType.BINARY_CONTENT);
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer jwt',
      apikey: 'anon-key',
      'Content-Type': 'image/jpeg',
      'x-upsert': 'false',
    });
  });

  it('le chemin est déterministe : rejouer l\'envoi vise le même objet', async () => {
    respondWith(200);
    const first = await uploadMediaFile(LOCAL, 'user-1', 'catch-1', 'photo', 'media-1');
    const second = await uploadMediaFile(LOCAL, 'user-1', 'catch-1', 'photo', 'media-1');
    expect(second.storagePath).toBe(first.storagePath);
  });

  it('conserve l\'extension et le type d\'une vidéo iOS (.mov)', async () => {
    respondWith(200);
    const { storagePath } = await uploadMediaFile('file:///documents/offline_media/v.mov', 'u', 'c', 'video', 'm');
    expect(storagePath).toBe('u/c/m.mov');
    expect(createUploadTask.mock.calls[0][2].headers['Content-Type']).toBe('video/quicktime');
    expect(contentTypeForPath('x.mp4', 'application/octet-stream')).toBe('video/mp4');
  });
});

describe('envoi natif : interprétation des réponses', () => {
  it('« Duplicate » = l\'objet existe déjà = envoi déjà réussi', async () => {
    respondWith(400, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}');
    await expect(uploadMediaFile(LOCAL, 'u', 'c', 'photo', 'm')).resolves.toEqual({ storagePath: 'u/c/m.jpg' });
  });

  it.each([
    [401, 'jeton expiré'],
    [403, 'jeton refusé'],
    [429, 'trop de requêtes'],
    [500, 'erreur serveur'],
    [503, 'service indisponible'],
  ])('HTTP %i (%s) → à réessayer plus tard', async (status) => {
    respondWith(status, 'erreur');
    const error = await uploadMediaFile(LOCAL, 'u', 'c', 'photo', 'm').catch((e) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect(error.transient).toBe(true);
    expect(error.status).toBe(status);
  });

  it('HTTP 413 (fichier trop gros) → refus définitif', async () => {
    respondWith(413, 'Payload too large');
    const error = await uploadMediaFile(LOCAL, 'u', 'c', 'photo', 'm').catch((e) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect(error.transient).toBe(false);
  });

  it('coupure réseau pendant l\'envoi → à réessayer', async () => {
    createUploadTask.mockImplementation(() => ({
      uploadAsync: async () => { throw new Error('Network request failed'); },
      cancelAsync: jest.fn(),
    }));
    const error = await uploadMediaFile(LOCAL, 'u', 'c', 'photo', 'm').catch((e) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect(error.transient).toBe(true);
  });

  it('sans session : rien n\'est envoyé, à réessayer', async () => {
    server.sessionUserId = null;
    const error = await uploadMediaFile(LOCAL, 'u', 'c', 'photo', 'm').catch((e) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect(error.transient).toBe(true);
    expect(createUploadTask).not.toHaveBeenCalled();
  });

  it('un envoi qui ne finit pas est ANNULÉ après 2 minutes (il ne peut plus bloquer la synchro)', async () => {
    jest.useFakeTimers();
    try {
      let finish: (value: undefined) => void = () => undefined;
      const cancelAsync = jest.fn(async () => { finish(undefined); });
      createUploadTask.mockImplementation(() => ({
        uploadAsync: () => new Promise<undefined>((resolve) => { finish = resolve; }),
        cancelAsync,
      }));

      const pending = uploadMediaFile(LOCAL, 'u', 'c', 'photo', 'm').catch((e) => e);
      await jest.advanceTimersByTimeAsync(119_000);
      expect(cancelAsync).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(2_000);

      const error = await pending;
      expect(cancelAsync).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(UploadError);
      expect(error.transient).toBe(true);
      expect(error.message).toContain('Timeout');
    } finally {
      jest.useRealTimers();
    }
  });
});
