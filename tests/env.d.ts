import type { Env as UpEnv } from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends UpEnv {}
  }
}
