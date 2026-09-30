import { identityProjectionError } from './identity-projection-error';
import type {
  IdentityAnchor,
  IdentityProjectionDelivery,
  IdentityProjectionReceipt,
  IdentityProjectionTargetScope,
  IdentityProjectionTargetState,
} from './identity-projection-types';
import {
  identityAnchorFingerprint,
  requireIdentityProjectionId,
  validateIdentityAnchor,
} from './identity-projection-validation';

/** Private SQLite row owned by the source delivery journal. */
export interface IdentityProjectionOutboxRow {
  readonly target_id: string;
  readonly sequence: number;
  readonly event_id: string;
  readonly anchor_kind: string;
  readonly user_id: string;
  readonly membership_id: string | null;
  readonly tenant_id: string | null;
  readonly status: string;
  readonly attempts: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: number | null;
  readonly created_at: number;
}

/** Private SQLite row owned by the projection target catalog. */
export interface IdentityProjectionTargetRow {
  readonly target_id: string;
  readonly scope: string;
  readonly status: string;
  readonly next_sequence: number;
  readonly acknowledged_sequence: number;
  readonly last_error_code: string | null;
  readonly updated_at: number;
}

export function mapIdentityProjectionDelivery(
  row: IdentityProjectionOutboxRow,
): IdentityProjectionDelivery {
  const anchor: IdentityAnchor = row.anchor_kind === 'user'
    ? { kind: 'user', userId: row.user_id }
    : {
        kind: 'membership',
        membershipId: row.membership_id ?? '',
        tenantId: row.tenant_id ?? '',
        userId: row.user_id,
      };
  const delivery = Object.freeze({
    eventId: requireIdentityProjectionId(row.event_id, 'eventId'),
    targetId: requireIdentityProjectionId(row.target_id, 'targetId'),
    sequence: requirePositiveSafeInteger(row.sequence, 'sequence'),
    anchor: validateIdentityAnchor(anchor),
    status: row.status as IdentityProjectionDelivery['status'],
    attempts: requireNonNegativeSafeInteger(row.attempts, 'attempts'),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: requireNonNegativeSafeInteger(row.created_at, 'createdAt'),
  });
  assertDeliveryLeaseShape(delivery);
  return delivery;
}

export function mapIdentityProjectionTargetState(
  row: IdentityProjectionTargetRow,
): IdentityProjectionTargetState {
  if (row.scope !== 'application' && row.scope !== 'tenant' && row.scope !== 'named') {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
  if (row.status !== 'provisioning'
    && row.status !== 'ready'
    && row.status !== 'quarantined') {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
  return Object.freeze({
    targetId: requireIdentityProjectionId(row.target_id, 'targetId'),
    scope: row.scope as IdentityProjectionTargetScope,
    status: row.status,
    acknowledgedSequence: requireNonNegativeSafeInteger(
      row.acknowledged_sequence,
      'acknowledgedSequence',
    ),
    pendingDeliveries: pendingIdentityProjectionDeliveryCount(row),
    lastErrorCode: row.last_error_code === null
      ? null
      : safeIdentityProjectionErrorCode(row.last_error_code),
    updatedAt: requireNonNegativeSafeInteger(row.updated_at, 'updatedAt'),
  });
}

export function pendingIdentityProjectionDeliveryCount(
  row: IdentityProjectionTargetRow,
): number {
  const next = requirePositiveSafeInteger(row.next_sequence, 'nextSequence');
  const acknowledged = requireNonNegativeSafeInteger(
    row.acknowledged_sequence,
    'acknowledgedSequence',
  );
  if (acknowledged >= next) {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
  // Claims are strictly sequence-ordered and acknowledgement is committed in
  // the same transaction as completion, so the unacknowledged width is exact.
  return next - acknowledged - 1;
}

export function assertIdentityProjectionReceiptMatches(
  delivery: IdentityProjectionDelivery,
  receipt: IdentityProjectionReceipt,
): void {
  if (receipt.eventId !== delivery.eventId
    || receipt.targetId !== delivery.targetId
    || receipt.sequence !== delivery.sequence
    || receipt.anchorFingerprint !== identityAnchorFingerprint(delivery.anchor)) {
    throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
  }
}

/** Processing attempts are the monotonic lease generation used to fence ABA. */
export function assertClaimedIdentityProjectionDelivery(
  delivery: IdentityProjectionDelivery,
): void {
  assertIdentityProjectionDeliveryIdentity(delivery);
  if (delivery.status !== 'processing'
    || delivery.attempts < 1
    || delivery.leaseOwner === null
    || delivery.leaseExpiresAt === null) {
    throw identityProjectionError('IDENTITY_PROJECTION_LEASE_LOST');
  }
}

export function assertCompletedIdentityProjectionDelivery(
  delivery: IdentityProjectionDelivery,
): void {
  assertIdentityProjectionDeliveryIdentity(delivery);
  if (delivery.status !== 'completed'
    || delivery.attempts < 1
    || delivery.leaseOwner !== null
    || delivery.leaseExpiresAt !== null) {
    throw identityProjectionError('IDENTITY_PROJECTION_LEASE_LOST');
  }
}

export function sameIdentityProjectionDelivery(
  left: IdentityProjectionDelivery,
  right: IdentityProjectionDelivery,
): boolean {
  return left.eventId === right.eventId
    && left.targetId === right.targetId
    && left.sequence === right.sequence
    && identityAnchorFingerprint(left.anchor) === identityAnchorFingerprint(right.anchor);
}

export function safeIdentityProjectionErrorCode(value: string): string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/u.test(value)) {
    return 'IDENTITY_PROJECTION_CONFLICT';
  }
  return value;
}

function assertIdentityProjectionDeliveryIdentity(
  delivery: IdentityProjectionDelivery,
): void {
  requireIdentityProjectionId(delivery.eventId, 'eventId');
  requireIdentityProjectionId(delivery.targetId, 'targetId');
  requirePositiveSafeInteger(delivery.sequence, 'sequence');
  requireNonNegativeSafeInteger(delivery.attempts, 'attempts');
  validateIdentityAnchor(delivery.anchor);
}

function assertDeliveryLeaseShape(delivery: IdentityProjectionDelivery): void {
  if (delivery.status !== 'pending'
    && delivery.status !== 'processing'
    && delivery.status !== 'completed'
    && delivery.status !== 'quarantined') {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
  const processing = delivery.status === 'processing';
  if (processing !== (delivery.leaseOwner !== null)
    || processing !== (delivery.leaseExpiresAt !== null)) {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
  if (delivery.leaseOwner !== null) {
    requireIdentityProjectionId(delivery.leaseOwner, 'leaseOwner');
  }
  if (delivery.leaseExpiresAt !== null) {
    requireNonNegativeSafeInteger(delivery.leaseExpiresAt, 'leaseExpiresAt');
  }
  if ((processing || delivery.status === 'completed' || delivery.status === 'quarantined')
    && delivery.attempts < 1) {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
}

function requirePositiveSafeInteger(value: number, _label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
  return value;
}

function requireNonNegativeSafeInteger(value: number, _label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
  return value;
}
