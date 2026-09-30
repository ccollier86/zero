/**
 * ID-only identity anchors copied from Guardian into one application database.
 *
 * These records provide local SQLite referential integrity only. They never
 * carry or imply authentication, membership status, roles, or permissions.
 */
export type IdentityAnchor = UserIdentityAnchor | MembershipIdentityAnchor;

export interface UserIdentityAnchor {
  readonly kind: 'user';
  readonly userId: string;
}

export interface MembershipIdentityAnchor {
  readonly kind: 'membership';
  readonly membershipId: string;
  readonly tenantId: string;
  readonly userId: string;
}

export type IdentityProjectionTargetScope = 'application' | 'tenant' | 'named';
export type IdentityProjectionTargetStatus =
  | 'provisioning'
  | 'ready'
  | 'quarantined';

export type IdentityProjectionDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'quarantined';

/** Durable system-plane delivery claimed by one projector worker. */
export interface IdentityProjectionDelivery {
  readonly eventId: string;
  readonly targetId: string;
  readonly sequence: number;
  readonly anchor: IdentityAnchor;
  readonly status: IdentityProjectionDeliveryStatus;
  readonly attempts: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: number | null;
  readonly createdAt: number;
}

/** Target-local result of one idempotent anchor application. */
export interface IdentityProjectionReceipt {
  readonly eventId: string;
  readonly targetId: string;
  readonly sequence: number;
  readonly anchorFingerprint: string;
  readonly appliedAt: number;
  readonly duplicate: boolean;
}

/** Durable target state, safe to expose to provisioning orchestration. */
export interface IdentityProjectionTargetState {
  readonly targetId: string;
  readonly scope: IdentityProjectionTargetScope;
  readonly status: IdentityProjectionTargetStatus;
  readonly acknowledgedSequence: number;
  readonly pendingDeliveries: number;
  readonly lastErrorCode: string | null;
  readonly updatedAt: number;
}

/** Target-local binding and contiguous application watermark. */
export interface IdentityAnchorState {
  readonly installationId: string;
  readonly targetId: string;
  readonly status: IdentityProjectionTargetStatus;
  readonly watermark: number;
  readonly quarantineCode: string | null;
  readonly updatedAt: number;
}

/**
 * Narrow target boundary used by app, named, and Fabric database adapters.
 * Implementations must durably commit `apply` before resolving it.
 */
export interface IdentityProjectionTarget {
  inspect(): IdentityAnchorState | Promise<IdentityAnchorState>;
  apply(delivery: IdentityProjectionDelivery):
    | IdentityProjectionReceipt
    | Promise<IdentityProjectionReceipt>;
  markReady(): void | Promise<void>;
}

/** In-process target used when the application database is process-pinned. */
export interface SynchronousIdentityProjectionTarget extends IdentityProjectionTarget {
  inspect(): IdentityAnchorState;
  apply(delivery: IdentityProjectionDelivery): IdentityProjectionReceipt;
  markReady(): void;
}

export interface EnsureIdentityAnchorResult {
  readonly delivery: IdentityProjectionDelivery;
  readonly receipt: IdentityProjectionReceipt;
}

/** Synchronous lifecycle hook that can be safely invoked inside Guardian SQL. */
export interface IdentityProjectionLifecycleHook {
  /** Seed/reconcile durable targets after Guardian has installed its schema. */
  initialize?(): void | Promise<void>;
  userCreated(userId: string): void;
  membershipCreated(input: {
    membershipId: string;
    tenantId: string;
    userId: string;
  }): void;
}
