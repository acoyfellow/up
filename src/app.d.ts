import type { Identity } from './core';
import type { Env } from './core-backend';

declare global {
  namespace App {
    interface Locals {
      identity: Identity | null;
    }
    interface Platform {
      env: Env;
      context: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }
  }
}
