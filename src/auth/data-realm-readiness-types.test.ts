import { describe, expect, it } from 'bun:test';
import {
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  parseDataRealmReadinessSnapshot,
} from './data-realm-readiness-types';

describe('data realm readiness public contract', () => {
  it('accepts and freezes a safe provisioning projection', () => {
    const snapshot = parseDataRealmReadinessSnapshot({
      status: 'provisioning',
      scope: 'tenant',
      pendingOperations: 2,
      retryable: false,
      errorCode: null,
      updatedAt: 1_893_456_000_000,
      pollAfterMs: 750,
    });

    expect(snapshot).toEqual({
      status: 'provisioning',
      scope: 'tenant',
      pendingOperations: 2,
      retryable: false,
      errorCode: null,
      updatedAt: 1_893_456_000_000,
      pollAfterMs: 750,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(dataRealmReadinessAllowsApplicationData(snapshot)).toBe(false);
  });

  it('supports ready, retryable failure, and no-projection modes', () => {
    const ready = parseDataRealmReadinessSnapshot({
      status: 'ready',
      scope: 'application',
      pendingOperations: 0,
      retryable: false,
      errorCode: null,
      updatedAt: 10,
      pollAfterMs: null,
    });
    const failed = parseDataRealmReadinessSnapshot({
      status: 'failed',
      scope: 'named',
      pendingOperations: 1,
      retryable: true,
      errorCode: 'IDENTITY_PROJECTION_NOT_READY',
      updatedAt: 11,
      pollAfterMs: null,
    });
    const notRequired = parseDataRealmReadinessSnapshot({
      status: 'not-required',
      scope: null,
      pendingOperations: 0,
      retryable: false,
      errorCode: null,
      updatedAt: null,
      pollAfterMs: null,
    });

    expect(dataRealmReadinessAllowsApplicationData(ready)).toBe(true);
    expect(dataRealmReadinessAllowsApplicationData(failed)).toBe(false);
    expect(dataRealmReadinessAllowsApplicationData(notRequired)).toBe(true);
  });

  it.each([
    { status: 'not-required', scope: 'application', pendingOperations: 0, retryable: false, errorCode: null, updatedAt: null, pollAfterMs: null },
    { status: 'ready', scope: null, pendingOperations: 0, retryable: false, errorCode: null, updatedAt: 1, pollAfterMs: null },
    { status: 'provisioning', scope: 'tenant', pendingOperations: 0, retryable: true, errorCode: null, updatedAt: 1, pollAfterMs: 250 },
    { status: 'failed', scope: 'tenant', pendingOperations: 0, retryable: true, errorCode: 'private/path.db', updatedAt: 1, pollAfterMs: null },
    { status: 'ready', scope: 'tenant', pendingOperations: -1, retryable: false, errorCode: null, updatedAt: 1, pollAfterMs: null },
  ])('rejects inconsistent or unsafe response %#', (value) => {
    expect(() => parseDataRealmReadinessSnapshot(value))
      .toThrow(DataRealmReadinessContractError);
  });
});
