import { DurableObject } from 'cloudflare:workers';

interface DatabaseEnv extends Cloudflare.Env {}
const json = (value: unknown, status = 200) => Response.json(value, { status });
const forbidden = /\b(ATTACH|DETACH|PRAGMA|VACUUM)\b/i;

const collectionPattern = /^[a-z][a-z0-9_-]{0,47}$/;
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_DOCUMENT_BYTES = 64 * 1024;

export class SiteDatabase extends DurableObject<DatabaseEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
    if (request.method === 'DELETE' && url.pathname === '/') {
      await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }
    const collection = url.pathname.match(/^\/collections\/([^/]+)(?:\/([^/]+))?$/);
    if (collection) return this.collectionRequest(request, url, collection[1] || '', collection[2]);
    if (request.method !== 'POST' || url.pathname !== '/query')
      return json({ error: 'Not found' }, 404);
    const input = await request.json<{ sql?: unknown; params?: unknown }>().catch(() => null);
    if (!input || typeof input.sql !== 'string') return json({ error: 'Invalid query' }, 400);
    const sql = input.sql.trim();
    if (
      !sql ||
      sql.length > 20_000 ||
      forbidden.test(sql) ||
      sql.replace(/;\s*$/, '').includes(';')
    )
      return json({ error: 'Query is not allowed' }, 400);
    if (!Array.isArray(input.params) || input.params.length > 100)
      return json({ error: 'Invalid query parameters' }, 400);
    if (
      input.params.some(
        (value) =>
          value !== null &&
          typeof value !== 'string' &&
          typeof value !== 'number' &&
          typeof value !== 'boolean',
      )
    )
      return json({ error: 'Invalid query parameter' }, 400);
    try {
      const cursor = this.ctx.storage.sql.exec(sql, ...input.params);
      const rows = [...cursor].slice(0, 1000);
      return json({ rows, rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten });
    } catch {
      return json({ error: 'Database query failed' }, 400);
    }
  }

  private async collectionRequest(
    request: Request,
    url: URL,
    collection: string,
    rawId?: string,
  ): Promise<Response> {
    if (!collectionPattern.test(collection)) return json({ error: 'Invalid collection' }, 400);
    const id = rawId ? decodeURIComponent(rawId) : undefined;
    if (id && !idPattern.test(id)) return json({ error: 'Invalid document id' }, 400);
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS up_documents(collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(collection,id));CREATE INDEX IF NOT EXISTS up_documents_collection_updated ON up_documents(collection,updated_at DESC);',
    );
    if (request.method === 'GET' && id) {
      const row = [
        ...this.ctx.storage.sql.exec<{ data: string }>(
          'SELECT data FROM up_documents WHERE collection=? AND id=?',
          collection,
          id,
        ),
      ][0];
      return row
        ? json({ id, ...JSON.parse(row.data) })
        : json({ error: 'Document not found' }, 404);
    }
    if (request.method === 'GET') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 100)));
      const offset = Math.min(10_000, Math.max(0, Number(url.searchParams.get('offset') || 0)));
      const rows = [
        ...this.ctx.storage.sql.exec<{ id: string; data: string }>(
          'SELECT id,data FROM up_documents WHERE collection=? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
          collection,
          limit,
          offset,
        ),
      ].map((row) => ({ id: row.id, ...JSON.parse(row.data) }));
      return json({ documents: rows, limit, offset });
    }
    if (request.method === 'DELETE' && id) {
      this.ctx.storage.sql.exec(
        'DELETE FROM up_documents WHERE collection=? AND id=?',
        collection,
        id,
      );
      return json({ deleted: true, id });
    }
    if (!['POST', 'PUT'].includes(request.method) || (request.method === 'PUT' && !id))
      return json({ error: 'Method not allowed' }, 405);
    const data = await request.json<Record<string, unknown>>().catch(() => null);
    if (!data || Array.isArray(data)) return json({ error: 'Document must be an object' }, 400);
    const encoded = JSON.stringify(data);
    if (encoded.length > MAX_DOCUMENT_BYTES) return json({ error: 'Document exceeds 64 KiB' }, 413);
    const documentId = id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec(
      'INSERT INTO up_documents(collection,id,data,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at',
      collection,
      documentId,
      encoded,
      now,
      now,
    );
    return json({ id: documentId, ...data }, request.method === 'POST' ? 201 : 200);
  }
}
