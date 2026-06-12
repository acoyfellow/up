export interface Identity {
  email: string;
  role: 'admin' | 'member';
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
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function mayWrite(owner: string, identity: Identity): boolean {
  return identity.role === 'admin' || owner === identity.email;
}
