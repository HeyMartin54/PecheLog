// ─── Faux serveur Supabase pour les essais dans un navigateur ────────────────
// Imite ce dont l'app dépend : authentification (rafraîchissement du jeton),
// PostgREST (lecture / insertion / upsert / mise à jour / suppression avec les
// règles RLS « chacun ses lignes ») et Storage. Permet d'injecter des pannes :
// serveur muet, réponse perdue APRÈS écriture, jeton refusé.
//
// Aucune donnée réelle : tout est en mémoire et disparaît à l'arrêt.
//
// Usage : node e2e/mock-supabase.mjs   (port 54321, ou MOCK_PORT)

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 54321);
export const ANON_KEY = 'test-anon-key';

const OWNER_COLUMN = {
  catches: 'user_id',
  trips: 'user_id',
  user_lures: 'user_id',
  profiles: 'id',
  shared_zones: 'owner_id',
  zone_shares: 'shared_with',
};

function freshState() {
  return {
    tables: { catches: [], trips: [], user_lures: [], profiles: [], catch_media: [], shared_zones: [], zone_shares: [] },
    storage: [],
    refreshTokens: {}, // refresh_token → userId
    log: [], // requêtes reçues
    config: {
      down: false, // coupe la connexion sans répondre (réseau mort)
      hang: false, // ne répond jamais (signal faible)
      latencyMs: 0,
      // Réponse perdue : la prochaine prise insérée EST écrite, mais sa réponse et
      // celle des (N-1) tentatives suivantes pour la même prise n'arrivent jamais.
      dropAfterInsert: 0,
      refreshMode: 'ok', // 'ok' | 'invalid' (jeton révoqué)
    },
    dropsLeft: {}, // id de prise → réponses encore à perdre
  };
}
let state = freshState();

