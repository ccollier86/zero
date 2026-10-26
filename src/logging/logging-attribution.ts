/** Server-only trusted attribution lifetime. Never stores request JSON, credentials or a mutable global actor. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggingContext } from './logging-contracts';
const local = new AsyncLocalStorage<{ owner: object; context: LoggingContext; assertCurrent: () => void; active: boolean }>();

/** @internal Retained child tasks cannot keep using authority after the owned operation settles. */
export async function runWithLoggingAttribution<T>(owner: object, context: LoggingContext, assertCurrent: () => void, operation: () => T | Promise<T>): Promise<T> {
  const binding = { owner, context, assertCurrent, active: true };
  return local.run(binding, async () => { try { assertCurrent(); return await operation(); } finally { binding.active = false; } });
}
/** @internal Called synchronously within a database commit contribution. */
export function currentLoggingAttribution(owner: object): LoggingContext | null {
  const value = local.getStore(); if (!value || value.owner !== owner) return null;
  if (!value.active) throw new Error('Logging attribution lifetime is closed.');
  value.assertCurrent(); return value.context;
}

/** A managed service may explicitly own an asynchronous invocation after its caller returns a stream. */
export function captureLoggingServiceAttribution(owner: object): { readonly context: LoggingContext; readonly assertCurrent: () => void } | null {
  const value = local.getStore(); if (!value || value.owner !== owner) return null;
  if (!value.active) throw new Error('Logging attribution lifetime is closed.');
  value.assertCurrent();
  return Object.freeze({ context: value.context, assertCurrent: value.assertCurrent });
}
