/**
 * Canonical own-account property mutation and value-free Guardian audit.
 * The caller supplies a live, secret-free authority assertion and acquires
 * commit admission. Persistence and evidence share the store transaction.
 */
import { authAuditActorFromContext } from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { AuthContext } from './types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';

interface OwnPropertyMutation {
  store: UserStore;
  propertyService: UserPropertyService;
  key: string;
  assertAuthority: () => AuthContext;
  request?: AuthAuditRequestContext;
}

/** Validate and commit one changed property. Repeating an accepted value is a no-op. */
export function setOwnUserProperty(input: OwnPropertyMutation & { value: unknown }): void {
  input.store.transaction(() => {
    const actor = input.assertAuthority();
    const value = input.propertyService.validateWrite(input.key, input.value, 'user');
    if (input.store.getProperty(actor.userId, input.key) === value) return;
    input.store.setProperty(actor.userId, input.key, value);
    input.assertAuthority();
    append(input, actor, 'account.property-updated', 'set');
  });
}

/** Delete an editable existing property once; absence does not manufacture an audit change. */
export function deleteOwnUserProperty(input: OwnPropertyMutation): void {
  input.store.transaction(() => {
    const actor = input.assertAuthority();
    const existed = input.store.getProperty(actor.userId, input.key) !== null;
    input.propertyService.deleteProperty(actor.userId, input.key, 'user', input.store);
    input.assertAuthority();
    if (existed) append(input, actor, 'account.property-deleted', 'delete');
  });
}

function append(input: OwnPropertyMutation, actor: AuthContext, action: string, operation: string): void {
  input.store.appendControlPlaneAudit({
    action, outcome: 'succeeded', scope: { kind: 'application' },
    actor: authAuditActorFromContext(actor), request: input.request,
    target: { type: 'user', id: actor.userId },
    // Only declared schema keys are descriptive metadata. Unknown keys can
    // themselves contain private text and are deliberately not retained.
    metadata: { operation, ...(input.propertyService.isConfigured(input.key) ? { field: input.key } : {}) },
  });
}
