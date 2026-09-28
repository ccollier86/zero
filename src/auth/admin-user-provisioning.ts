/** Helpers for provisional administrator-created account state. */

import type { AuthSecurityAuditContext, UserStore } from './user-store';

/** Create an unknown, high-entropy credential for email-driven setup. */
export function createTemporaryPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** Remove an account whose initial setup instructions were not delivered. */
export function rollbackProvisionedUser(
  store: UserStore,
  userId: string,
  audit?: AuthSecurityAuditContext,
): boolean {
  try {
    return store.transaction(() => {
      if (!store.getUserById(userId)) return true;
      if (!store.deleteUser(userId)) return false;
      if (audit) {
        store.appendControlPlaneAudit({
          action: 'identity.provisioning-rolled-back',
          outcome: 'succeeded',
          reason: 'setup-delivery-failed',
          scope: { kind: 'application' },
          actor: audit.actor,
          request: audit.request,
          target: { type: 'user', id: userId },
        });
      }
      return true;
    });
  } catch {
    return false;
  }
}
