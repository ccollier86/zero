/** Optional same-commit audit contributions. Off by default; existing Guardian append/retention stays authoritative. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthAuditEvent } from './auth-audit-types';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

const captures = new WeakMap<ReactiveDB, Set<(event: AuthAuditEvent) => void>>();
/** @internal Install before audit admission; removal is identity-safe and starts no worker. */
export function registerAuthAuditCapture(db: ReactiveDB, capture: (event: AuthAuditEvent) => void): () => void {
  if (typeof capture !== 'function') throw new TypeError('Audit capture must be a function.');
  let callbacks = captures.get(db); if (!callbacks) captures.set(db, callbacks = new Set());
  callbacks.add(capture); let removed = false;
  return () => { if (!removed) { removed = true; callbacks!.delete(capture); } };
}
/** Append and all active contributions commit or roll back together; no asynchronous observer may grant admission. */
export function appendWithAuthAuditCapture(db: ReactiveDB, append: () => AuthAuditEvent): AuthAuditEvent {
  const callbacks = captures.get(db); if (!callbacks?.size) return append();
  return db.transaction(() => {
    const event = append();
    for (const callback of [...callbacks]) invokeSynchronousAuthCallback(() => callback(event), {
      component: 'auth-audit', invariant: 'audit-capture-async', message: 'Audit capture must be synchronous.',
    });
    return event;
  });
}
