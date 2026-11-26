import { StructuredLogContext } from '@grant-ledger/shared';
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<StructuredLogContext>();

export function runWithRequestContext<T>(context: StructuredLogContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): StructuredLogContext {
  return (
    storage.getStore() ?? {
      request_id: 'system',
      tenant_id: null,
    }
  );
}
