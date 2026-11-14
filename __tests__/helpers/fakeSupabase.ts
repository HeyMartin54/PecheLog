// ─── Faux serveur Supabase (PostgREST) pour les tests ────────────────────────
// Reproduit ce dont dépend la synchronisation :
//  • clé primaire unique → erreur 23505 (HTTP 409) sur un doublon ;
//  • panne réseau → { data: null, error, status: 0 } SANS exception (c'est ainsi
//    que supabase-js rapporte un fetch qui échoue) ;
//  • session absente → erreur SESSION_MISSING (garde de lib/supabase.ts) ;
//  • pannes injectables pour une table / opération donnée ;
//  • latence optionnelle, pour tester ce qui arrive PENDANT une requête.

type Row = Record<string, unknown>;
type PgError = { message: string; code: string; details?: string | null; hint?: string };
type Result = { data: unknown; error: PgError | null; status: number; count?: number | null };
type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';

export const SESSION_MISSING_MESSAGE = 'SESSION_MISSING';

export const server = {
  tables: {} as Record<string, Row[]>,
  /** false : toute requête échoue comme une coupure réseau */
  online: true,
  /** Utilisateur de la session valide, ou null */
  sessionUserId: 'user-1' as string | null,
  /** Délai artificiel avant chaque réponse (ms) */
  latencyMs: 0,
  /** Pannes à injecter : la première qui correspond est consommée */
  failures: [] as { table: string; op: Op; result: Result }[],
  /** Journal de toutes les requêtes reçues */
  log: [] as { table: string; op: Op; payload?: unknown }[],
  /** Appelé au début de chaque requête (pour agir « pendant » un envoi) */
  onRequest: null as null | ((table: string, op: Op) => void | Promise<void>),

  reset() {
    this.tables = {};
    this.online = true;
    this.sessionUserId = 'user-1';
    this.latencyMs = 0;
    this.failures = [];
    this.log = [];
    this.onRequest = null;
  },
  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  },
  count(table: string, op: Op): number {
    return this.log.filter((l) => l.table === table && l.op === op).length;
  },
};

const NETWORK_ERROR: Result = {
  data: null,
  error: { message: 'TypeError: Network request failed', code: '' },
  status: 0,
};
const NO_SESSION: Result = {
  data: null,
  error: { message: `Error: ${SESSION_MISSING_MESSAGE}`, code: '' },
  status: 0,
};

class Builder implements PromiseLike<Result> {
  private op: Op = 'select';
  private payload: unknown = null;
  private filters: ((row: Row) => boolean)[] = [];
  private wantsRows = false;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private limitTo: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(private table: string) {}

  select() { if (this.op === 'select') this.op = 'select'; this.wantsRows = true; return this; }
  insert(payload: unknown) { this.op = 'insert'; this.payload = payload; return this; }
  upsert(payload: unknown) { this.op = 'upsert'; this.payload = payload; return this; }
  update(payload: unknown) { this.op = 'update'; this.payload = payload; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(column: string, value: unknown) { this.filters.push((r) => r[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((r) => values.includes(r[column])); return this; }
  is(column: string, value: unknown) { this.filters.push((r) => (r[column] ?? null) === value); return this; }
  not(column: string, _op: string, value: unknown) { this.filters.push((r) => (r[column] ?? null) !== value); return this; }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.limitTo = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  abortSignal() { return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybeSingle'; return this; }

  private async execute(): Promise<Result> {
    server.log.push({ table: this.table, op: this.op, payload: this.payload });
    if (server.onRequest) await server.onRequest(this.table, this.op);
    if (server.latencyMs > 0) await new Promise((r) => setTimeout(r, server.latencyMs));

    if (!server.online) return NETWORK_ERROR;
    if (!server.sessionUserId) return NO_SESSION;

    const failureIndex = server.failures.findIndex((f) => f.table === this.table && f.op === this.op);
    if (failureIndex !== -1) return server.failures.splice(failureIndex, 1)[0].result;

    const rows = server.rows(this.table);
    const matches = (r: Row) => this.filters.every((f) => f(r));
    let affected: Row[] = [];

    if (this.op === 'insert' || this.op === 'upsert') {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      for (const raw of incoming) {
        const row: Row = { ...raw };
        if (row.id == null) row.id = `srv-${rows.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
        const existing = rows.findIndex((r) => r.id === row.id);
        if (existing !== -1) {
          if (this.op === 'insert') {
            return {
              data: null,
              error: { message: `duplicate key value violates unique constraint "${this.table}_pkey"`, code: '23505' },
              status: 409,
            };
          }
          rows[existing] = { ...rows[existing], ...row };
          affected.push(rows[existing]);
        } else {
          rows.push(row);
          affected.push(row);
        }
      }
    } else if (this.op === 'update') {
      for (const r of rows) {
        if (matches(r)) { Object.assign(r, this.payload as Row); affected.push(r); }
      }
    } else if (this.op === 'delete') {
      affected = rows.filter(matches);
      server.tables[this.table] = rows.filter((r) => !matches(r));
    } else {
      affected = rows.filter(matches);
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        affected = [...affected].sort((a, b) => {
          const av = String(a[column] ?? '');
          const bv = String(b[column] ?? '');
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (this.rangeFrom != null && this.rangeTo != null) affected = affected.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.limitTo != null) affected = affected.slice(0, this.limitTo);
    }

    const returnsRows = this.op === 'select' || this.wantsRows;
    const copies = affected.map((r) => ({ ...r }));
    if (this.mode === 'many') {
      return { data: returnsRows ? copies : null, error: null, status: this.op === 'insert' ? 201 : 200, count: copies.length };
    }
    if (copies.length === 1) return { data: copies[0], error: null, status: 200 };
    if (copies.length === 0 && this.mode === 'maybeSingle') return { data: null, error: null, status: 200 };
    return {
      data: null,
      error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
      status: 406,
    };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export const supabase = {
  from: (table: string) => new Builder(table),
  auth: {
    getSession: async () => ({
      data: {
        session: server.sessionUserId
          ? { access_token: 'jwt', user: { id: server.sessionUserId, email: 'test@example.com' } }
          : null,
      },
      error: null,
    }),
  },
};

export async function getSessionUserId(): Promise<string | null> {
  return server.online ? server.sessionUserId : null;
}

export const SUPABASE_URL = 'https://fake.supabase.co';
export const SUPABASE_ANON_KEY = 'anon-key';
