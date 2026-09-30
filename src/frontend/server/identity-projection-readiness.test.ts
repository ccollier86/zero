import { describe, expect, test } from 'bun:test';

import type { IdentityProjectionTargetState } from '../../auth/identity-projection-types';
import { DatabaseError } from '../../databases/database-error';
import { identityProjectionReadinessFromTargetError } from './identity-projection-readiness';

describe('identity projection target readiness failures', () => {
  const source = Object.freeze({
    targetId: 'tenant:opaque',
    scope: 'tenant',
    status: 'ready',
    acknowledgedSequence: 4,
    pendingDeliveries: 0,
    lastErrorCode: null,
    updatedAt: 100,
  }) satisfies IdentityProjectionTargetState;

  test.each([
    'DATABASE_SCHEMA_MISMATCH',
    'DATABASE_MIGRATION_FAILED',
  ] as const)('reports permanent %s failures without leaking details', (code) => {
    const readiness = identityProjectionReadinessFromTargetError(
      source,
      'tenant',
      new DatabaseError(
        code,
        'private /var/lib/zero/tenant-secret.sqlite failed on hidden SQL',
      ),
    );

    expect(readiness).toEqual({
      status: 'failed',
      scope: 'tenant',
      pendingOperations: 0,
      retryable: false,
      errorCode: code,
      updatedAt: 100,
      pollAfterMs: null,
    });
    expect(JSON.stringify(readiness)).not.toContain('/var/lib');
    expect(JSON.stringify(readiness)).not.toContain('hidden SQL');
  });

  test('keeps retryable and hostile inspection failures in provisioning', () => {
    const retryable = identityProjectionReadinessFromTargetError(
      source,
      'tenant',
      new DatabaseError('DATABASE_BACKPRESSURE', 'private overload'),
    );
    expect(retryable).toMatchObject({
      status: 'provisioning',
      errorCode: null,
    });

    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('hostile trap');
      },
    });
    expect(identityProjectionReadinessFromTargetError(
      source,
      'tenant',
      hostile,
    )).toMatchObject({
      status: 'provisioning',
      errorCode: null,
    });
  });
});
