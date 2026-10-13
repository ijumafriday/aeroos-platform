import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  operatorId?: string;
  system?: boolean;
  actor?: string;
}

const store = new AsyncLocalStorage<TenantContext>();

export function runTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return store.run(Object.freeze({ ...ctx }), fn);
}

export function currentTenantContext(): TenantContext | undefined {
  return store.getStore();
}
