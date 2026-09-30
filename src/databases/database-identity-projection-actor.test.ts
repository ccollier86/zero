import { describe, expect, test } from 'bun:test';

import { createReactiveDB } from '../sync/reactive-db';
import { defineIdentityAnchorTables } from '../auth/identity-projection-schema';
import { createDatabaseRef } from './database-file';
import {
  DatabaseIdentityProjectionActorSession,
  validateDatabaseIdentityProjectionPayload,
} from './database-identity-projection-actor';

describe('database actor identity projection session', () => {
  test('initializes and validates its target once per writer binding generation', () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineIdentityAnchorTables(db);
    const originalExec = db.exec.bind(db);
    let targetSchemaInstalls = 0;
    Object.defineProperty(db, 'exec', {
      configurable: true,
      value(sql: string) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS users')) {
          targetSchemaInstalls += 1;
        }
        return originalExec(sql);
      },
    });
    const session = new DatabaseIdentityProjectionActorSession();
    const input = {
      databaseRef: createDatabaseRef('tenant-cache'),
      action: 'inspect' as const,
      installationId: 'installation-cache',
      targetId: 'tenant-cache',
    };

    expect(session.execute(db, input)).toMatchObject({
      targetId: 'tenant-cache',
      watermark: 0,
    });
    expect(session.execute(db, input)).toMatchObject({
      targetId: 'tenant-cache',
      watermark: 0,
    });
    expect(targetSchemaInstalls).toBe(0);
    expect(() => session.execute(db, {
      ...input,
      targetId: 'tenant-other',
    })).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));

    session.reset();
    expect(session.execute(db, input)).toMatchObject({ targetId: 'tenant-cache' });
    expect(targetSchemaInstalls).toBe(0);
    db.dispose();
  });

  test('keeps authority mode outside the private projection payload', () => {
    expect(() => validateDatabaseIdentityProjectionPayload({
      databaseRef: createDatabaseRef('tenant-private-projection'),
      action: 'inspect',
      installationId: 'installation-private-projection',
      targetId: 'tenant-private-projection',
      authorityRevision: 1,
    })).toThrow(expect.objectContaining({
      code: 'DATABASE_PAYLOAD_INVALID',
      outcome: 'not-started',
    }));
  });

  test('rejects deliveries whose lease shape cannot prove one claim generation', () => {
    const base = {
      databaseRef: createDatabaseRef('tenant-private-projection'),
      action: 'apply' as const,
      installationId: 'installation-private-projection',
      targetId: 'tenant-private-projection',
      delivery: {
        eventId: 'event-private-projection',
        targetId: 'tenant-private-projection',
        sequence: 1,
        anchor: { kind: 'user' as const, userId: 'user-private-projection' },
        status: 'processing' as const,
        attempts: 1,
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: 1,
      },
    };

    expect(() => validateDatabaseIdentityProjectionPayload(base)).toThrow(
      expect.objectContaining({
        code: 'DATABASE_PAYLOAD_INVALID',
        outcome: 'not-started',
      }),
    );
    expect(() => validateDatabaseIdentityProjectionPayload({
      ...base,
      delivery: {
        ...base.delivery,
        leaseOwner: 'worker-private-projection',
        leaseExpiresAt: 10,
        attempts: 0,
      },
    })).toThrow(expect.objectContaining({ code: 'DATABASE_PAYLOAD_INVALID' }));
    expect(() => validateDatabaseIdentityProjectionPayload({
      ...base,
      delivery: {
        ...base.delivery,
        status: 'pending',
        attempts: 0,
      },
    })).toThrow(expect.objectContaining({ code: 'DATABASE_PAYLOAD_INVALID' }));
    expect(() => validateDatabaseIdentityProjectionPayload({
      ...base,
      delivery: {
        ...base.delivery,
        anchor: { kind: 'user', userId: 'private@example.test' },
        leaseOwner: 'worker-private-projection',
        leaseExpiresAt: 10,
      },
    })).toThrow(expect.objectContaining({ code: 'DATABASE_PAYLOAD_INVALID' }));
  });
});
