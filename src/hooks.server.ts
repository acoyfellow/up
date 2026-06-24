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

  if (env && !configurationError(env)) {
    try {
      event.locals.identity = await verifyAccessIdentity(event.request, env);
    } catch {
      throw error(403, 'Authentication required');
    }
  } else if (env?.CONTROL_HOST !== '127.0.0.1') {
    throw error(503, 'Cloudflare Access is not configured');
  } else {
    // Local mode renders the tool shell only. Core APIs still fail closed because
    // Access is unconfigured; this is not an authentication bypass.
    event.locals.identity = null;
  }

  return resolve(event);
};
