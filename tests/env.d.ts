import type { Env as InhouseEnv } from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends InhouseEnv {}
  }
}
