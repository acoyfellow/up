import { DurableObject } from 'cloudflare:workers';

interface DatabaseEnv extends Cloudflare.Env {}
const json = (value: unknown, status = 200) => Response.json(value, { status });
const forbidden = /\b(ATTACH|DETACH|PRAGMA|VACUUM)\b/i;

export class SiteDatabase extends DurableObject<DatabaseEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
    if (request.method === 'DELETE' && url.pathname === '/') {
      await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }
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
}
