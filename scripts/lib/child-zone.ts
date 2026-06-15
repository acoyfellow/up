import type { Cf } from './provision';

export interface ZoneInfo {
  id: string;
  name: string;
  status: string;
  type: string;
  name_servers?: string[];
}

interface DnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  meta?: { read_only?: boolean; origin_worker_id?: string };
}

export async function findZone(cf: Cf, accountId: string, name: string): Promise<ZoneInfo | null> {
  const zones = await cf<ZoneInfo[]>(
    `/zones?name=${encodeURIComponent(name)}&account.id=${accountId}`,
  );
  return zones[0] || null;
}

export async function ensureChildZone(cf: Cf, accountId: string, name: string): Promise<ZoneInfo> {
  const existing = await findZone(cf, accountId, name);
  if (existing) return existing;
  return cf<ZoneInfo>('/zones', {
    method: 'POST',
    body: JSON.stringify({ account: { id: accountId }, name, type: 'full', jump_start: false }),
  });
}

async function deleteParentWorkerBindings(
  cf: Cf,
  accountId: string,
  parentZone: ZoneInfo,
  childName: string,
): Promise<void> {
  const domains = await cf<
    Array<{ id: string; hostname: string; zone_id: string; service: string }>
  >(`/accounts/${accountId}/workers/domains`);
  for (const domain of domains) {
    if (domain.hostname === childName && domain.zone_id === parentZone.id) {
      await cf(`/accounts/${accountId}/workers/domains/${domain.id}`, { method: 'DELETE' });
    }
  }

  const routes = await cf<Array<{ id: string; pattern: string; script?: string }>>(
    `/zones/${parentZone.id}/workers/routes`,
  );
  for (const route of routes) {
    if (
      route.pattern === `${childName}/*` ||
      route.pattern === `*.${childName}/*` ||
      route.pattern === childName
    ) {
      await cf(`/zones/${parentZone.id}/workers/routes/${route.id}`, { method: 'DELETE' });
    }
  }
}

async function recordsForZone(cf: Cf, zoneId: string): Promise<DnsRecord[]> {
  return cf<DnsRecord[]>(`/zones/${zoneId}/dns_records?per_page=5000`);
}

/**
 * Move authority for `childName` out of the parent zone. This operation refuses
 * to continue if it finds records below the child other than the two records
 * created by this installer (apex custom-domain record and wildcard record).
 */
export async function ensureChildDelegation(
  cf: Cf,
  accountId: string,
  parentName: string,
  child: ZoneInfo,
): Promise<void> {
  const parent = await findZone(cf, accountId, parentName);
  if (!parent) throw new Error(`Parent zone ${parentName} was not found`);
  const nameservers = child.name_servers || [];
  if (nameservers.length < 2)
    throw new Error(`Child zone ${child.name} has no assigned nameservers`);

  const before = await recordsForZone(cf, parent.id);
  const beneathChild = before.filter(
    (r) => r.name === child.name || r.name.endsWith(`.${child.name}`),
  );
  const expectedNames = new Set([child.name, `*.${child.name}`]);
  const unexpected = beneathChild.filter((r) => r.type !== 'NS' && !expectedNames.has(r.name));
  if (unexpected.length) {
    throw new Error(
      `Refusing to delegate ${child.name}: unexpected parent records: ${unexpected
        .map((r) => `${r.type} ${r.name}`)
        .join(', ')}`,
    );
  }

  await deleteParentWorkerBindings(cf, accountId, parent, child.name);
  // The managed custom-domain record disappears shortly after the domain is detached.
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  for (const record of await recordsForZone(cf, parent.id)) {
    if ((record.name === child.name || record.name === `*.${child.name}`) && record.type !== 'NS') {
      try {
        await cf(`/zones/${parent.id}/dns_records/${record.id}`, { method: 'DELETE' });
      } catch (error) {
        // A just-detached managed Worker record can race its asynchronous removal.
        if (!(error instanceof Error) || !record.meta?.read_only) throw error;
      }
    }
  }

  // Wait briefly for a managed Worker record to be removed before creating NS records.
  for (let attempt = 0; attempt < 12; attempt++) {
    const remaining = (await recordsForZone(cf, parent.id)).filter(
      (r) => r.name === child.name && r.type !== 'NS',
    );
    if (!remaining.length) break;
    if (attempt === 11)
      throw new Error(`Managed record for ${child.name} did not detach; no delegation was created`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const current = await recordsForZone(cf, parent.id);
  const existingNs = new Set(
    current
      .filter((r) => r.name === child.name && r.type === 'NS')
      .map((r) => r.content.toLowerCase()),
  );
  for (const nameserver of nameservers) {
    if (existingNs.has(nameserver.toLowerCase())) continue;
    await cf(`/zones/${parent.id}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'NS',
        name: child.name,
        content: nameserver,
        ttl: 3600,
        proxied: false,
        comment: `Delegation for isolated ${child.name} zone`,
      }),
    });
  }
}

export async function waitForActiveZone(
  cf: Cf,
  accountId: string,
  name: string,
  timeoutMs = 10 * 60_000,
): Promise<ZoneInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const zone = await findZone(cf, accountId, name);
    if (zone?.status === 'active') return zone;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`Timed out waiting for child zone ${name} to become active`);
}
