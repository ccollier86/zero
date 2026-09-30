import type { AuthPlatformCodeEmitter } from '../auth-observability';
import type { IdentityProjectionLifecycleHook } from '../identity-projection-types';

export interface TenantStoreOptions {
  now?: () => number;
  createTenantId?: () => string;
  createMembershipId?: () => string;
  /** Advanced-RBAC hook executed inside initial tenant creation transaction. */
  onOwnerCreated?: (input: {
    tenantId: string;
    membershipId: string;
    userId: string;
    createdBy: string;
    createdAt: number;
  }) => void;
  /** Advanced-RBAC hook executed inside retained simple-role transitions. */
  onOwnerRoleChanged?: (input: {
    tenantId: string;
    membershipId: string;
    userId: string;
    previousRoleKey: string | null;
    roleKey: string;
    changedAt: number;
  }) => void;
  /** App-local installed-profile fence checked under every mutation lock. */
  assertCurrentProfile?: () => void;
  /** App-local observability boundary for transaction invariant failures. */
  emitCode?: AuthPlatformCodeEmitter;
  /** Synchronous system-plane hook for durable ID-only membership enqueue. */
  identityProjection?: Pick<IdentityProjectionLifecycleHook, 'membershipCreated'>;
}
