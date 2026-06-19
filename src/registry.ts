import { DurableObject } from 'cloudflare:workers';
import type { AssetManifestEntry, DeploymentRecord, SiteRecord } from './core';

interface RegistryEnv extends Cloudflare.Env {}
type Row = Record<string, SqlStorageValue>;
const json = (value: unknown, status = 200) => Response.json(value, { status });

function site(row: Row): SiteRecord {
  const active = row.active_deployment_id ? String(row.active_deployment_id) : undefined;
  return {
    name: String(row.name),
    owner: String(row.owner),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(active ? { activeDeploymentId: active } : {}),
    access: { visibility: 'company', readers: [] },
    databaseEnabled: true,
    runtimeEnabled: false,
  };
}

function deployment(row: Row): DeploymentRecord {
  return {
    id: String(row.id),
    siteName: String(row.site_name),
    owner: String(row.owner),
    status: String(row.status) as DeploymentRecord['status'],
    createdAt: String(row.created_at),
    manifest: JSON.parse(String(row.manifest_json)) as AssetManifestEntry[],
  };
}

export class UpRegistry extends DurableObject<RegistryEnv> {
  constructor(state: DurableObjectState, env: RegistryEnv) {
    super(state, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS sites(name TEXT PRIMARY KEY,owner TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,active_deployment_id TEXT,visibility TEXT NOT NULL DEFAULT 'company',readers_json TEXT NOT NULL DEFAULT '[]',database_enabled INTEGER NOT NULL DEFAULT 1,runtime_enabled INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,site_name TEXT NOT NULL,owner TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','active','superseded')),created_at TEXT NOT NULL,manifest_json TEXT NOT NULL);
       CREATE INDEX IF NOT EXISTS deployments_site_created ON deployments(site_name,created_at DESC);`,
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

    const sitePath = url.pathname.match(/^\/sites\/([^/]+)$/);
    if (request.method === 'GET' && sitePath) {
      const row = [
        ...this.ctx.storage.sql.exec('SELECT * FROM sites WHERE name=?', sitePath[1]),
      ][0];
      return row ? json({ site: site(row) }) : json({ error: 'Not found' }, 404);
    }

    if (request.method === 'POST' && url.pathname === '/deployments') {
      const input = await request.json<{
        id: string;
        siteName: string;
        owner: string;
        manifest: AssetManifestEntry[];
      }>();
      const now = new Date().toISOString();
      const current = [
        ...this.ctx.storage.sql.exec('SELECT * FROM sites WHERE name=?', input.siteName),
      ][0];
      if (!current) {
        this.ctx.storage.sql.exec(
          `INSERT INTO sites(name,owner,created_at,updated_at,visibility,readers_json,database_enabled,runtime_enabled)
           VALUES (?,?,?,?, 'company','[]',1,0)`,
          input.siteName,
          input.owner,
          now,
          now,
        );
      } else {
        this.ctx.storage.sql.exec(
          'UPDATE sites SET updated_at=? WHERE name=?',
          now,
          input.siteName,
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

    const deploymentPath = url.pathname.match(/^\/deployments\/([^/]+)$/);
    if (request.method === 'GET' && deploymentPath) {
      const row = [
        ...this.ctx.storage.sql.exec('SELECT * FROM deployments WHERE id=?', deploymentPath[1]),
      ][0];
      return row ? json({ deployment: deployment(row) }) : json({ error: 'Not found' }, 404);
    }

    const activate = url.pathname.match(/^\/deployments\/([^/]+)\/activate$/);
    if (request.method === 'POST' && activate) {
      const row = [
        ...this.ctx.storage.sql.exec('SELECT * FROM deployments WHERE id=?', activate[1]),
      ][0];
      if (!row) return json({ error: 'Not found' }, 404);
      const item = deployment(row);
      if (item.status === 'active') return json({ deployment: item });
      if (item.status !== 'pending') return json({ error: 'Deployment cannot be activated' }, 409);
      const now = new Date().toISOString();
      this.ctx.storage.sql.exec(
        "UPDATE deployments SET status='superseded' WHERE site_name=? AND status='active'",
        item.siteName,
      );
      this.ctx.storage.sql.exec("UPDATE deployments SET status='active' WHERE id=?", item.id);
      this.ctx.storage.sql.exec(
        "UPDATE sites SET active_deployment_id=?,updated_at=?,visibility='company',readers_json='[]',database_enabled=1,runtime_enabled=0 WHERE name=?",
        item.id,
        now,
        item.siteName,
      );
      return json({ deployment: { ...item, status: 'active' } });
    }

    return json({ error: 'Not found' }, 404);
  }
}
