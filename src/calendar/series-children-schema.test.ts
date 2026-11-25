/** Genuine022 native SQLite MEMORY upgrade/protection evidence only. Every
 * synthetic handle closes in finally; no physical state or public activation. */
import { expect, setDefaultTimeout, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { Migrator } from '../migrations/migrator';
import { hashMigration, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { calendarRealm } from './realm';
import { CALENDAR_SERIES_MIGRATION } from './realm-series-migration';
import { CALENDAR_SERIES_MATERIALIZATION_MIGRATION, calendarSeriesMaterializationTables, CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';
import { CALENDAR_SERIES_CHILD_ADDITIONS, CALENDAR_SERIES_CHILD_MIGRATION, CALENDAR_SERIES_CHILD_TABLES as c,
  calendarSeriesChildTables, migrateCalendarSeriesChildren } from './realm-series-children-migration';
import { seriesMaterializationMemoryFixture as fixture, insertMaterializationRow as insert } from './test-support/series-materialization-fixture';
import { seriesMaterializationWriterFixture as writerFixture } from './test-support/series-materialization-writer-fixture';
import { calendarSeriesChildrenRealm as realm } from './series-children-realm';
import { calendarSeriesMaterializationRealm } from './series-materialization-realm';
import type { MaterializationRow as Row } from './test-support/series-materialization-fixture';
import { calendarHash } from './validation';
import { calendarSeriesQualifiedChildViewSql, calendarSeriesCurrentChildHeadSql } from './series-child-selection-sql';

setDefaultTimeout(30_000);
const migrations = [...calendarRealm.migrations, CALENDAR_SERIES_MIGRATION, CALENDAR_SERIES_MATERIALIZATION_MIGRATION];
function migrate(db: Database) {
  const migrator = new Migrator({ database: db, dbPath: ':memory:', createBackups: false, log() {},
    migrations: realm.migrations, migrationTableStages: realm.migrationTableStages });
  try { return migrator.run('022'); } finally { migrator.dispose(); }
}
function selectedFixture() { return writerFixture({}, { realm, install: migrate }); }
function drain(f: ReturnType<typeof writerFixture>) {
  let cursor = f.projection;
  for (let turn = 0; turn < 1000; turn++) {
    const step = f.stage(cursor, f.realm.version === '22' ? 153 : 256); cursor = step.step.cursor;
    if (step.step.progress.checkpoint.phase === 'complete') return;
  }
  throw new Error('Synthetic projection did not terminate');
}
function expectCapacity(db: Database) {
  const working = new Set<string>([c.heads,c.resources,c.directory,c.claims]);
  for (const value of db.query(`SELECT * FROM ${c.capacity}`).all() as Row[]) {
    const actual = db.query(`SELECT count(*) AS n FROM ${String(value.id)}`).get() as { n: number };
    expect(working.has(String(value.id)) ? value.working_count : value.retained_count).toBe(actual.n);
    expect(Number(value.current_count) + Number(value.pending_count) + Number(value.retiring_count)).toBe(value.working_count as number);
  }
}

test('022 shared selection SQL has a pinned replay identity', () => {
  const digest = calendarHash([calendarSeriesQualifiedChildViewSql(c,'s'), calendarSeriesCurrentChildHeadSql(c,'h'),
    calendarSeriesCurrentChildHeadSql(c,'OLD'), calendarSeriesCurrentChildHeadSql(c,'h','m')]);
  expect(digest).toBe('d0fa3fb7cc2236a8120ded6bb15c6607804c9ef369c90f554374a2a8e6d80020');
  // The pin must participate in hashMigration(up), not merely live in an
  // unhashed imported constant beside the migration.
  expect(migrateCalendarSeriesChildren.toString()).toContain("d0fa3fb7cc2236a8120ded6bb15c6607804c9ef369c90f554374a2a8e6d80020");
});

test('private022 installs its actual17-table map without mutating001–021 checksums or registered019', () => {
  const f = fixture();
  try {
    const hashes = migrations.map(hashMigration), ledger = f.db.query('SELECT * FROM _migrations ORDER BY version').all();
    const fingerprint = calendarRealm.fingerprint, commands = Object.keys(calendarRealm.commands);
    expect(migrate(f.db)).toEqual(['022']); expect(migrate(f.db)).toEqual([]);
    expect(Object.keys(CALENDAR_SERIES_CHILD_ADDITIONS)).toHaveLength(17);
    const actual = inspectDatabaseSchema(f.db), declared = calendarSeriesChildTables();
    expect(diffSchemaSnapshots(snapshotDeclaredTables(declared), { tables: Object.fromEntries(Object.keys(declared).map(name => [name,actual.tables[name]!])) })).toEqual([]);
    expect(f.db.query(`SELECT * FROM ${c.state}`).all()).toEqual([{ id: 'application', version: 22, ranges_ready: 1 }]);
    expect(f.db.query('SELECT * FROM _migrations ORDER BY version LIMIT 21').all()).toEqual(ledger);
    expect(migrations.map(hashMigration)).toEqual(hashes); expect(calendarRealm.version).toBe('19');
    expect(calendarRealm.fingerprint).toBe(fingerprint); expect(Object.keys(calendarRealm.commands)).toEqual(commands);
    expect(calendarSeriesMaterializationRealm.version).toBe('21'); expect(calendarSeriesMaterializationRealm.tables[c.state]).toBeUndefined();
    expect(realm.version).toBe('22'); expect(hashMigration(realm.migrations.at(-1)!)).toBe(hashMigration(CALENDAR_SERIES_CHILD_MIGRATION));
    expectCapacity(f.db); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('populated021 upgrade preserves every old row, issuer binding, receipt, sequence and horizon guard without inventing promotion', () => {
  const f = writerFixture();
  try {
    f.begin(); drain(f); f.prepare(); f.publish(); f.cleanup();
    const retained = Object.fromEntries(Object.keys(calendarSeriesMaterializationTables()).map(table => [table,f.db.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const triggers = f.db.query("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all() as { name: string; sql: string }[];
    const sequence = f.reactive.currentSeq, ledger = f.db.query('SELECT * FROM _migrations ORDER BY version').all(), hashes = migrations.map(hashMigration);
    expect(migrate(f.db)).toEqual(['022']);
    for (const [table,rows] of Object.entries(retained)) expect(f.db.query(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(rows);
    for (const trigger of triggers.filter(value => !/^_calendar_(?:block_|hold_)?reservations_series_materialization_(?:insert|update)$/.test(value.name))) {
      expect(f.db.query("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(trigger.name)).toEqual({ sql: trigger.sql });
    }
    expect(f.reactive.currentSeq).toBe(sequence); expect(f.db.query('SELECT * FROM _migrations ORDER BY version LIMIT 21').all()).toEqual(ledger);
    expect(migrations.map(hashMigration)).toEqual(hashes); expect(f.db.query(`SELECT ranges_ready FROM ${c.state}`).get()).toEqual({ ranges_ready: 0 });
    expect(f.db.query(`SELECT * FROM ${c.views}`).all()).toEqual([]); expect(f.db.query(`SELECT * FROM ${c.receipts}`).all()).toEqual([]);
    const before = f.db.serialize(); expect(() => f.db.run(`UPDATE ${c.state} SET ranges_ready=1 WHERE id='application'`)).toThrow('promotion is incomplete'); expect(f.db.serialize()).toEqual(before);
    expectCapacity(f.db); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('late022 DDL collision rolls back new tables, forward bridges and markers byte-exactly', () => {
  const f = fixture();
  try {
    f.accept(); f.db.run("CREATE TRIGGER _calendar_hold_reservations_series_children_update BEFORE INSERT ON calendar_resources BEGIN SELECT 1; END");
    const before = f.db.serialize(); expect(() => migrateCalendarSeriesChildren(f.db)).toThrow(); expect(f.db.serialize()).toEqual(before);
    for (const name of Object.keys(CALENDAR_SERIES_CHILD_ADDITIONS)) expect(f.db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(name)).toBeNull();
    expect(f.db.query("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger' AND name GLOB '*reservations_series_materialization_*'").get()).toEqual({ n: 6 });
  } finally { f.close(); }
});

test('pending022 view is durable only with exact original21 and extension receipts; legacy entry cannot bypass derivation', () => {
  const f = fixture();
  try {
    const accepted = f.accept(); migrate(f.db); const before = f.db.serialize();
    expect(() => f.begin(accepted)).toThrow('complete selected-child derivation'); expect(f.db.serialize()).toEqual(before);
    expect(f.db.query(`SELECT * FROM ${n.runs}`).all()).toEqual([]); expect(f.db.query(`SELECT * FROM ${c.views}`).all()).toEqual([]);
    const selected = selectedFixture();
    try {
      selected.begin(); expect(selected.db.query(`SELECT phase,child_count,resource_count,directory_count FROM ${c.views}`).get()).toEqual({ phase: 'pending',child_count: 0,resource_count: 0,directory_count: 1 });
      expect(selected.db.query('PRAGMA foreign_key_check').all()).toEqual([]); expectCapacity(selected.db);
      const view = selected.db.query(`SELECT * FROM ${c.views}`).get() as Row;
      expect(() => selected.db.transaction(() => insert(selected.db,c.views,{ ...view,id: 'orphan',initial_batch_id: 'missing-batch',last_batch_id: 'missing-batch' }))()).toThrow();
      expect(selected.db.query(`SELECT id FROM ${c.views} WHERE id='orphan'`).get()).toBeNull();
    } finally { selected.close(); }
  } finally { f.close(); }
});

test('actual022 rejects REPLACE, cross-scope origins, malformed counter bases and selected projection withdrawal', () => {
  const f = selectedFixture();
  try {
    f.begin(); drain(f); f.prepare(); f.publish();
    const head = f.db.query(`SELECT * FROM ${c.heads} ORDER BY id LIMIT 1`).get() as Row;
    const view = f.db.query(`SELECT * FROM ${c.views}`).get() as Row;
    const before = f.db.serialize();
    expect(() => insert(f.db,c.heads,head,true)).toThrow();
    expect(() => insert(f.db,c.heads,{ ...head,id: 'cross-scope',scope_id: 'tenant:other' })).toThrow();
    expect(() => f.db.run(`UPDATE ${c.views} SET receipt_base_json='{}',revision=revision+1,last_batch_id='missing' WHERE id=?`,[view.id!])).toThrow();
    expect(() => f.db.run(`UPDATE ${c.views} SET receipt_base_json=?,revision=revision+1,last_batch_id='missing' WHERE id=?`,[JSON.stringify({ child_count: view.child_count,resource_count: view.resource_count,directory_count: view.directory_count,extra: 0 }),view.id!])).toThrow();
    expect(() => f.db.run(`UPDATE ${c.views} SET receipt_base_json=?,revision=revision+1,last_batch_id='missing' WHERE id=?`,[JSON.stringify({ child_count: view.child_count,resource_count: view.resource_count,extra: 0 }),view.id!])).toThrow();
    expect(() => f.db.run(`DELETE FROM ${c.resources} WHERE head_id=?`,[head.id!])).toThrow('remains authoritative');
    expect(() => f.db.run(`DELETE FROM ${c.heads} WHERE id=?`,[head.id!])).toThrow('cannot be withdrawn');
    expect(() => f.db.run(`DELETE FROM ${c.directory} WHERE view_id=?`,[view.id!])).toThrow('still selected');
    expect(() => f.db.run(`UPDATE ${c.capacity} SET working_count=working_ceiling+1 WHERE id=?`,[c.heads])).toThrow();
    expect(f.db.serialize()).toEqual(before); expectCapacity(f.db);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('actual022 indices bound selected resource ranges, child points and retained021 occurrence fallback', () => {
  const f = fixture();
  try {
    migrate(f.db);
    const explain = (sql: string) => (f.db.query('EXPLAIN QUERY PLAN '+sql).all() as { detail: string }[]).map(row => row.detail).join('\n');
    expect(explain(`SELECT id FROM ${c.resources} WHERE scope_id='tenant:x' AND view_id='view' AND resource_id='r' AND occupies=1 AND occupied_from_ms>=0 AND occupied_from_ms<1 ORDER BY occupied_from_ms,appointment_id LIMIT 1`)).toContain('calendar_series_child_resource_range');
    expect(explain(`SELECT id FROM ${c.heads} WHERE scope_id='tenant:x' AND view_id='view' AND status='confirmed' AND occupied_from_ms>=0 AND occupied_from_ms<1 ORDER BY occupied_from_ms,appointment_id LIMIT 1`)).toContain('calendar_series_child_head_range');
    expect(explain(`SELECT id FROM ${n.versions} WHERE scope_id='tenant:x' AND occurrence_id='child' ORDER BY id LIMIT 1`)).toContain('calendar_series_child_native_occurrence');
    for (const name of ['calendar_series_child_resource_range','calendar_series_child_head_range','calendar_series_child_native_occurrence']) expect(f.db.query("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?").get(name)).not.toBeNull();
  } finally { f.close(); }
});
