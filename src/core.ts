export interface Identity {
  email: string;
  role: 'admin' | 'member';
  groups?: string[];
}
export type SiteVisibility = 'company' | 'restricted' | 'public';
export interface ReaderRule {
  type: 'email' | 'domain' | 'group';
  value: string;
}
export interface SiteAccess {
  visibility: SiteVisibility;
  readers: ReaderRule[];
}
export interface AssetManifestEntry {
  path: string;
  size: number;
  contentType: string;
  sha256: string;
}
export interface SiteRecord {
  name: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  activeDeploymentId?: string;
  access: SiteAccess;
  databaseEnabled: boolean;
  runtimeEnabled: boolean;
}
export type ScheduleStatus = 'enabled' | 'paused' | 'disabled';
export interface ScheduleRecord {
  id: string;
  siteName: string;
  path: string;
  cron: string;
  status: ScheduleStatus;
  maxRunsPerDay: number;
  retryLimit: number;
  attempts: number;
  nextRunAt: string;
  lastRunAt?: string;
  lastStatus?: 'success' | 'failed';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
export interface DeploymentRecord {
  id: string;
  siteName: string;
  owner: string;
  status: 'pending' | 'active' | 'superseded';
  createdAt: string;
  manifest: AssetManifestEntry[];
}

export function parseEmails(input?: string): string[] {
  return input
    ? [
        ...new Set(
          input
            .split(',')
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : [];
}
export function roleFor(email: string, admins?: string): Identity['role'] {
  return parseEmails(admins).includes(email.toLowerCase()) ? 'admin' : 'member';
}
export function cleanSiteName(input: string): string | null {
  const v = input.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v) &&
    !v.includes('--') &&
    !['www', 'app', 'api', 'admin'].includes(v)
    ? v
    : null;
}
export function cleanAssetPath(input: string): string | null {
  let v: string;
  try {
    v = decodeURIComponent(input).replaceAll('\\', '/').replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (
    !v ||
    v.length > 512 ||
    v.includes('\0') ||
    v.split('/').some((s) => !s || s === '.' || s === '..')
  )
    return null;
  return v;
}
export function validateManifest(
  input: unknown,
  limits: { maxFiles: number; maxFileBytes: number; maxSiteBytes: number },
): AssetManifestEntry[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > limits.maxFiles)
    throw new Error(`A deployment requires 1-${limits.maxFiles} files`);
  const seen = new Set<string>();
  let total = 0;
  const result = input.map((item): AssetManifestEntry => {
    if (!item || typeof item !== 'object') throw new Error('Invalid manifest entry');
    const x = item as Record<string, unknown>;
    const path = typeof x.path === 'string' ? cleanAssetPath(x.path) : null;
    if (!path || seen.has(path)) throw new Error('Asset paths must be unique and safe');
    if (
      !Number.isSafeInteger(x.size) ||
      (x.size as number) < 0 ||
      (x.size as number) > limits.maxFileBytes
    )
      throw new Error(`Each file must be at most ${limits.maxFileBytes} bytes`);
    if (typeof x.contentType !== 'string' || x.contentType.length > 200)
      throw new Error('Invalid content type');
    if (typeof x.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(x.sha256))
      throw new Error('Invalid SHA-256');
    seen.add(path);
    total += x.size as number;
    return {
      path,
      size: x.size as number,
      contentType: x.contentType || 'application/octet-stream',
      sha256: x.sha256,
    };
  });
  if (!seen.has('index.html')) throw new Error('index.html is required');
  if (total > limits.maxSiteBytes)
    throw new Error(`Site exceeds ${limits.maxSiteBytes} byte limit`);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
export function normalizeSchedule(
  input: unknown,
  now = new Date(),
): {
  path: string;
  cron: string;
  status: ScheduleStatus;
  maxRunsPerDay: number;
  retryLimit: number;
  nextRunAt: string;
} {
  if (!input || typeof input !== 'object') throw new Error('Invalid schedule');
  const value = input as Record<string, unknown>;
  const path = typeof value.path === 'string' ? value.path.trim() : '';
  if (!/^\/api\/[a-zA-Z0-9/_-]{1,200}$/.test(path))
    throw new Error('Schedule path must be under /api/');
  const cron = typeof value.cron === 'string' ? value.cron.trim().replace(/\s+/g, ' ') : '';
  const [minute, hour, day, month, weekday, extra] = cron.split(' ');
  if (extra || !minute || !hour || day !== '*' || month !== '*' || weekday !== '*')
    throw new Error('Schedules support minute/hour intervals and daily times');
  const minuteValid =
    minute === '*' ||
    /^\*\/(?:[1-9]|[1-5][0-9]|60)$/.test(minute) ||
    /^(?:[0-9]|[1-5][0-9])$/.test(minute);
  const hourValid = hour === '*' || /^(?:[0-9]|1[0-9]|2[0-3])$/.test(hour);
  if (!minuteValid || !hourValid || (minute.startsWith('*/') && hour !== '*'))
    throw new Error('Invalid schedule expression');
  const status = (value.status || 'enabled') as ScheduleStatus;
  if (!['enabled', 'paused', 'disabled'].includes(status))
    throw new Error('Invalid schedule status');
  const maxRunsPerDay = Number(value.maxRunsPerDay ?? 24);
  const retryLimit = Number(value.retryLimit ?? 3);
  if (!Number.isSafeInteger(maxRunsPerDay) || maxRunsPerDay < 1 || maxRunsPerDay > 1440)
    throw new Error('maxRunsPerDay must be 1-1440');
  if (!Number.isSafeInteger(retryLimit) || retryLimit < 0 || retryLimit > 10)
    throw new Error('retryLimit must be 0-10');
  return {
    path,
    cron,
    status,
    maxRunsPerDay,
    retryLimit,
    nextRunAt: nextScheduleTime(cron, now).toISOString(),
  };
}
export function nextScheduleTime(cron: string, from = new Date()): Date {
  const [minute, hour] = cron.split(' ');
  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  for (let count = 0; count < 60 * 24 * 8; count++) {
    const minuteMatch =
      minute === '*' ||
      (minute?.startsWith('*/')
        ? candidate.getUTCMinutes() % Number(minute.slice(2)) === 0
        : candidate.getUTCMinutes() === Number(minute));
    const hourMatch = hour === '*' || candidate.getUTCHours() === Number(hour);
    if (minuteMatch && hourMatch) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error('Unable to calculate next schedule run');
}
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function normalizeSiteAccess(input: unknown): SiteAccess {
  if (input === undefined || input === null) return { visibility: 'company', readers: [] };
  if (!input || typeof input !== 'object') throw new Error('Invalid site access');
  const value = input as Record<string, unknown>;
  if (!['company', 'restricted', 'public'].includes(String(value.visibility)))
    throw new Error('Visibility must be company, restricted, or public');
  if (!Array.isArray(value.readers) || value.readers.length > 100)
    throw new Error('Readers must contain at most 100 rules');
  const seen = new Set<string>();
  const readers = value.readers.map((item): ReaderRule => {
    if (!item || typeof item !== 'object') throw new Error('Invalid reader rule');
    const rule = item as Record<string, unknown>;
    const type = String(rule.type) as ReaderRule['type'];
    const raw = typeof rule.value === 'string' ? rule.value.trim().toLowerCase() : '';
    if (!['email', 'domain', 'group'].includes(type) || !raw || raw.length > 254)
      throw new Error('Invalid reader rule');
    if (type === 'email' && !/^[^@\s]+@[^@\s]+$/.test(raw)) throw new Error('Invalid reader email');
    const value = type === 'domain' ? raw.replace(/^@/, '') : raw;
    const key = `${type}:${value}`;
    if (seen.has(key)) throw new Error('Reader rules must be unique');
    seen.add(key);
    return { type, value };
  });
  const visibility = value.visibility as SiteVisibility;
  if (visibility === 'restricted' && readers.length === 0)
    throw new Error('Restricted sites require at least one reader');
  return { visibility, readers: visibility === 'restricted' ? readers : [] };
}
export function mayRead(site: SiteRecord, identity?: Identity): boolean {
  if (site.access.visibility === 'public') return true;
  if (!identity) return false;
  if (identity.role === 'admin' || site.owner === identity.email) return true;
  if (site.access.visibility === 'company') return true;
  const email = identity.email.toLowerCase();
  const domain = email.split('@')[1] || '';
  const groups = new Set((identity.groups || []).map((group) => group.toLowerCase()));
  return site.access.readers.some((rule) => {
    if (rule.type === 'email') return rule.value === email;
    if (rule.type === 'domain') return rule.value === domain;
    return groups.has(rule.value);
  });
}
export function mayWrite(owner: string, identity: Identity): boolean {
  return identity.role === 'admin' || owner === identity.email;
}
