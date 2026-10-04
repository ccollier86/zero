import { describe, expect, test } from 'bun:test';

import {
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES,
  DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS,
  DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS,
  DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS,
  DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS,
} from '../database-automations/automation-outbox-contracts';
import { DatabaseError } from './database-error';
import { createDatabaseRef } from './database-file';
import {
  DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
  validateDatabaseActorAutomationOutboxPayload,
  validateDatabaseActorAutomationOutboxResult,
} from './database-automation-actor-protocol';

const databaseRef = createDatabaseRef('automation-actor-protocol');
const fingerprint = `sha256:${'a'.repeat(64)}`;
const lease = Object.freeze({
  deliveryId: 'delivery:one',
  leaseOwner: 'worker:one',
  leaseToken: 'lease:one',
  updatedAt: 1_000,
});

describe('database automation actor protocol', () => {
  test('uses one closed lifecycle operation family and exact minimal leases', () => {
    expect(DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION)
      .toBe('database.automation-outbox');

    const payloads = [
      {
        databaseRef,
        action: 'claim',
        leaseOwner: 'worker:one',
        now: 1_000,
        leaseMs: 2_000,
      },
      { databaseRef, action: 'renew', lease, now: 1_500, leaseMs: 2_000 },
      { databaseRef, action: 'complete', lease, now: 1_500 },
      {
        databaseRef,
        action: 'retry',
        lease,
        errorCode: 'REMOTE_UNAVAILABLE',
        retryAt: 5_000,
        now: 1_500,
      },
      {
        databaseRef,
        action: 'dead',
        lease,
        errorCode: 'REMOTE_REJECTED',
        now: 1_500,
      },
      { databaseRef, action: 'recover-expired', now: 1_500 },
      { databaseRef, action: 'counts' },
    ];

    for (const raw of payloads) {
      const validated = validateDatabaseActorAutomationOutboxPayload(raw);
      expect(Object.isFrozen(validated)).toBe(true);
      expect(structuredClone(validated)).toEqual(validated);
      if ('lease' in validated) {
        expect(Object.isFrozen(validated.lease)).toBe(true);
        expect(Object.keys(validated.lease).sort()).toEqual([
          'deliveryId',
          'leaseOwner',
          'leaseToken',
          'updatedAt',
        ]);
      }
    }
  });

  test('rejects generic CRUD, routing leakage, extensions, and hostile objects', () => {
    const accessor = { databaseRef, action: 'counts' } as Record<string, unknown>;
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get: () => '/private/tenant.sqlite',
    });
    const proxy = new Proxy({ databaseRef, action: 'counts' }, {});

    for (const invalid of [
      { databaseRef, action: 'get', deliveryId: 'delivery:one' },
      { databaseRef, action: 'list' },
      { databaseRef, action: 'counts', filePath: '/private/tenant.sqlite' },
      { databaseRef, action: 'counts', tenantId: 'private-tenant' },
      { databaseRef: 'private-tenant', action: 'counts' },
      accessor,
      proxy,
      null,
      ['counts'],
    ]) expectDatabaseError(
      () => validateDatabaseActorAutomationOutboxPayload(invalid),
      'DATABASE_PAYLOAD_INVALID',
    );
  });

  test('enforces lease, timestamp, retry, and error-code bounds', () => {
    const claim = {
      databaseRef,
      action: 'claim',
      leaseOwner: 'worker:one',
      now: 1_000,
      leaseMs: DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS,
    };
    const renew = { databaseRef, action: 'renew', lease, now: 2_000, leaseMs: 2_000 };
    const retry = {
      databaseRef,
      action: 'retry',
      lease,
      errorCode: 'REMOTE_UNAVAILABLE',
      retryAt: 3_000,
      now: 2_000,
    };

    for (const invalid of [
      { ...claim, leaseMs: DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS - 1 },
      { ...claim, leaseMs: DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS + 1 },
      { ...claim, now: Number.MAX_SAFE_INTEGER },
      { ...claim, now: -1 },
      { ...claim, leaseOwner: 'contains secret whitespace' },
      { ...renew, lease: { ...lease, updatedAt: Number.MAX_SAFE_INTEGER } },
      { ...renew, lease: { ...lease, leaseToken: '' } },
      { ...retry, errorCode: 'private error message' },
      { ...retry, errorCode: `A${'B'.repeat(128)}` },
      { ...retry, retryAt: retry.now - 1 },
      { ...retry, retryAt: Number.POSITIVE_INFINITY },
    ]) expectDatabaseError(
      () => validateDatabaseActorAutomationOutboxPayload(invalid),
      'DATABASE_PAYLOAD_INVALID',
    );
  });

  test('validates, detaches, freezes, and correlates full claim results', () => {
    const payload = claimPayload();
    const raw = claimedDelivery({ input: { task: 'notify', attempts: [1, 2] } });
    const result = validateDatabaseActorAutomationOutboxResult(payload, raw);
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.input)).toBe(true);
    expect(structuredClone(result)).toEqual(result);

    (raw.input as { task: string }).task = 'changed-after-validation';
    expect(result?.input).toEqual({ task: 'notify', attempts: [1, 2] });

    const nullInput = validateDatabaseActorAutomationOutboxResult(
      payload,
      claimedDelivery({ input: null }),
    );
    expect(nullInput?.input).toBeNull();
    expect(validateDatabaseActorAutomationOutboxResult(payload, null)).toBeNull();
  });

  test('rejects malformed and uncorrelated claim results', () => {
    const payload = claimPayload();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const invalid of [
      { ...claimedDelivery(), filePath: '/private/tenant.sqlite' },
      { ...claimedDelivery(), status: 'pending' },
      { ...claimedDelivery(), completedAt: 2_000 },
      { ...claimedDelivery(), attemptCount: 0 },
      { ...claimedDelivery(), maxAttempts: 101 },
      { ...claimedDelivery(), leaseOwner: 'worker:other' },
      { ...claimedDelivery(), leaseExpiresAt: 2_999 },
      { ...claimedDelivery(), manifestFingerprint: 'sha256:private' },
      { ...claimedDelivery(), triggerIdentity: 'function:not-a-trigger@1' },
      { ...claimedDelivery(), sourceRowId: 'x'.repeat(10_000) },
      { ...claimedDelivery(), input: new Date() },
      { ...claimedDelivery(), input: cycle },
      { ...claimedDelivery(), input: 'x'.repeat(262_145) },
    ]) expectDatabaseError(
      () => validateDatabaseActorAutomationOutboxResult(payload, invalid),
      'DATABASE_PROTOCOL_ERROR',
    );
  });

  test('correlates renewal results to the exact minimal fence', () => {
    const payload = renewPayload();
    const renewed = claimedDelivery({ updatedAt: 1_500, leaseExpiresAt: 3_500 });
    expect(validateDatabaseActorAutomationOutboxResult(payload, renewed))
      .toEqual(renewed);
    expect(validateDatabaseActorAutomationOutboxResult(payload, null)).toBeNull();

    for (const invalid of [
      { ...renewed, deliveryId: 'delivery:other' },
      { ...renewed, leaseToken: 'lease:other' },
      { ...renewed, updatedAt: 1_499, leaseExpiresAt: 3_499 },
      { ...renewed, leaseExpiresAt: 3_501 },
    ]) expectDatabaseError(
      () => validateDatabaseActorAutomationOutboxResult(payload, invalid),
      'DATABASE_PROTOCOL_ERROR',
    );
  });

  test('validates closed lifecycle result sets per action', () => {
    const complete = exactPayload({ databaseRef, action: 'complete', lease, now: 2_000 });
    const retry = exactPayload({
      databaseRef,
      action: 'retry',
      lease,
      errorCode: 'REMOTE_UNAVAILABLE',
      retryAt: 3_000,
      now: 2_000,
    });
    const dead = exactPayload({
      databaseRef,
      action: 'dead',
      lease,
      errorCode: 'REMOTE_REJECTED',
      now: 2_000,
    });
    expect(validateDatabaseActorAutomationOutboxResult(complete, 'completed'))
      .toBe('completed');
    expect(validateDatabaseActorAutomationOutboxResult(complete, 'stale'))
      .toBe('stale');
    expect(validateDatabaseActorAutomationOutboxResult(retry, 'pending')).toBe('pending');
    expect(validateDatabaseActorAutomationOutboxResult(retry, 'dead')).toBe('dead');
    expect(validateDatabaseActorAutomationOutboxResult(dead, 'dead')).toBe('dead');

    expectDatabaseError(
      () => validateDatabaseActorAutomationOutboxResult(complete, 'pending'),
      'DATABASE_PROTOCOL_ERROR',
    );
    expectDatabaseError(
      () => validateDatabaseActorAutomationOutboxResult(dead, 'completed'),
      'DATABASE_PROTOCOL_ERROR',
    );
  });

  test('validates recovery and relationally consistent bounded counts', () => {
    const recover = exactPayload({
      databaseRef,
      action: 'recover-expired',
      now: 5_000,
    });
    const counts = exactPayload({ databaseRef, action: 'counts' });
    expect(validateDatabaseActorAutomationOutboxResult(recover, {
      requeued: 2,
      dead: 1,
    })).toEqual({ requeued: 2, dead: 1 });
    expect(validateDatabaseActorAutomationOutboxResult(counts, {
      totalRecords: 10,
      activeRecords: 5,
      activeBytes: 2_048,
      pendingRecords: 3,
      processingRecords: 2,
      completedRecords: 4,
      deadRecords: 1,
    })).toEqual({
      totalRecords: 10,
      activeRecords: 5,
      activeBytes: 2_048,
      pendingRecords: 3,
      processingRecords: 2,
      completedRecords: 4,
      deadRecords: 1,
    });

    for (const invalid of [
      { requeued: DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS, dead: 1 },
      { requeued: -1, dead: 0 },
      { requeued: 1, dead: 0, deliveryId: 'private-delivery' },
    ]) expectDatabaseError(
      () => validateDatabaseActorAutomationOutboxResult(recover, invalid),
      'DATABASE_PROTOCOL_ERROR',
    );

    const validCounts = {
      totalRecords: 10,
      activeRecords: 5,
      activeBytes: 2_048,
      pendingRecords: 3,
      processingRecords: 2,
      completedRecords: 4,
      deadRecords: 1,
    };
    for (const invalid of [
      { ...validCounts, activeRecords: 6 },
      { ...validCounts, totalRecords: 11 },
      { ...validCounts, activeBytes: DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES + 1 },
      { ...validCounts, totalRecords: DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS + 1 },
      { ...validCounts, privatePayload: { secret: true } },
    ]) expectDatabaseError(
      () => validateDatabaseActorAutomationOutboxResult(counts, invalid),
      'DATABASE_PROTOCOL_ERROR',
    );
  });

  test('never reflects routing identities, payloads, or error text in failures', () => {
    const privateValue = '/private/customer/acme.sqlite SECRET-PAYLOAD';
    const payloadError = captureDatabaseError(() =>
      validateDatabaseActorAutomationOutboxPayload({
        databaseRef,
        action: 'retry',
        lease,
        errorCode: privateValue,
        retryAt: 2_000,
        now: 1_000,
      }));
    const protocolError = captureDatabaseError(() =>
      validateDatabaseActorAutomationOutboxResult(claimPayload(), {
        ...claimedDelivery(),
        input: { secret: privateValue },
        filePath: privateValue,
      }));

    for (const error of [payloadError, protocolError]) {
      expect(error.message).not.toContain(privateValue);
      expect(error.details).toEqual({});
      expect(error.cause).toBeUndefined();
    }
    expect(payloadError.message).toBe('Database automation actor payload is invalid.');
    expect(protocolError.message)
      .toBe('Database actor returned an invalid automation outbox result.');
  });
});

