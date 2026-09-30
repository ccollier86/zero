import { describe, expect, test } from 'bun:test';

import { IdentityAnchorStore } from '../auth/identity-anchor-store';
import { identityProjectionError } from '../auth/identity-projection-error';
import { IdentityProjectionOutboxStore } from '../auth/identity-projection-outbox-store';
import { IdentityProjectionService } from '../auth/identity-projection-service';
import { createReactiveDB } from '../sync/reactive-db';
import {
  asDatabaseProjectionError,
  asIdentityProjectionError,
} from './database-identity-projection-errors';
import { DatabaseError } from './database-error';

describe('database identity projection error boundary', () => {
  test('releases a final-edge authority race for retry instead of quarantining', async () => {
    const system = createReactiveDB({ mode: 'memory' });
    const targetDB = createReactiveDB({ mode: 'memory' });
    try {
      const outbox = new IdentityProjectionOutboxStore(system, {
        createInstallationId: () => 'installation-authority-race',
        createEventId: () => 'event-authority-race',
      });
      outbox.registerTarget('tenant-authority-race', 'tenant');
      const target = new IdentityAnchorStore(targetDB, {
        installationId: outbox.getInstallationId(),
        targetId: 'tenant-authority-race',
      });
      const service = new IdentityProjectionService(outbox, {
        workerId: 'worker-authority-race',
        retryDelayMs: 10,
        emitCode: () => ({} as never),
      });
      const authorityRace = asIdentityProjectionError(new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'private authority race details',
        { retryable: false, outcome: 'not-committed' },
      ));
      const failingTarget = {
        inspect: () => Promise.resolve(target.inspect()),
        apply: () => Promise.reject(authorityRace),
        markReady: () => Promise.resolve(target.markReady()),
      };

      await expect(service.ensureAnchor('tenant-authority-race', {
        kind: 'user',
        userId: 'user-authority-race',
      }, failingTarget)).rejects.toMatchObject({
        code: 'IDENTITY_PROJECTION_NOT_READY',
        retryable: true,
      });
      expect(outbox.getTargetState('tenant-authority-race')).toMatchObject({
        status: 'provisioning',
        pendingDeliveries: 1,
        lastErrorCode: 'IDENTITY_PROJECTION_NOT_READY',
      });
    } finally {
      targetDB.dispose();
      system.dispose();
    }
  });

  test('keeps a permanent target mismatch distinct from an authority race', () => {
    const databaseError = asDatabaseProjectionError(
      identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH'),
    );
    expect(databaseError).toMatchObject({
      code: 'DATABASE_SCHEMA_MISMATCH',
      retryable: false,
      outcome: 'not-started',
    });

    const authorityRace = asIdentityProjectionError(new DatabaseError(
      'DATABASE_AUTHORITY_CHANGED',
      'private authority details',
      { retryable: false, outcome: 'not-committed' },
    ));
    expect(authorityRace).toMatchObject({
      code: 'IDENTITY_PROJECTION_NOT_READY',
      retryable: true,
    });
  });
});
