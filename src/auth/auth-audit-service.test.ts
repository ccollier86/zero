import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { defineAuthAuditTables } from './auth-audit-schema';
import { AuthAuditService } from './auth-audit-service';

describe('AuthAuditService', () => {
  let sqlite: Database;
  let db: ReactiveDB;
  let service: AuthAuditService;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = createReactiveDB({ database: sqlite });
    defineAuthAuditTables(db);
    service = new AuthAuditService(db, resolveAuthAuditConfig({
      retentionDays: 1,
      pruneBatchSize: 2,
      pruneInterval: '1h',
    }));
  });

  afterEach(() => {
    service.stop();
    db.dispose();
    sqlite.close();
  });

  test('appends bounded secret-free events and isolates tenant queries', () => {
    expect(db.hasTable('_auth_audit_events')).toBe(false);
    service.append({
      action: 'tenant.member-added',
      outcome: 'succeeded',
      scope: { kind: 'tenant', tenantId: 'tenant-a' },
      actor: {
        userId: 'actor-a',
        membershipId: 'membership-a',
        sessionId: 'session-a',
        sessionKind: 'web',
        provenance: 'authenticated-request',
      },
      request: { requestId: 'request-1', correlationId: 'correlation-1' },
      target: { type: 'tenant-membership', id: 'membership-b' },
      metadata: { 'role-count': 2, suspended: false },
      occurredAt: 20,
    });
    service.append({
      action: 'application.role-updated',
      outcome: 'succeeded',
      scope: { kind: 'application' },
      actor: { userId: 'actor-a', provenance: 'authenticated-request' },
      target: { type: 'user', id: 'user-b' },
      occurredAt: 10,
    });

    const tenant = service.listTenant('tenant-a');
    expect(tenant.events).toHaveLength(1);
    expect(tenant.events[0]).toMatchObject({
      action: 'tenant.member-added',
      tenantId: 'tenant-a',
      actorUserId: 'actor-a',
      targetId: 'membership-b',
      metadata: { 'role-count': 2, suspended: false },
    });
    expect(service.listPlatform({ limit: 1 }).page).toMatchObject({
      count: 1,
      hasMore: true,
    });
    const first = service.listPlatform({ limit: 1 });
    expect(service.listPlatform({ cursor: first.page.nextCursor!, limit: 1 }).events[0]
      ?.action).toBe('application.role-updated');
  });

  test('rejects secrets, raw email-like metadata, unbounded values, and invalid scope', () => {
    const base = {
      action: 'tenant.member-added',
      outcome: 'succeeded' as const,
      scope: { kind: 'tenant' as const, tenantId: 'tenant-a' },
      actor: { provenance: 'system' as const },
    };
    expect(() => service.append({ ...base, metadata: { accessToken: 'raw' } }))
      .toThrow('metadata key is unsafe');
    expect(() => service.append({ ...base, metadata: { subject: 'person@example.test' } }))
      .toThrow('metadata string is unsafe');
    expect(() => service.append({
      ...base,
      metadata: { subject: 'x'.repeat(201) },
    })).toThrow('metadata string is unsafe');
    expect(() => service.append({
      ...base,
      scope: { kind: 'application' as const, tenantId: 'tenant-a' },
    })).toThrow('cannot carry a tenant id');
    expect(() => service.append({
      ...base,
      occurredAt: 8_640_000_000_000_001,
    })).toThrow('timestamp');
  });

  test('rolls back an event with its enclosing control-plane transaction', () => {
    expect(() => db.transaction(() => {
      service.append({
        action: 'tenant.member-added',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: 'tenant-a' },
        actor: { provenance: 'system' },
      });
      throw new Error('mutation failed');
    })).toThrow('mutation failed');
    expect(countEvents(sqlite)).toBe(0);
  });

  test('blocks ordinary update/delete and drains an expired backlog in bounded batches', () => {
    const now = 200_000_000;
    for (let index = 0; index < 23; index += 1) {
      service.append({
        action: 'tenant.member-added',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: 'tenant-a' },
        actor: { provenance: 'system' },
        target: { type: 'tenant-membership', id: `membership-${index}` },
        occurredAt: 1 + index,
      });
    }
    const recent = service.append({
      action: 'tenant.member-added',
      outcome: 'succeeded',
      scope: { kind: 'tenant', tenantId: 'tenant-a' },
      actor: { provenance: 'system' },
      occurredAt: now,
    });

    expect(() => sqlite.run(
      `UPDATE _auth_audit_events SET outcome = 'failed' WHERE event_id = ?`,
      [recent.eventId],
    )).toThrow('append-only');
    expect(() => sqlite.run(
      'DELETE FROM _auth_audit_events WHERE event_id = ?',
      [recent.eventId],
    )).toThrow('retention pass');

    expect(service.pruneBacklog(now)).toEqual({ deleted: 20, hasMore: true });
    expect(service.pruneBacklog(now)).toEqual({ deleted: 3, hasMore: false });
    expect(service.listPlatform().events.map((event) => event.eventId)).toEqual([
      recent.eventId,
    ]);
  });

  test('makes operator retention and its success event one transaction', () => {
    for (let index = 0; index < 3; index += 1) {
      service.append({
        action: 'tenant.member-added',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: 'tenant-a' },
        actor: { provenance: 'system' },
        target: { type: 'tenant-membership', id: `membership-${index}` },
        occurredAt: 1 + index,
      });
    }
    const result = service.pruneBacklogAudited({
      actor: { userId: 'admin-a', provenance: 'authenticated-request' },
      request: { requestId: 'request-prune' },
      now: 200_000_000,
    });
    expect(result).toEqual({ deleted: 2, hasMore: true });
    expect(service.listPlatform().events[0]).toMatchObject({
      action: 'audit.retention-pruned',
      actorUserId: 'admin-a',
      requestId: 'request-prune',
      metadata: { deleted: 2, 'has-more': true },
    });
    expect(service.listPlatform().events.some((event) => event.occurredAt < 10)).toBe(true);
  });

  test('rejects a thenable authority recheck before retention can commit', () => {
    for (let index = 0; index < 3; index += 1) {
      service.append({
        action: 'tenant.member-added',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: 'tenant-a' },
        actor: { provenance: 'system' },
        occurredAt: index + 1,
      });
    }
    const before = service.listPlatform().events.map((event) => event.eventId);

    expect(() => service.pruneBacklogAudited({
      actor: { userId: 'admin-a', provenance: 'authenticated-request' },
      now: 200_000_000,
      assertCurrentAuthority: () => ({
        then(resolve: (value: void) => void) { resolve(); },
      }),
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Audit retention authority revalidation must be synchronous.',
    }));

    expect(service.listPlatform().events.map((event) => event.eventId)).toEqual(before);
    expect(service.listPlatform().events).not.toContainEqual(expect.objectContaining({
      action: 'audit.retention-pruned',
    }));
  });
});

function countEvents(sqlite: Database): number {
  return (sqlite.query('SELECT COUNT(*) AS count FROM _auth_audit_events').get() as {
    count: number;
  }).count;
}
