/** Strict IPC contract for framework-owned Guardian anchor operations. */

import type {
  IdentityAnchorState,
  IdentityProjectionDelivery,
  IdentityProjectionReceipt,
} from '../auth/identity-projection-types';
import {
  identityAnchorFingerprint,
  requireIdentityProjectionId,
  validateIdentityAnchor,
} from '../auth/identity-projection-validation';
import { DatabaseError } from './database-error';
import { normalizeDatabaseRef, type DatabaseRef } from './database-file';

export type DatabaseIdentityProjectionAction = 'inspect' | 'apply' | 'mark-ready';

export interface DatabaseIdentityProjectionPayload {
  readonly databaseRef: DatabaseRef;
  readonly action: DatabaseIdentityProjectionAction;
  readonly installationId: string;
  readonly targetId: string;
  readonly delivery?: IdentityProjectionDelivery;
}

export type DatabaseIdentityProjectionResult =
  | IdentityAnchorState
  | IdentityProjectionReceipt
  | null;

const PAYLOAD_FIELDS = new Set([
  'databaseRef',
  'action',
  'installationId',
  'targetId',
  'delivery',
]);

const DELIVERY_FIELDS = new Set([
  'eventId',
  'targetId',
  'sequence',
  'anchor',
  'status',
  'attempts',
  'leaseOwner',
  'leaseExpiresAt',
  'createdAt',
]);

/** Strictly detach the private actor payload before it reaches SQLite. */
export function validateDatabaseIdentityProjectionPayload(
  input: unknown,
): DatabaseIdentityProjectionPayload {
  const record = requireRecord(input);
  if (Object.keys(record).some((key) => !PAYLOAD_FIELDS.has(key))) {
    throw invalidPayload();
  }
  const action = record.action;
  if (action !== 'inspect' && action !== 'apply' && action !== 'mark-ready') {
    throw invalidPayload();
  }
  const delivery = action === 'apply'
    ? validateDelivery(record.delivery)
    : undefined;
  if (action !== 'apply' && record.delivery !== undefined) throw invalidPayload();
  return Object.freeze({
    databaseRef: normalizeRef(record.databaseRef),
    action,
    installationId: normalizeIdentityId(record.installationId),
    targetId: normalizeIdentityId(record.targetId),
    ...(delivery ? { delivery } : {}),
  });
}

/** Validate the actor response before the coordinator returns it to Guardian. */
export function validateDatabaseIdentityProjectionResult(
  action: DatabaseIdentityProjectionAction,
  input: unknown,
): DatabaseIdentityProjectionResult {
  if (action === 'mark-ready') {
    if (input !== null) throw protocolError();
    return null;
  }
  const record = requireRecord(input);
  if (action === 'inspect') {
    const keys = Object.keys(record).sort().join(',');
    if (keys !== 'installationId,quarantineCode,status,targetId,updatedAt,watermark') {
      throw protocolError();
    }
    if (record.status !== 'provisioning'
      && record.status !== 'ready'
      && record.status !== 'quarantined') throw protocolError();
    if (!Number.isSafeInteger(record.watermark) || (record.watermark as number) < 0
      || !Number.isSafeInteger(record.updatedAt) || (record.updatedAt as number) < 0
      || (record.quarantineCode !== null
        && (typeof record.quarantineCode !== 'string'
          || !/^[A-Z][A-Z0-9_]{0,95}$/u.test(record.quarantineCode)))) {
      throw protocolError();
    }
    return Object.freeze({
      installationId: normalizeIdentityId(record.installationId),
      targetId: normalizeIdentityId(record.targetId),
      status: record.status,
      watermark: record.watermark as number,
      quarantineCode: record.quarantineCode as string | null,
      updatedAt: record.updatedAt as number,
    });
  }
  const keys = Object.keys(record).sort().join(',');
  if (keys !== 'anchorFingerprint,appliedAt,duplicate,eventId,sequence,targetId'
    || !Number.isSafeInteger(record.sequence) || (record.sequence as number) < 1
    || !Number.isSafeInteger(record.appliedAt) || (record.appliedAt as number) < 0
    || typeof record.duplicate !== 'boolean'
    || typeof record.anchorFingerprint !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(record.anchorFingerprint)) {
    throw protocolError();
  }
  return Object.freeze({
    eventId: normalizeIdentityId(record.eventId),
    targetId: normalizeIdentityId(record.targetId),
    sequence: record.sequence as number,
    anchorFingerprint: record.anchorFingerprint,
    appliedAt: record.appliedAt as number,
    duplicate: record.duplicate,
  });
}

function validateDelivery(input: unknown): IdentityProjectionDelivery {
  const record = requireRecord(input);
  if (Object.keys(record).some((key) => !DELIVERY_FIELDS.has(key))
    || !Number.isSafeInteger(record.sequence) || (record.sequence as number) < 1
    || !Number.isSafeInteger(record.attempts) || (record.attempts as number) < 0
    || !Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0
    || (record.status !== 'processing' && record.status !== 'completed')
    || (record.leaseOwner !== null && typeof record.leaseOwner !== 'string')
    || (record.leaseExpiresAt !== null
      && (!Number.isSafeInteger(record.leaseExpiresAt)
        || (record.leaseExpiresAt as number) < 0))) throw invalidPayload();
  const processing = record.status === 'processing';
  if (processing !== (record.leaseOwner !== null)
    || processing !== (record.leaseExpiresAt !== null)
    || ((record.status === 'processing'
      || record.status === 'completed'
      || record.status === 'quarantined')
      && (record.attempts as number) < 1)) throw invalidPayload();
  const anchor = normalizeAnchor(record.anchor);
  // Force fingerprint evaluation here so exotic string values cannot defer work.
  void identityAnchorFingerprint(anchor);
  return Object.freeze({
    eventId: normalizeIdentityId(record.eventId),
    targetId: normalizeIdentityId(record.targetId),
    sequence: record.sequence as number,
    anchor,
    status: record.status,
    attempts: record.attempts as number,
    leaseOwner: record.leaseOwner === null
      ? null
      : normalizeIdentityId(record.leaseOwner),
    leaseExpiresAt: record.leaseExpiresAt as number | null,
    createdAt: record.createdAt as number,
  });
}

function normalizeAnchor(value: unknown) {
  try {
    return validateIdentityAnchor(value as any);
  } catch {
    throw invalidPayload();
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidPayload();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidPayload();
  return value as Record<string, unknown>;
}

function normalizeIdentityId(value: unknown): string {
  try {
    return requireIdentityProjectionId(value as string, 'identityProjectionId');
  } catch {
    throw invalidPayload();
  }
}

function normalizeRef(value: unknown): DatabaseRef {
  try {
    return normalizeDatabaseRef(value as string);
  } catch {
    throw invalidPayload();
  }
}

function invalidPayload(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_INVALID',
    'Database identity projection payload is invalid.',
  );
}

function protocolError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PROTOCOL_ERROR',
    'Database identity projection result is invalid.',
    { retryable: false, outcome: 'unknown' },
  );
}
