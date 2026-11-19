/** Native MEMORY owner-policy tests. Physical file presence alone is simulated;
 * these do not qualify the readonly SQLite open or actor startup boundary. */
import { expect, test } from 'bun:test';
import type { DatabaseOpenAdmission } from '../databases/database-open-admission';
import type { CalendarRuntime } from './runtime';
import { calendarRealm } from './realm';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

function internals(runtime: CalendarRuntime) {
  return runtime as unknown as {
    openAdmission(id: string): DatabaseOpenAdmission;
    filePresent(id: string): boolean;
    options: { installAllowed: boolean };
  };
}

test('established current metadata requires current physical schema and the exact established owner', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' });
  try {
    await f.session('owner', { manager: true }).api.resources.create({ label: 'Calendar', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'seed' });
    const row = f.runtime.integrationOwners()[0]!;
    const admission = internals(f.runtime).openAdmission(row.id);
    expect(admission).toEqual({ schema: 'current', row: { table: '_calendar_owner', id: 'application',
      equals: { owner_id: row.owner_id, scope_id: row.scope_id } } });
    expect(Object.isFrozen(admission)).toBe(true);
    expect(Object.isFrozen(admission.row)).toBe(true);
    expect(Object.isFrozen(admission.row!.equals)).toBe(true);
    expect(row.realm_fingerprint).toBe(calendarRealm.fingerprint);
  } finally { await f.close(); }
});

test('only staged creation permits an absent owner; explicit upgrade still requires existing ownership', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' });
  try {
    await f.session('owner', { manager: true }).api.resources.create({ label: 'Calendar', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'seed' });
    const row = f.runtime.integrationOwners()[0]!;
    f.system.prepare('UPDATE _calendar_owners SET established=0 WHERE id=?').run(row.id);
    expect(internals(f.runtime).openAdmission(row.id)).toMatchObject({ schema: 'prepare', row: { allowMissing: true } });
    f.system.prepare('UPDATE _calendar_owners SET established=1,realm_fingerprint=? WHERE id=?').run('sha256:' + '0'.repeat(64), row.id);
    const admission = internals(f.runtime).openAdmission(row.id);
    expect(admission.schema).toBe('prepare');
    expect(admission.row).not.toHaveProperty('allowMissing');
    expect(admission.row!.equals).toEqual({ owner_id: row.owner_id, scope_id: row.scope_id });
    internals(f.runtime).options.installAllowed = false;
    expect(() => internals(f.runtime).openAdmission(row.id)).toThrow();
  } finally { await f.close(); }
});

test('missing catalog, missing established file and substituted root refuse cold admission', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' });
  try {
    expect(() => internals(f.runtime).openAdmission('unknown')).toThrow();
    await f.session('owner', { manager: true }).api.resources.create({ label: 'Calendar', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'seed' });
    const row = f.runtime.integrationOwners()[0]!;
    const priorPresence = internals(f.runtime).filePresent;
    internals(f.runtime).filePresent = () => false;
    expect(() => internals(f.runtime).openAdmission(row.id)).toThrow();
    internals(f.runtime).filePresent = priorPresence;
    f.system.prepare('UPDATE _calendar_owners SET root_hash=? WHERE id=?').run('0'.repeat(64), row.id);
    expect(() => internals(f.runtime).openAdmission(row.id)).toThrow();
  } finally { await f.close(); }
});
