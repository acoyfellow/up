import { DurableObject } from 'cloudflare:workers';
import {
  type AssetManifestEntry,
  type DeploymentRecord,
  nextScheduleTime,
  normalizeSiteAccess,
  type ScheduleRecord,
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
function schedule(row: Record<string, SqlStorageValue>): ScheduleRecord {
  return {
    id: String(row.id),
    siteName: String(row.site_name),
    path: String(row.path),
    cron: String(row.cron),
    status: String(row.status) as ScheduleRecord['status'],
    maxRunsPerDay: Number(row.max_runs_per_day),
    retryLimit: Number(row.retry_limit),
    attempts: Number(row.attempts || 0),
    nextRunAt: String(row.next_run_at),
    ...(row.last_run_at ? { lastRunAt: String(row.last_run_at) } : {}),
    ...(row.last_status ? { lastStatus: String(row.last_status) as 'success' | 'failed' } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    createdBy: String(row.created_by),
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
      `CREATE TABLE IF NOT EXISTS sites(name TEXT PRIMARY KEY,owner TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,active_deployment_id TEXT,visibility TEXT NOT NULL DEFAULT 'company',readers_json TEXT NOT NULL DEFAULT '[]',database_enabled INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,site_name TEXT NOT NULL,owner TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','active','superseded')),created_at TEXT NOT NULL,manifest_json TEXT NOT NULL);CREATE INDEX IF NOT EXISTS deployments_site_created ON deployments(site_name,created_at DESC);CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY,site_name TEXT NOT NULL,path TEXT NOT NULL,cron TEXT NOT NULL,status TEXT NOT NULL,max_runs_per_day INTEGER NOT NULL,retry_limit INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_run_at TEXT NOT NULL,lease_until TEXT,last_run_at TEXT,last_status TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by TEXT NOT NULL);CREATE INDEX IF NOT EXISTS schedules_site ON schedules(site_name,created_at DESC);CREATE TABLE IF NOT EXISTS schedule_usage(schedule_id TEXT NOT NULL,usage_date TEXT NOT NULL,run_count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(schedule_id,usage_date));CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,site_name TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,occurred_at TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}');CREATE INDEX IF NOT EXISTS audit_site_time ON audit_log(site_name,occurred_at DESC);`,
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
    if (request.method === 'POST' && url.pathname === '/schedules/lease') {
      const input = await request.json<{ now: string; limit?: number }>();
      const now = new Date(input.now);
      if (Number.isNaN(now.valueOf())) return json({ error: 'Invalid lease time' }, 400);
      const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
      const date = now.toISOString().slice(0, 10);
      const due = [
        ...this.ctx.storage.sql.exec(
          "SELECT * FROM schedules WHERE status='enabled' AND next_run_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_run_at LIMIT ?",
          now.toISOString(),
          now.toISOString(),
          limit,
        ),
      ];
      const leased: ScheduleRecord[] = [];
      for (const row of due) {
        const item = schedule(row);
        const usage = [
          ...this.ctx.storage.sql.exec(
            'SELECT run_count FROM schedule_usage WHERE schedule_id=? AND usage_date=?',
            item.id,
            date,
          ),
        ][0];
        if (Number(usage?.run_count || 0) >= item.maxRunsPerDay) {
          this.ctx.storage.sql.exec(
            'UPDATE schedules SET next_run_at=?,lease_until=NULL,attempts=0,updated_at=? WHERE id=?',
            nextScheduleTime(item.cron, now).toISOString(),
            now.toISOString(),
            item.id,
          );
          this.ctx.storage.sql.exec(
            'INSERT INTO audit_log(id,site_name,actor,action,target_id,occurred_at,details_json) VALUES (?,?,?,?,?,?,?)',
            crypto.randomUUID(),
            item.siteName,
            'scheduler',
            'schedule.quota_skipped',
            item.id,
            now.toISOString(),
            JSON.stringify({ maxRunsPerDay: item.maxRunsPerDay }),
          );
          continue;
        }
        this.ctx.storage.sql.exec(
          'INSERT INTO schedule_usage(schedule_id,usage_date,run_count) VALUES (?,?,1) ON CONFLICT(schedule_id,usage_date) DO UPDATE SET run_count=run_count+1',
          item.id,
          date,
        );
        const attempts = item.attempts + 1;
        const leaseUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
        this.ctx.storage.sql.exec(
          'UPDATE schedules SET attempts=?,lease_until=?,updated_at=? WHERE id=?',
          attempts,
          leaseUntil,
          now.toISOString(),
          item.id,
        );
        leased.push({ ...item, attempts, updatedAt: now.toISOString() });
      }
      return json({ schedules: leased });
    }
    const resultPath = url.pathname.match(/^\/schedules\/([^/]+)\/result$/);
    if (request.method === 'POST' && resultPath) {
      const input = await request.json<{ now: string; success: boolean; status?: number }>();
      const now = new Date(input.now);
      const row = [
        ...this.ctx.storage.sql.exec('SELECT * FROM schedules WHERE id=?', resultPath[1]),
      ][0];
      if (!row || Number.isNaN(now.valueOf())) return json({ error: 'Not found' }, 404);
      const item = schedule(row);
      let attempts = 0;
      let nextRunAt: Date;
      if (input.success || item.attempts > item.retryLimit) {
        nextRunAt = nextScheduleTime(item.cron, now);
      } else {
        attempts = item.attempts;
        const delay = Math.min(2 ** Math.max(attempts - 1, 0) * 60_000, 60 * 60_000);
        nextRunAt = new Date(now.getTime() + delay);
      }
      this.ctx.storage.sql.exec(
        'UPDATE schedules SET attempts=?,next_run_at=?,lease_until=NULL,last_run_at=?,last_status=?,updated_at=? WHERE id=?',
        attempts,
        nextRunAt.toISOString(),
        now.toISOString(),
        input.success ? 'success' : 'failed',
        now.toISOString(),
        item.id,
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO audit_log(id,site_name,actor,action,target_id,occurred_at,details_json) VALUES (?,?,?,?,?,?,?)',
        crypto.randomUUID(),
        item.siteName,
        'scheduler',
        input.success ? 'schedule.run_succeeded' : 'schedule.run_failed',
        item.id,
        now.toISOString(),
        JSON.stringify({ attempt: item.attempts, status: input.status || null }),
      );
      const updated = [
        ...this.ctx.storage.sql.exec('SELECT * FROM schedules WHERE id=?', item.id),
      ][0];
      return json({ schedule: schedule(updated as Record<string, SqlStorageValue>) });
    }
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
    const schedulesPath = url.pathname.match(/^\/sites\/([^/]+)\/schedules$/);
    if (request.method === 'GET' && schedulesPath)
      return json({
        schedules: [
          ...this.ctx.storage.sql.exec(
            'SELECT * FROM schedules WHERE site_name=? ORDER BY created_at DESC',
            schedulesPath[1],
          ),
        ].map(schedule),
      });
    if (request.method === 'POST' && schedulesPath) {
      const input = await request.json<ScheduleRecord>();
      const exists = [
        ...this.ctx.storage.sql.exec('SELECT name FROM sites WHERE name=?', schedulesPath[1]),
      ][0];
      if (!exists) return json({ error: 'Not found' }, 404);
      this.ctx.storage.sql.exec(
        'INSERT INTO schedules(id,site_name,path,cron,status,max_runs_per_day,retry_limit,attempts,next_run_at,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        input.id,
        schedulesPath[1],
        input.path,
        input.cron,
        input.status,
        input.maxRunsPerDay,
        input.retryLimit,
        input.attempts,
        input.nextRunAt,
        input.createdAt,
        input.updatedAt,
        input.createdBy,
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO audit_log(id,site_name,actor,action,target_id,occurred_at,details_json) VALUES (?,?,?,?,?,?,?)',
        crypto.randomUUID(),
        schedulesPath[1],
        input.createdBy,
        'schedule.created',
        input.id,
        input.createdAt,
        JSON.stringify({ path: input.path, cron: input.cron, status: input.status }),
      );
      return json({ schedule: input }, 201);
    }
    const schedulePath = url.pathname.match(/^\/sites\/([^/]+)\/schedules\/([^/]+)$/);
    if (request.method === 'PATCH' && schedulePath) {
      const input = await request.json<ScheduleRecord & { actor: string }>();
      const existing = [
        ...this.ctx.storage.sql.exec(
          'SELECT * FROM schedules WHERE site_name=? AND id=?',
          schedulePath[1],
          schedulePath[2],
        ),
      ][0];
      if (!existing) return json({ error: 'Not found' }, 404);
      this.ctx.storage.sql.exec(
        'UPDATE schedules SET path=?,cron=?,status=?,max_runs_per_day=?,retry_limit=?,next_run_at=?,updated_at=? WHERE id=?',
        input.path,
        input.cron,
        input.status,
        input.maxRunsPerDay,
        input.retryLimit,
        input.nextRunAt,
        input.updatedAt,
        input.id,
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO audit_log(id,site_name,actor,action,target_id,occurred_at,details_json) VALUES (?,?,?,?,?,?,?)',
        crypto.randomUUID(),
        schedulePath[1],
        input.actor,
        'schedule.updated',
        input.id,
        input.updatedAt,
        JSON.stringify({ path: input.path, cron: input.cron, status: input.status }),
      );
      const row = [...this.ctx.storage.sql.exec('SELECT * FROM schedules WHERE id=?', input.id)][0];
      return json({ schedule: schedule(row as Record<string, SqlStorageValue>) });
    }
    if (request.method === 'DELETE' && schedulePath) {
      const input = await request.json<{ actor: string }>();
      const existing = [
        ...this.ctx.storage.sql.exec(
          'SELECT * FROM schedules WHERE site_name=? AND id=?',
          schedulePath[1],
          schedulePath[2],
        ),
      ][0];
      if (!existing) return json({ error: 'Not found' }, 404);
      this.ctx.storage.sql.exec('DELETE FROM schedules WHERE id=?', schedulePath[2]);
      const now = new Date().toISOString();
      this.ctx.storage.sql.exec(
        'INSERT INTO audit_log(id,site_name,actor,action,target_id,occurred_at,details_json) VALUES (?,?,?,?,?,?,?)',
        crypto.randomUUID(),
        schedulePath[1],
        input.actor,
        'schedule.deleted',
        schedulePath[2],
        now,
        '{}',
      );
      return json({ ok: true });
    }
    const auditPath = url.pathname.match(/^\/sites\/([^/]+)\/audit$/);
    if (request.method === 'GET' && auditPath)
      return json({
        audit: [
          ...this.ctx.storage.sql.exec(
            'SELECT * FROM audit_log WHERE site_name=? ORDER BY occurred_at DESC LIMIT 200',
            auditPath[1],
          ),
        ].map((row) => ({
          id: String(row.id),
          actor: String(row.actor),
          action: String(row.action),
          targetId: row.target_id ? String(row.target_id) : undefined,
          occurredAt: String(row.occurred_at),
          details: JSON.parse(String(row.details_json)),
        })),
      });
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