function claimPayload() {
  const payload = exactPayload({
    databaseRef,
    action: 'claim',
    leaseOwner: 'worker:one',
    now: 1_000,
    leaseMs: 2_000,
  });
  if (payload.action !== 'claim') throw new Error('unexpected payload');
  return payload;
}

function renewPayload() {
  const payload = exactPayload({
    databaseRef,
    action: 'renew',
    lease,
    now: 1_500,
    leaseMs: 2_000,
  });
  if (payload.action !== 'renew') throw new Error('unexpected payload');
  return payload;
}

function exactPayload(value: unknown) {
  return validateDatabaseActorAutomationOutboxPayload(value);
}

function claimedDelivery(overrides: Record<string, unknown> = {}) {
  return {
    deliveryId: 'delivery:one',
    invocationId: 'invocation:one',
    triggerIdentity: 'trigger:orders.changed@1',
    functionIdentity: 'function:orders.notify@1',
    manifestFingerprint: fingerprint,
    realmName: 'orders',
    realmFingerprint: fingerprint,
    sourceSequence: 7,
    sourceTable: 'orders',
    sourceOperation: 'update' as const,
    sourceRowId: 'order-one',
    input: { task: 'notify' },
    status: 'processing' as const,
    attemptCount: 1,
    maxAttempts: 20,
    availableAt: 900,
    createdAt: 100,
    updatedAt: 1_000,
    completedAt: null,
    lastErrorCode: null,
    insertionOrdinal: 1,
    leaseOwner: 'worker:one',
    leaseToken: 'lease:one',
    leaseExpiresAt: 3_000,
    ...overrides,
  };
}

function expectDatabaseError(
  run: () => unknown,
  code: DatabaseError['code'],
): void {
  const error = captureDatabaseError(run);
  expect(error.code).toBe(code);
  expect(error.retryable).toBe(false);
  expect(error.outcome).toBe(code === 'DATABASE_PROTOCOL_ERROR'
    ? 'unknown'
    : 'not-started');
}

function captureDatabaseError(run: () => unknown): DatabaseError {
  try {
    run();
    throw new Error('Expected database protocol validation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
}