// ─── Jetons (faux JWT : structure valide, pas de signature réelle) ───────────
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function makeAccessToken(userId, expiresAt) {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: userId, role: 'authenticated', exp: expiresAt })}.sig`;
}
function readToken(authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { role: 'none' };
  if (token === ANON_KEY) return { role: 'anon' };
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (payload.exp * 1000 < Date.now()) return { role: 'expired' };
    return { role: 'authenticated', userId: payload.sub };
  } catch {
    return { role: 'invalid' };
  }
}
function makeSession(userId) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const refreshToken = `refresh-${randomUUID()}`;
  state.refreshTokens[refreshToken] = userId;
  return {
    access_token: makeAccessToken(userId, expiresAt),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user: makeUser(userId),
  };
}
function makeUser(userId) {
  return {
    id: userId, aud: 'authenticated', role: 'authenticated', email: `${userId}@example.test`,
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
  };
}

// ─── Utilitaires HTTP ────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Location',
  'Access-Control-Max-Age': '600',
};
function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
const pgError = (code, message) => ({ code, message, details: null, hint: null });

// ─── Filtres PostgREST (sous-ensemble utilisé par l'app) ─────────────────────
function buildFilter(params) {
  const tests = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
    const value = String(raw);
    if (value.startsWith('eq.')) { const v = value.slice(3); tests.push((r) => String(r[key]) === v); }
    else if (value === 'is.null') tests.push((r) => r[key] == null);
    else if (value === 'not.is.null') tests.push((r) => r[key] != null);
    else if (value.startsWith('in.(')) {
      const list = value.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''));
      tests.push((r) => list.includes(String(r[key])));
    }
  }
  return (row) => tests.every((t) => t(row));
}
function applyOrder(rows, order) {
  if (!order) return rows;
  const [column, direction] = order.split('.');
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => sign * String(a[column] ?? '').localeCompare(String(b[column] ?? '')));
}

async function handleRest(req, res, url, auth) {
  const [, , , table, rpcName] = url.pathname.split('/'); // /rest/v1/<table>[/<fn>]
  const prefer = req.headers.prefer || '';
  const wantsObject = (req.headers.accept || '').includes('vnd.pgrst.object');

  if (auth.role === 'expired' || auth.role === 'invalid') {
    return send(res, 401, pgError('PGRST301', 'JWT expired'));
  }

  if (table === 'rpc') {
    await readBody(req);
    if (auth.role !== 'authenticated') return send(res, 401, pgError('42501', 'permission denied'));
    if (rpcName === 'get_zone_catches') return send(res, 200, []);
    return send(res, 404, pgError('PGRST202', `function ${rpcName} not found`));
  }

  if (!(table in state.tables)) return send(res, 404, pgError('PGRST205', `table ${table} not found`));
  const rows = state.tables[table];
  const ownerColumn = OWNER_COLUMN[table];
  // RLS : chacun ne voit / ne modifie que ses lignes. Un anonyme ne voit RIEN —
  // et, comme le vrai serveur, répond « 200 [] » sans erreur.
  const visible = (row) =>
    auth.role === 'authenticated' &&
    (table === 'catch_media'
      ? state.tables.catches.some((c) => c.id === row.catch_id && c.user_id === auth.userId)
      : row[ownerColumn] === auth.userId);
  const matches = buildFilter(url.searchParams);

  if (req.method === 'GET' || req.method === 'HEAD') {
    let result = applyOrder(rows.filter((r) => visible(r) && matches(r)), url.searchParams.get('order'));
    const total = result.length;
    const range = /^(\d+)-(\d+)$/.exec(req.headers.range || '');
    const offset = range ? Number(range[1]) : Number(url.searchParams.get('offset') || 0);
    const limit = range ? Number(range[2]) - Number(range[1]) + 1 : Number(url.searchParams.get('limit') || 0);
    if (offset) result = result.slice(offset);
    if (limit) result = result.slice(0, limit);
    const headers = { 'Content-Range': `${offset}-${offset + result.length - 1}/${total}` };
    if (req.method === 'HEAD') return send(res, 200, undefined, headers);
    if (wantsObject) {
      if (result.length !== 1) return send(res, 406, pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned'));
      return send(res, 200, result[0], headers);
    }
    return send(res, 200, result, headers);
  }

  const body = (await readBody(req)).toString() || 'null';
  const data = JSON.parse(body);

  if (req.method === 'POST') {
    if (auth.role !== 'authenticated') return send(res, 401, pgError('42501', 'new row violates row-level security policy'));
    const incoming = Array.isArray(data) ? data : [data];
    const upsert = prefer.includes('resolution=merge-duplicates');
    const written = [];
    for (const raw of incoming) {
      const row = { id: randomUUID(), created_at: new Date().toISOString(), ...raw };
      if (ownerColumn && table !== 'catch_media' && row[ownerColumn] !== auth.userId) {
        return send(res, 403, pgError('42501', 'new row violates row-level security policy'));
      }
      const index = rows.findIndex((r) => r.id === row.id);
      if (index !== -1) {
        if (table === 'catches' && state.dropsLeft[row.id] > 0) {
          state.dropsLeft[row.id] -= 1;
          state.log.push({ note: 'réponse perdue (nouvelle tentative)', id: row.id });
          return req.socket.destroy();
        }
        if (!upsert) {
          return send(res, 409, pgError('23505', `duplicate key value violates unique constraint "${table}_pkey"`));
        }
        rows[index] = { ...rows[index], ...raw };
        written.push(rows[index]);
      } else {
        rows.push(row);
        written.push(row);
      }
    }
    // Panne injectée : la ligne EST écrite, mais la réponse n'arrive jamais
    if (table === 'catches' && state.config.dropAfterInsert > 0) {
      const extra = state.config.dropAfterInsert - 1;
      state.config.dropAfterInsert = 0;
      written.forEach((w) => { state.dropsLeft[w.id] = extra; });
      state.log.push({ note: 'réponse perdue après insertion', id: written[0]?.id });
      return req.socket.destroy();
    }
    if (!prefer.includes('return=representation')) return send(res, 201, undefined);
    return send(res, 201, wantsObject ? written[0] : written);
  }

  if (req.method === 'PATCH' || req.method === 'DELETE') {
    if (auth.role !== 'authenticated') return send(res, 401, pgError('42501', 'permission denied'));
    const targets = rows.filter((r) => visible(r) && matches(r));
    if (req.method === 'PATCH') targets.forEach((r) => Object.assign(r, data));
    else state.tables[table] = rows.filter((r) => !targets.includes(r));
    if (!prefer.includes('return=representation')) return send(res, 204, undefined);
    if (wantsObject) {
      if (targets.length !== 1) return send(res, 406, pgError('PGRST116', 'no rows'));
      return send(res, 200, targets[0]);
    }
    return send(res, 200, targets);
  }

  return send(res, 405, pgError('405', 'method not allowed'));
}

async function handleAuth(req, res, url) {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const userId = state.refreshTokens[body.refresh_token];
    if (state.config.refreshMode === 'invalid' || !userId) {
      return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
    }
    delete state.refreshTokens[body.refresh_token];
    return send(res, 200, makeSession(userId));
  }
  if (url.pathname === '/auth/v1/user') {
    const auth = readToken(req.headers.authorization);
    if (auth.role !== 'authenticated') return send(res, 401, { code: 401, msg: 'invalid JWT' });
    return send(res, 200, makeUser(auth.userId));
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204, undefined);
  return send(res, 404, { msg: 'not found' });
}

async function handleControl(req, res, url) {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  if (url.pathname === '/__test/reset') { state = freshState(); return send(res, 200, { ok: true }); }
  if (url.pathname === '/__test/config') { Object.assign(state.config, body); return send(res, 200, state.config); }
  if (url.pathname === '/__test/seed') {
    for (const [table, rows] of Object.entries(body.tables || {})) state.tables[table].push(...rows);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/__test/session') {
    // Session prête à être déposée dans le stockage du navigateur. `expired`
    // simule le cas courant : app rouverte plus d'une heure après le dernier usage.
    const session = makeSession(body.userId);
    if (body.expired) {
      session.expires_at = Math.floor(Date.now() / 1000) - 7200;
      session.access_token = makeAccessToken(body.userId, session.expires_at);
    }
    return send(res, 200, session);
  }
  if (url.pathname === '/__test/state') {
    return send(res, 200, { tables: state.tables, storage: state.storage, log: state.log, config: state.config });
  }
  return send(res, 404, { msg: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/__test/')) return await handleControl(req, res, url);
    if (req.method === 'OPTIONS') return send(res, 204, undefined);

    const auth = readToken(req.headers.authorization);
    state.log.push({ method: req.method, path: url.pathname, role: auth.role, at: Date.now() });

    if (state.config.down) return req.socket.destroy();
    if (state.config.hang) return; // ne répond jamais
    if (state.config.latencyMs) await new Promise((r) => setTimeout(r, state.config.latencyMs));

    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url, auth);
    if (url.pathname.startsWith('/storage/v1/object/')) {
      await readBody(req);
      if (auth.role !== 'authenticated') return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      const path = url.pathname.replace('/storage/v1/object/', '');
      if (state.storage.includes(path)) return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      state.storage.push(path);
      return send(res, 200, { Key: path });
    }
    return send(res, 404, { msg: 'not found' });
  } catch (e) {
    console.error('[mock] erreur', e);
    try { send(res, 500, { msg: String(e) }); } catch { /* socket déjà fermé */ }
  }
});

server.listen(PORT, () => console.log(`[mock-supabase] http://localhost:${PORT}`));
