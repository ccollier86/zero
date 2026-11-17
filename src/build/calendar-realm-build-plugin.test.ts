/** Pure source transformation only; real bundle/compiled/installed actor qualification is deliberately separate. */
import { expect, test } from 'bun:test';
import { canonicalCalendarRealmSource } from './calendar-realm-build-plugin';

function transformed(migrations: string, snapshots: Parameters<typeof canonicalCalendarRealmSource>[1]) {
  const source = `function defineDatabaseRealm(value) { return value; }
export const calendarRealm = defineDatabaseRealm({ migrations: ${migrations} });`;
  const output = canonicalCalendarRealmSource(source, snapshots).replace('export const calendarRealm', 'const calendarRealm');
  return new Function(output + '\nreturn calendarRealm;')() as { migrations: { up: () => string; down?: () => string }[] };
}

test('calendar bundle transform pins exact source migration identity without changing executable migration behavior', () => {
  const originalUp = 'up(database) { database.run("source-up"); }', originalDown = 'down(database) { database.run("source-down"); }';
  const realm = transformed('[{version:"001",up(){return "bundled-up"},down(){return "bundled-down"}}]', { '001': { up: originalUp, down: originalDown } });
  expect(realm.migrations[0]!.up.toString()).toBe(originalUp);
  expect(realm.migrations[0]!.down!.toString()).toBe(originalDown);
  expect(realm.migrations[0]!.up()).toBe('bundled-up');
  expect(realm.migrations[0]!.down!()).toBe('bundled-down');
  expect(Object.getOwnPropertyDescriptor(realm.migrations[0]!.up, 'toString')).toMatchObject({ configurable: false, writable: false });
});

test('canonical calendar source admission rejects changed registries, down migrations and anchors', () => {
  const snapshot = { '001': { up: 'up() {}', down: null } };
  expect(() => transformed('[]', snapshot)).toThrow('registry changed');
  expect(() => transformed('[{version:"002",up(){}}]', snapshot)).toThrow('registry changed');
  expect(() => transformed('[{version:"001",up(){},down(){}}]', snapshot)).toThrow('registry changed');
  expect(() => canonicalCalendarRealmSource('export const unrelated = {};', snapshot)).toThrow('anchor');
  expect(() => canonicalCalendarRealmSource('export const calendarRealm = defineDatabaseRealm({});export const calendarRealm = defineDatabaseRealm({});', snapshot)).toThrow('anchor');
});

test('separate pure calendar transforms do not reuse earlier migration snapshots', () => {
  const migrations = '[{version:"001",up(){}}]';
  expect(transformed(migrations, { '001': { up: 'up() { first(); }', down: null } }).migrations[0]!.up.toString()).toContain('first');
  expect(transformed(migrations, { '001': { up: 'up() { second(); }', down: null } }).migrations[0]!.up.toString()).toContain('second');
});

test('additive migrations preserve independent identities for legacy methods and named scheduling helpers', () => {
  const source = `function defineDatabaseRealm(value) { return value; }
function bundledSchedulingHelper() { return 'scheduling-executed'; }
export const calendarRealm = defineDatabaseRealm({ migrations: [
  {version:'001',up(){return 'legacy-executed'}},
  {version:'002',up:bundledSchedulingHelper}
] });`;
  const snapshots = { '001': { up: 'up(database) { legacySource(database); }', down: null },
    '002': { up: 'function migrateCalendarScheduling(database) { schedulingSource(database); }', down: null } };
  const output = canonicalCalendarRealmSource(source, snapshots).replace('export const calendarRealm', 'const calendarRealm');
  const realm = new Function(output + '\nreturn calendarRealm;')() as { migrations: { up(): string }[] };
  expect(realm.migrations.map(migration => migration.up.toString())).toEqual([snapshots['001'].up, snapshots['002'].up]);
  expect(realm.migrations.map(migration => migration.up())).toEqual(['legacy-executed', 'scheduling-executed']);
  expect(Object.getOwnPropertyDescriptor(realm.migrations[1]!.up, 'toString')).toMatchObject({ configurable: false, writable: false });
});
