/** Pure source lifecycle with inert coordinator/delivery doubles; no worker, app, file or provider output. */
import { expect, test } from 'bun:test';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import type { DatabaseCoordinator } from '../databases/database-coordinator';
import { databaseLoggingBinding } from '../databases/database-logging-binding';
import { createDatabaseRef, normalizeDatabaseId } from '../databases/database-file';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { DeliverySourcePort, DeliverySourceRegistration } from '../logging/logging-delivery-protocol';
import type { CalendarOwnerRecord } from './owner-schema';
import { installCalendarLogging } from './logging';

function fixture() {
  const authority = new AuthorityCommitCoordinator();
  let state = 'created', wakes = 0, invalidations = 0, closed = 0, acquisitions = 0;
  const ports: DeliverySourcePort[] = [];
  const registrations: DeliverySourceRegistration[] = [];
  const coordinator = { diagnostics: () => ({ state }), async acquireExisting() { acquisitions++; return null; } } as unknown as DatabaseCoordinator;
  const logging = { config: { policy: { capture: { workflow: true } }, policyVersion: 'synthetic-calendar-policy' },
    admission: { required: true, invalidate() { invalidations++; } },
    registerDeliverySource(port: DeliverySourcePort) {
      ports.push(port);
      const registration: DeliverySourceRegistration = { id: 'synthetic-' + ports.length,
        wake() { wakes++; }, async flush() {}, async close() { closed++; },
        diagnostics: () => ({ queued: 0, bytes: 0, failed: 0, pending: false, active: false }) };
      registrations.push(registration); return registration;
    },
    async closeDeliverySources(sources: DeliverySourceRegistration[]) { for (const source of sources) await source.close(); },
  } as unknown as LoggingRuntime;
  const source = installCalendarLogging(logging, coordinator, authority);
  const owner: CalendarOwnerRecord = { id: 'calendar:' + 'a'.repeat(64), scope_id: 'tenant:synthetic-tenant',
    owner_id: 'cal_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', root_hash: 'b'.repeat(64), realm_fingerprint: 'sha256:' + 'c'.repeat(64), established: 0 };
  return { source, authority, coordinator, owner, ports, registrations, start() { state = 'started'; },
    get wakes() { return wakes; }, get invalidations() { return invalidations; }, get closed() { return closed; }, get acquisitions() { return acquisitions; },
    async close() { try { await source.close(); } finally { await authority.drain(); } } };
}

test('calendar source binds fixed scope, uses semantic-only capture and retires exact delivery registrations', async () => {
  const f = fixture();
  try {
    f.source.prepare(f.owner); f.source.prepare(f.owner);
    expect(f.ports).toHaveLength(1);
    expect(databaseLoggingBinding(f.coordinator, normalizeDatabaseId(f.owner.id))).toMatchObject({ records: false, workflow: true,
      scope: { kind: 'tenant', tenantId: 'synthetic-tenant' } });
    expect(await f.ports[0]!.page([])).toEqual({ rows: [], queued: 0, bytes: 0 });
    expect(f.acquisitions).toBe(0);
    f.source.wake(f.owner.id); expect(f.wakes).toBe(0);
    f.source.wake(createDatabaseRef(f.owner.id)); expect(f.wakes).toBe(1);
    f.ports[0]!.failed(); expect(f.invalidations).toBe(1);
    const first = f.source.close(); expect(f.source.close()).toBe(first); await first;
    expect(f.closed).toBe(1); f.source.wake(createDatabaseRef(f.owner.id)); expect(f.wakes).toBe(1);
    expect(() => f.source.prepare(f.owner)).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    expect(databaseLoggingBinding(f.coordinator, normalizeDatabaseId(f.owner.id))).toBeUndefined();
  } finally { await f.close(); }
});

test('established-fence refresh never treats a missing established calendar as an empty audit source', async () => {
  const f = fixture();
  try {
    f.source.prepare(f.owner); f.start();
    expect(await f.ports[0]!.page([])).toEqual({ rows: [], queued: 0, bytes: 0 });
    f.source.prepare({ ...f.owner, established: 1 });
    await expect(f.ports[0]!.page([])).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.acquisitions).toBe(2);
    expect(() => f.source.prepare(f.owner)).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
    expect(() => f.source.prepare({ ...f.owner, established: 1, scope_id: 'tenant:other' }))
      .toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
  } finally { await f.close(); }
});
