import { DurableObject } from 'cloudflare:workers';
import { cleanSecretName, decryptSecret, type EncryptedSecret } from './secrets';

interface SecretsEnv extends Cloudflare.Env {
  SECRETS_KEY?: string;
}
interface StoredSecret extends EncryptedSecret {
  allowedHosts: string[];
  updatedAt: string;
}
const json = (value: unknown, status = 200) => Response.json(value, { status });

export class SiteSecrets extends DurableObject<SecretsEnv> {
  #managed(request: Request): boolean {
    return Boolean(
      this.env.SECRETS_KEY && request.headers.get('x-up-manage') === this.env.SECRETS_KEY,
    );
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!this.env.SECRETS_KEY) return json({ error: 'Secret storage is not configured' }, 503);
    if (request.method === 'GET' && url.pathname === '/secrets') {
      if (!this.#managed(request)) return json({ error: 'Not found' }, 404);
      const values = await this.ctx.storage.list<StoredSecret>({ prefix: 'secret:' });
      return json({
        secrets: [...values].map(([key, value]) => ({
          name: key.slice('secret:'.length),
          allowedHosts: value.allowedHosts,
          updatedAt: value.updatedAt,
        })),
      });
    }
    const secretPath = url.pathname.match(/^\/secrets\/([^/]+)$/);
    if (secretPath) {
      if (!this.#managed(request)) return json({ error: 'Not found' }, 404);
      const name = cleanSecretName(secretPath[1] || '');
      if (!name) return json({ error: 'Invalid secret name' }, 400);
      if (request.method === 'DELETE') {
        await this.ctx.storage.delete(`secret:${name}`);
        return json({ ok: true });
      }
      if (request.method === 'PUT') {
        const input = await request.json<StoredSecret>().catch(() => null);
        if (
          !input ||
          typeof input.ciphertext !== 'string' ||
          typeof input.iv !== 'string' ||
          !Array.isArray(input.allowedHosts)
        )
          return json({ error: 'Invalid encrypted secret' }, 400);
        await this.ctx.storage.put(`secret:${name}`, {
          ciphertext: input.ciphertext,
          iv: input.iv,
          allowedHosts: input.allowedHosts,
          updatedAt: new Date().toISOString(),
        } satisfies StoredSecret);
        return json({ ok: true, name }, 201);
      }
    }
    const usePath = url.pathname.match(/^\/use\/([^/]+)$/);
    if (request.method === 'POST' && usePath) {
      const name = cleanSecretName(usePath[1] || '');
      if (!name) return json({ error: 'Not found' }, 404);
      const stored = await this.ctx.storage.get<StoredSecret>(`secret:${name}`);
      if (!stored) return json({ error: 'Not found' }, 404);
      const input = await request
        .json<{
          url?: unknown;
          method?: unknown;
          headers?: unknown;
          body?: unknown;
        }>()
        .catch(() => null);
      if (!input || typeof input.url !== 'string') return json({ error: 'Invalid request' }, 400);
      let target: URL;
      try {
        target = new URL(input.url);
      } catch {
        return json({ error: 'Invalid request URL' }, 400);
      }
      if (
        target.protocol !== 'https:' ||
        !stored.allowedHosts.includes(target.hostname.toLowerCase())
      )
        return json({ error: 'Host is not allowed' }, 403);
      const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
        return json({ error: 'Method is not allowed' }, 400);
      const headers = new Headers();
      if (input.headers && typeof input.headers === 'object') {
        for (const [key, value] of Object.entries(input.headers as Record<string, unknown>)) {
          const lower = key.toLowerCase();
          if (
            typeof value === 'string' &&
            value.length <= 1000 &&
            !['authorization', 'cookie', 'host', 'cf-access-token'].includes(lower)
          )
            headers.set(key, value);
        }
      }
      const secret = await decryptSecret(stored, this.env.SECRETS_KEY);
      headers.set('authorization', `Bearer ${secret}`);
      const body =
        typeof input.body === 'string' && input.body.length <= 1024 * 1024 ? input.body : undefined;
      try {
        const response = await fetch(target, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          redirect: 'manual',
        });
        const type = response.headers.get('content-type') || 'text/plain';
        if (!/^(text\/|application\/(?:json|[^;]+\+json))/.test(type))
          return json({ error: 'Secret-backed requests require a text response' }, 502);
        const text = await response.text();
        if (text.length > 1024 * 1024)
          return json({ error: 'Secret-backed response is too large' }, 502);
        return new Response(text.replaceAll(secret, '[REDACTED]'), {
          status: response.status,
          headers: { 'content-type': type, 'cache-control': 'private, no-store' },
        });
      } catch {
        return json({ error: 'Secret-backed request failed' }, 502);
      }
    }
    return json({ error: 'Not found' }, 404);
  }
}
