import { DurableObject } from 'cloudflare:workers';
import {
  type AssetManifestEntry,
  type DeploymentRecord,
  normalizeSiteAccess,
  type SiteAccess,
  type SiteRecord,
} from './core';

interface RegistryEnv extends Cloudflare.Env {}
const json = (value: unknown, status = 200) => Response.json(value, { status });
function site(row: Record<string, SqlStorageValue>): SiteRecord {
  const active =
    typeof row.active_deployment_id === 'string' ? row.active_deployment_id : undefined;
  let access: SiteAccess = { visibility: 'company', readers: [] };
  try {
    access = normalizeSiteAccess({
      visibility: String(row.visibility || 'company'),
      readers: JSON.parse(String(row.readers_json || '[]')),
    });
  } catch {
    // Existing rows created before the access schema are company-private.
  }
  return {
    name: String(row.name),
    owner: String(row.owner),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(active ? { activeDeploymentId: active } : {}),
    access,
    databaseEnabled: Number(row.database_enabled || 0) === 1,
  };
}
function deployment(row: Record<string, SqlStorageValue>): DeploymentRecord {
  return {
    id: String(row.id),
    siteName: String(row.site_name),
    owner: String(row.owner),
    status: String(row.status) as DeploymentRecord['status'],
    createdAt: String(row.created_at),
    manifest: JSON.parse(String(row.manifest_json)) as AssetManifestEntry[],
  };
}
export class InhouseRegistry extends DurableObject<RegistryEnv> {
  constructor(state: DurableObjectState, env: RegistryEnv) {
    super(state, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS sites(name TEXT PRIMARY KEY,owner TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,active_deployment_id TEXT,visibility TEXT NOT NULL DEFAULT 'company',readers_json TEXT NOT NULL DEFAULT '[]',database_enabled INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,site_name TEXT NOT NULL,owner TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','active','superseded')),created_at TEXT NOT NULL,manifest_json TEXT NOT NULL);CREATE INDEX IF NOT EXISTS deployments_site_created ON deployments(site_name,created_at DESC);`,
    );
    const columns = new Set(
      [...this.ctx.storage.sql.exec('PRAGMA table_info(sites)')].map((row) => String(row.name)),
    );
    if (!columns.has('visibility'))
      this.ctx.storage.sql.exec(
        "ALTER TABLE sites ADD COLUMN visibility TEXT NOT NULL DEFAULT 'company'",
      );
    if (!columns.has('readers_json'))
      this.ctx.storage.sql.exec(
        "ALTER TABLE sites ADD COLUMN readers_json TEXT NOT NULL DEFAULT '[]'",
      );
    if (!columns.has('database_enabled'))
      this.ctx.storage.sql.exec(
        'ALTER TABLE sites ADD COLUMN database_enabled INTEGER NOT NULL DEFAULT 0',
      );
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/sites')
      return json({
        sites: [...this.ctx.storage.sql.exec('SELECT * FROM sites ORDER BY updated_at DESC')].map(
          site,
        ),
      });
    const sp = url.pathname.match(/^\/sites\/([^/]+)$/);
    if (request.method === 'GET' && sp) {
      const row = [...this.ctx.storage.sql.exec('SELECT * FROM sites WHERE name = ?', sp[1])][0];
      return row ? json({ site: site(row) }) : json({ error: 'Not found' }, 404);
    }
    if (request.method === 'POST' && url.pathname === '/deployments') {
      const input = await request.json<{
        id: string;
        siteName: string;
        owner: string;
        manifest: AssetManifestEntry[];
        access?: SiteAccess;
      }>();
      const now = new Date().toISOString();
      const current = [
        ...this.ctx.storage.sql.exec('SELECT * FROM sites WHERE name = ?', input.siteName),
      ][0];
      if (current && String(current.owner) !== input.owner)
        return json({ error: 'Not found' }, 404);
      if (!current) {
        const access = normalizeSiteAccess(input.access);
        this.ctx.storage.sql.exec(
          'INSERT INTO sites(name,owner,created_at,updated_at,visibility,readers_json) VALUES (?,?,?,?,?,?)',
          input.siteName,
          input.owner,
          now,
          now,
          access.visibility,
          JSON.stringify(access.readers),
        );
      }
      this.ctx.storage.sql.exec(
        'INSERT INTO deployments(id,site_name,owner,status,created_at,manifest_json) VALUES (?,?,?,?,?,?)',
        input.id,
        input.siteName,
        input.owner,
        'pending',
        now,
        JSON.stringify(input.manifest),
      );
      return json(
        {
          deployment: {
            id: input.id,
            siteName: input.siteName,
            owner: input.owner,
            status: 'pending',
            createdAt: now,
            manifest: input.manifest,
          },
        },
        201,
      );
    }
    const accessPath = url.pathname.match(/^\/sites\/([^/]+)\/access$/);
    if (request.method === 'PATCH' && accessPath) {
      const input = await request.json<{ access?: unknown }>();
      let access: SiteAccess;
      try {
        access = normalizeSiteAccess(input.access);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Invalid site access' }, 400);
      }
      const now = new Date().toISOString();
      const result = this.ctx.storage.sql.exec(
        'UPDATE sites SET visibility=?,readers_json=?,updated_at=? WHERE name=?',
        access.visibility,
        JSON.stringify(access.readers),
        now,
        accessPath[1],
      );
      return result.rowsWritten
        ? json({
            site: site(
              [
                ...this.ctx.storage.sql.exec('SELECT * FROM sites WHERE name=?', accessPath[1]),
              ][0] as Record<string, SqlStorageValue>,
            ),
          })
        : json({ error: 'Not found' }, 404);
    }
    const databasePath = url.pathname.match(/^\/sites\/([^/]+)\/database$/);
    if (request.method === 'PATCH' && databasePath) {
      const input = await request.json<{ enabled?: unknown }>();
      if (typeof input.enabled !== 'boolean') return json({ error: 'Invalid database state' }, 400);
      const now = new Date().toISOString();
      const result = this.ctx.storage.sql.exec(
        'UPDATE sites SET database_enabled=?,updated_at=? WHERE name=?',
        input.enabled ? 1 : 0,
        now,
        databasePath[1],
      );
      return result.rowsWritten
        ? json({
            site: site(
              [
                ...this.ctx.storage.sql.exec('SELECT * FROM sites WHERE name=?', databasePath[1]),
              ][0] as Record<string, SqlStorageValue>,
            ),
          })
        : json({ error: 'Not found' }, 404);
    }
    const dp = url.pathname.match(/^\/deployments\/([^/]+)$/);
    if (request.method === 'GET' && dp) {
      const row = [
        ...this.ctx.storage.sql.exec('SELECT * FROM deployments WHERE id = ?', dp[1]),
      ][0];
      return row ? json({ deployment: deployment(row) }) : json({ error: 'Not found' }, 404);
    }
    const ap = url.pathname.match(/^\/deployments\/([^/]+)\/activate$/);
    if (request.method === 'POST' && ap) {
      const row = [
        ...this.ctx.storage.sql.exec('SELECT * FROM deployments WHERE id = ?', ap[1]),
      ][0];
      if (!row) return json({ error: 'Not found' }, 404);
      const item = deployment(row);
      if (item.status === 'active') return json({ deployment: item });
      if (item.status !== 'pending') return json({ error: 'Deployment is not pending' }, 409);
      const now = new Date().toISOString();
      this.ctx.storage.sql.exec(
        "UPDATE deployments SET status='superseded' WHERE site_name=? AND status='active'",
        item.siteName,
      );
      this.ctx.storage.sql.exec("UPDATE deployments SET status='active' WHERE id=?", item.id);
      this.ctx.storage.sql.exec(
        'UPDATE sites SET active_deployment_id=?,updated_at=? WHERE name=?',
        item.id,
        now,
        item.siteName,
      );
      return json({ deployment: { ...item, status: 'active' } });
    }
    return json({ error: 'Not found' }, 404);
  }
}
