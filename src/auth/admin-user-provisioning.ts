/** Helpers for provisional administrator-created account state. */

import type {
  AdminUserProvisioningReceipt,
  AuthSecurityAuditContext,
  UserStore,
} from './user-store';

/** Create an unknown, high-entropy credential for email-driven setup. */
export function createTemporaryPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export type AdminUserProvisioningRollbackReason =
  | 'setup-delivery-failed'
  | 'provisioning-failed';

/** Reconcile an account whose administrator-created setup did not commit. */
export function rollbackProvisionedUser(
  store: UserStore,
  receipt: AdminUserProvisioningReceipt,
  audit?: AuthSecurityAuditContext,
  reason: AdminUserProvisioningRollbackReason = 'setup-delivery-failed',
): boolean {
  try {
    return store.transaction(() => {
      const cleanupSucceeded = store.rollbackAdminUserProvisioning(receipt);
      if (audit) {
        store.appendControlPlaneAudit({
          action: cleanupSucceeded
            ? 'identity.provisioning-rolled-back'
            : 'identity.provisioning-reconciled',
          outcome: 'succeeded',
          reason: cleanupSucceeded
            ? reason
            : 'newer-state-preserved',
          scope: { kind: 'application' },
          actor: audit.actor,
          request: audit.request,
          target: { type: 'user', id: receipt.userId },
          metadata: { 'cleanup-succeeded': cleanupSucceeded },
        });
      }
      return cleanupSucceeded;
    });
  } catch {
    return false;
  }
}
