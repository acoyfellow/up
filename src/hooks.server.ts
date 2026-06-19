import { error, type Handle } from '@sveltejs/kit';
import { configurationError, verifyAccessIdentity } from './auth';
import coreWorker, { isCoreRequest } from './core-backend';

export const handle: Handle = async ({ event, resolve }) => {
  const env = event.platform?.env;
  const context = event.platform?.context;

  // Vite development enters through SvelteKit directly; production performs
  // this dispatch one layer earlier in kit-worker.ts.
  if (env && context && isCoreRequest(event.request, env))
    return coreWorker.fetch(event.request, env, context);

  if (event.url.pathname === '/app') {
    if (!env || configurationError(env)) throw error(503, 'Cloudflare Access is not configured');
    try {
      event.locals.identity = await verifyAccessIdentity(event.request, env);
    } catch {
      throw error(403, 'Authentication required');
    }
  } else {
    event.locals.identity = null;
  }

  return resolve(event);
};
