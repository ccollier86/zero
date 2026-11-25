/** Raw SQLite MEMORY evidence for private/inert020. No physical/bundle/browser or enabled recurrence claim. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { hashMigration, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createReactiveDB } from '../sync/reactive-db';
import { calendarRealm } from './realm';
import { calendarRealm016 } from './test-support/calendar-realm-016';
import { CALENDAR_SERIES_ADDITIONS, CALENDAR_SERIES_CAPACITY, CALENDAR_SERIES_MIGRATION, calendarSeriesTables, migrateCalendarSeries } from './realm-series-migration';
import { calendarHash } from './validation';

type Row = Record<string, SQLQueryBindings>;
const invalidRows = (...values: Row[]) => values;
const invalidPlans = (...values: Partial<SeriesPlan>[]) => values;
function commandValue(result: DatabaseSerializableValue): DatabaseSerializableValue {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Object.hasOwn(result, 'value')) throw new Error('Synthetic realm command did not return an accepted value');
  return (result as { readonly value: DatabaseSerializableValue }).value;
}
const scope = 'tenant:synthetic-series', owner = 'synthetic-established-owner', principal = 'synthetic-web-principal';
const hash = (value: unknown) => calendarHash(value);
const authoring = { kind: 'timed-series-v1', recurrence: { kind: 'timed-local-v1', localStart: '2030-01-01T10:00:00.000', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 3600000,
  rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } } }, template: { resourceIds: ['r'], title: 'PRIVATE_SERIES_TITLE', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, appointmentType: null, visit: null, participants: [] } };
function insert(db: Database, table: string, row: Row, replace = false) {
  return db.run(`INSERT${replace ? ' OR REPLACE' : ''} INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`, Object.values(row));
}
function fixture(target = '019') {
  const db = new Database(':memory:');
  try {
    db.run('PRAGMA temp_store=MEMORY'); db.run('PRAGMA foreign_keys=ON');
    const migrate = (series = false, until?: string) => {
      const migrator = new Migrator({ database: db, dbPath: ':memory:', createBackups: false, log() {},
        migrations: series ? [...calendarRealm.migrations, CALENDAR_SERIES_MIGRATION] : calendarRealm.migrations,
        migrationTableStages: series ? [...calendarRealm.migrationTableStages!, { version: '020', tables: calendarSeriesTables() }] : calendarRealm.migrationTableStages });
      try { return migrator.run(until); } finally { migrator.dispose(); }
    };
    migrate(false, target);
    return { db, migrate, close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}
function populate(db: Database, older = false, selectedScope = scope) {
  const scope = selectedScope;
  const reactive = createReactiveDB({ database: db, ownsDatabase: false });
  try {
    const realm = older ? calendarRealm016 : calendarRealm;
    for (const [table, definition] of Object.entries(realm.tables)) reactive.defineTable(table, definition);
    const actor = { scopeId: scope, userId: 'synthetic-user', principal, manageAll: true, createOwn: true };
    const command = (name: string, row: Record<string, unknown>) => commandValue(runDatabaseRealmCommand(realm, reactive, 'calendar.' + name, row as never));
    command('owner.bind', { scopeId: scope, ownerId: owner });
    command('resource.create', { actor, requestId: 'ordinary-resource', id: 'r', label: 'PRIVATE_OLD_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    const booking = { actor, requestId: 'ordinary-booking', id: 'one-off', title: 'PRIVATE_OLD_APPOINTMENT', resourceIds: ['r'], startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    const receipt = command('appointment.create', booking);
    return { actor, booking, receipt, sequence: reactive.currentSeq };
  } finally { reactive.dispose(); }
}
function rows(db: Database, names = Object.keys(calendarRealm.tables)) {
  return Object.fromEntries(names.map(table => [table, db.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
}
type SeriesPlan = Record<'source' | 'generation' | 'segment' | 'grant' | 'preparation' | 'receipt', Row>;
function plan(db: Database, suffix = '', patch: Partial<SeriesPlan> = {}, request = 'series-plan' + suffix, selectedScope = scope, selectedPrincipal = principal): SeriesPlan {
  const scope = selectedScope, principal = selectedPrincipal;
  const seriesId = 'series' + suffix, generationId = 'generation' + suffix, grantId = 'grant' + suffix, preparationId = 'preparation' + suffix;
  const receiptId = hash([scope, principal, request]);
  const data = {
    source: { id: seriesId, scope_id: scope, owner_id: owner, source_id: 'fixed-series-source' + suffix, created_by: 'synthetic-user', control_revision: 1, initial_acceptance_receipt_id: receiptId, lifecycle: 'active', grant_epoch: 1,
      current_grant_id: grantId, published_generation_id: null, published_publication_id: null, active_preparation_id: preparationId },
    generation: { id: generationId, scope_id: scope, series_id: seriesId, generation: 1, predecessor_id: null, base_publication_id: null, kind: 'timed-series-v1',
      authoring_json: JSON.stringify(authoring), authoring_digest: hash(authoring), engine_generation: 'synthetic-engine-v1', policy_generation: hash('synthetic-policy-v1'), acceptance_receipt_id: receiptId },
    segment: { id: 'segment' + suffix, scope_id: scope, series_id: seriesId, generation_id: generationId, segment_key: 'original', predecessor_segment_id: null, nominal_cut: null,
      local_from: '2030-01-01', local_until: null, start_json: JSON.stringify({ localStart: authoring.recurrence.localStart, timeZone: 'UTC', fold: 'earlier' }), rule_json: JSON.stringify(authoring.recurrence.rule), template_json: JSON.stringify(authoring.template), source_digest: hash(authoring) },
    grant: { id: grantId, scope_id: scope, series_id: seriesId, generation_id: generationId, grant_revision: 1, issued_epoch: 1, owner_id: owner, source_id: 'fixed-series-source' + suffix,
      source_generation: 1, operations_json: JSON.stringify(['series.coverage.commit', 'series.coverage.prepare', 'series.coverage.reconcile']), resource_ids_json: '["r"]', authority_digest: hash('native-series-authority'), resource_digest: hash(['r']), issuance_receipt_id: receiptId, issued_ms: 1000 },
    preparation: { id: preparationId, scope_id: scope, series_id: seriesId, generation_id: generationId, grant_id: grantId, grant_epoch: 1, acceptance_receipt_id: receiptId, base_publication_id: null,
      manifest_digest: hash('synthetic-manifest' + suffix), revision: 1, state: 'preparing', created_ms: 1000, expires_ms: 10000, claim_generation: 0, claim_nonce: null, claim_until_ms: null, blocked_code: null, publication_id: null },
    receipt: { id: receiptId, scope_id: scope, principal, request_id: request, digest: hash(['human-intent', suffix]), series_id: seriesId, generation_id: generationId,
      control_revision: 1, preparation_id: preparationId, base_publication_id: null, accepted_ms: 1001, operation: 'series.plan.accepted' },
  } satisfies Record<string, Row>;
  for (const [name, value] of Object.entries(patch)) Object.assign(data[name as keyof typeof data], value);
  db.transaction(() => {
    insert(db, 'calendar_series', data.source); insert(db, '_calendar_series_generations', data.generation); insert(db, '_calendar_series_segments', data.segment);
    insert(db, '_calendar_series_grants', data.grant); insert(db, '_calendar_series_preparations', data.preparation); insert(db, '_calendar_series_receipts', data.receipt);
  })();
  return data;
}
type Plan = ReturnType<typeof plan>;
function nativeReceipt(db: Database, accepted: Plan, patch: Row = {}, replace = false) {
  const row: Row = { id: hash(['calendar-series-native-v1', scope, owner, accepted.source.source_id, 1, 'commit', 'original-batch']), scope_id: scope, domain: 'calendar-series-native-v1', owner_id: owner,
    source_id: accepted.source.source_id, series_id: accepted.source.id, generation_id: accepted.generation.id, source_generation: 1, grant_id: accepted.grant.id, grant_epoch: 1,
    preparation_id: accepted.preparation.id, phase: 'commit', logical_key: 'original-batch', candidate_digest: accepted.preparation.manifest_digest, cursor_digest: hash('examined-count-progress'),
    policy_digest: accepted.generation.policy_generation, outcome: 'publication.ready', accepted_ms: 2000, ...patch };
  insert(db, '_calendar_series_native_receipts', row, replace); return row;
}
function publication(db: Database, accepted: Plan, native: Row, patch: Row = {}) {
  const row: Row = { id: 'publication' + accepted.source.id, scope_id: scope, series_id: accepted.source.id, preparation_id: accepted.preparation.id, generation_id: accepted.generation.id,
    base_publication_id: null, owner_id: owner, source_id: accepted.source.source_id, source_generation: 1, grant_id: accepted.grant.id, grant_epoch: 1,
    manifest_digest: accepted.preparation.manifest_digest, native_receipt_id: native.id, published_ms: 2001, operation: 'series.publication.applied', ...patch };
  insert(db, '_calendar_series_publications', row); return row;
}
function successor(first: Plan, firstPublication: Row): SeriesPlan {
  const receiptId = hash([scope, principal, 'second-plan']), generationId = 'second-generation', grantId = 'second-grant', preparationId = 'second-preparation';
  return {
    source: first.source,
    generation: { ...first.generation, id: generationId, generation: 2, predecessor_id: first.generation.id, base_publication_id: firstPublication.id, acceptance_receipt_id: receiptId },
    segment: { ...first.segment, id: 'second-segment', generation_id: generationId, predecessor_segment_id: first.segment.id, nominal_cut: '2030-01-02T10:00:00.000' },
    grant: { ...first.grant, id: grantId, generation_id: generationId, grant_revision: 2, issued_epoch: 2, source_generation: 2, issuance_receipt_id: receiptId },
    preparation: { ...first.preparation, id: preparationId, generation_id: generationId, grant_id: grantId, grant_epoch: 2, acceptance_receipt_id: receiptId, base_publication_id: firstPublication.id },
    receipt: { ...first.receipt, id: receiptId, request_id: 'second-plan', generation_id: generationId, control_revision: 2, preparation_id: preparationId, base_publication_id: firstPublication.id },
  };
}
function acceptSuccessor(db: Database, second: SeriesPlan) {
  db.transaction(() => {
    insert(db, '_calendar_series_generations', second.generation); insert(db, '_calendar_series_segments', second.segment); insert(db, '_calendar_series_grants', second.grant);
    insert(db, '_calendar_series_preparations', second.preparation); insert(db, '_calendar_series_receipts', second.receipt);
  })();
}
function ready() {
  const f = fixture();
  try { populate(f.db); f.migrate(true); return f; }
  catch (error) { f.close(); throw error; }
}

test('private020 owns its fresh raw DDL and keeps the registered019 source/checksums and configuration inert', () => {
  const f = fixture();
  try {
    const checksums = calendarRealm.migrations.map(hashMigration), tableNames = Object.keys(calendarRealm.tables), ledger = f.db.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(calendarRealm.version).toBe('19'); expect(calendarRealm.migrationChecksums[18]!.checksum).toBe('2df83ecf28f67762f16a20499be24704889996f644ea02f9e4c08ed069cbc17e');
    expect(Object.keys(CALENDAR_SERIES_ADDITIONS)).toHaveLength(11); expect(Object.isFrozen(CALENDAR_SERIES_ADDITIONS)).toBe(true);
    expect(Object.values(CALENDAR_SERIES_ADDITIONS).every(Object.isFrozen)).toBe(true);
    expect(f.migrate(true)).toEqual(['020']); expect(calendarRealm.migrations.map(hashMigration)).toEqual(checksums); expect(Object.keys(calendarRealm.tables)).toEqual(tableNames);
    const inspected = inspectDatabaseSchema(f.db);
    expect(diffSchemaSnapshots(snapshotDeclaredTables(calendarSeriesTables()), { tables: Object.fromEntries(Object.keys(calendarSeriesTables()).map(name => [name, inspected.tables[name]!])) })).toEqual([]);
    expect(f.db.query('SELECT * FROM _calendar_series_state').all()).toEqual([{ id: 'application', version: 20 }]);
    expect(f.db.query('SELECT * FROM _migrations ORDER BY version LIMIT 19').all()).toEqual(ledger);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]); expect(f.migrate(true)).toEqual([]);
    for (const table of Object.keys(CALENDAR_SERIES_CAPACITY)) expect(f.db.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  } finally { f.close(); }
});

test('genuine populated019 upgrade preserves every retained row, usage, sequence, ordinary receipt and old effect', () => {
  const f = fixture();
  try {
    const accepted = populate(f.db), retained = rows(f.db), ledger = f.db.query('SELECT * FROM _zero_migrations ORDER BY id').all();
    expect(f.migrate(true)).toEqual(['020']); expect(rows(f.db)).toEqual(retained); expect(f.db.query('SELECT * FROM _zero_migrations ORDER BY id LIMIT 19').all()).toEqual(ledger);
    const reactive = createReactiveDB({ database: f.db, ownsDatabase: false });
    try { for (const [table, definition] of Object.entries(calendarRealm.tables)) reactive.defineTable(table, definition);
      expect(reactive.currentSeq).toBe(accepted.sequence);
      expect(commandValue(runDatabaseRealmCommand(calendarRealm, reactive, 'calendar.appointment.create', accepted.booking as never))).toEqual(accepted.receipt);
      expect(reactive.currentSeq).toBe(accepted.sequence);
    } finally { reactive.dispose(); }
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('genuine016 populated native migration reaches private020 without changing original tables, functions or accepted facts', () => {
  const f = fixture('016');
  try {
    const accepted = populate(f.db, true), retained = rows(f.db, Object.keys(calendarRealm016.tables)), ledger = f.db.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(f.migrate(true)).toEqual(['017', '018', '019', '020']);
    for (const [table, original] of Object.entries(retained)) for (const row of original as Row[]) expect(f.db.query(`SELECT ${Object.keys(row).join(',')} FROM ${table} WHERE id=?`).get(row.id!)).toEqual(row);
    expect(f.db.query('SELECT * FROM _migrations ORDER BY version LIMIT 16').all()).toEqual(ledger);
    const reactive = createReactiveDB({ database: f.db, ownsDatabase: false });
    try { for (const [table, definition] of Object.entries(calendarRealm.tables)) reactive.defineTable(table, definition);
      expect(reactive.currentSeq).toBe(accepted.sequence);
      expect(commandValue(runDatabaseRealmCommand(calendarRealm, reactive, 'calendar.appointment.create', accepted.booking as never))).toEqual(accepted.receipt);
    } finally { reactive.dispose(); }
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('late DDL collision atomically rolls back every020 addition and leaves populated019 bytes/evidence identical', () => {
  const f = fixture();
  try {
    populate(f.db); f.db.run('CREATE TABLE calendar_series_effect_receipt(id TEXT PRIMARY KEY)');
    const before = f.db.serialize(), old = rows(f.db);
    expect(() => migrateCalendarSeries(f.db)).toThrow(); expect(f.db.serialize()).toEqual(before); expect(rows(f.db)).toEqual(old);
    for (const table of Object.keys(CALENDAR_SERIES_ADDITIONS)) expect(f.db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(table)).toBeNull();
  } finally { f.close(); }
});

const malformedAdditions = [
    (db: Database) => db.run('CREATE TABLE _calendar_series_grants(id TEXT PRIMARY KEY)'),
    (db: Database) => db.run('CREATE TABLE _calendar_series_unknown(id TEXT PRIMARY KEY)'),
    (db: Database) => db.run('CREATE TABLE _Calendar_Series_Unknown(id TEXT PRIMARY KEY)'),
    (db: Database) => { const table = CALENDAR_SERIES_ADDITIONS._calendar_series_state!; db.run(`CREATE TABLE _calendar_series_state(${Object.entries(table).map(([name, declaration]) => `${name} ${declaration}`).join(',')})`); db.run("INSERT INTO _calendar_series_state VALUES('application',20)"); },
    (db: Database) => { const table = CALENDAR_SERIES_ADDITIONS._calendar_series_state!; db.run(`CREATE TABLE _calendar_series_state(${Object.entries(table).map(([name, declaration]) => `${name} ${declaration}`).join(',')})`); db.run('CREATE INDEX synthetic_foreign_series_state ON _calendar_series_state(version)'); },
  ];
for (const [index, setup] of malformedAdditions.entries()) test('malformed/populated/foreign/unknown additions reject without retaining new DDL: ' + index, () => {
  const f = fixture(); try { populate(f.db); setup(f.db); const before = f.db.serialize(); expect(() => migrateCalendarSeries(f.db)).toThrow(); expect(f.db.serialize()).toEqual(before); } finally { f.close(); }
});

test('complete deferred source/grant/segment/preparation seals one immutable human acceptance, never an applied appointment', () => {
  const f = ready();
  try {
    const old = rows(f.db), accepted = plan(f.db);
    expect(rows(f.db)).toEqual(old); expect(f.db.query('SELECT operation FROM _calendar_series_receipts').all()).toEqual([{ operation: 'series.plan.accepted' }]);
    expect(f.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]); expect(f.db.query('SELECT * FROM _calendar_series_effect_intents').all()).toEqual([]);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    for (const [table, row] of [['_calendar_series_generations', accepted.generation], ['_calendar_series_segments', accepted.segment], ['_calendar_series_grants', accepted.grant], ['_calendar_series_receipts', accepted.receipt]] as const) {
      const before = f.db.serialize(); expect(() => f.db.run(`UPDATE ${table} SET id=id WHERE id=?`, [row.id])).toThrow(); expect(() => f.db.run(`DELETE FROM ${table} WHERE id=?`, [row.id])).toThrow(); expect(() => insert(f.db, table, row, true)).toThrow(); expect(f.db.serialize()).toEqual(before);
    }
    expect(() => insert(f.db, '_calendar_series_segments', { ...accepted.segment, id: 'late-segment', segment_key: 'late' })).toThrow(/sealed/);
    expect(() => insert(f.db, '_calendar_series_grants', { ...accepted.grant, id: 'late-grant', grant_revision: 2 })).toThrow();
    expect(() => insert(f.db, '_calendar_series_receipts', { ...accepted.receipt, id: 'different-id' }, true)).toThrow();
  } finally { f.close(); }
});

test('missing deferred acceptance, substituted owner/scope, unsupported LocalDate and malformed grant resources roll back whole sources', () => {
  const f = ready();
  try {
    const initial = f.db.serialize();
    for (const patch of invalidPlans(
      { source: { owner_id: 'substituted-owner' } }, { source: { scope_id: 'tenant:other' } }, { generation: { scope_id: 'tenant:other' } },
      { generation: { kind: 'all-day-series-v1' } }, { grant: { owner_id: 'substituted-owner' } }, { grant: { source_generation: 2 } },
      { grant: { resource_ids_json: '["r","r"]' } }, { grant: { resource_ids_json: '["r","foreign-resource"]' } }, { grant: { operations_json: '["arbitrary.command"]' } },
      { preparation: { scope_id: 'tenant:other' } }, { preparation: { state: 'published' } }, { receipt: { operation: 'series.publication.applied' } }, { receipt: { control_revision: 99 } },
    )) { expect(() => plan(f.db, '', patch)).toThrow(); expect(f.db.serialize()).toEqual(initial); }
    expect(() => f.db.transaction(() => insert(f.db, 'calendar_series', { id: 'unsealed', scope_id: scope, owner_id: owner, source_id: 'unsealed', created_by: 'synthetic-user', control_revision: 1, initial_acceptance_receipt_id: 'missing-receipt', lifecycle: 'active', grant_epoch: 1, current_grant_id: 'missing-grant', published_generation_id: null, published_publication_id: null, active_preparation_id: 'missing-preparation' }))()).toThrow();
    expect(f.db.serialize()).toEqual(initial);
  } finally { f.close(); }
});

test('series human keys are mutually exclusive with all seven existing families, including REPLACE and operator tuples', () => {
  const f = ready();
  try {
    const accepted = plan(f.db), initial = f.db.serialize();
    for (const table of ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts', '_calendar_location_receipts', '_calendar_type_receipts', '_calendar_lifecycle_receipts', '_calendar_integration_operator_requests']) {
      // Our tuple guard runs before legacy parent checks; no legacy fact is fabricated.
      expect(() => insert(f.db, table, { id: 'a-distinct-family-id', scope_id: scope, principal, request_id: accepted.receipt.request_id }, true)).toThrow(/human request key/);
      expect(() => insert(f.db, table, { id: accepted.receipt.id, scope_id: scope, principal, request_id: 'a-distinct-human-tuple' }, true)).toThrow(/human request key/);
      expect(f.db.serialize()).toEqual(initial);
      expect(f.db.query('SELECT sql FROM sqlite_schema WHERE name=?').get('calendar_series_human_key_' + table)).toBeTruthy();
    }
    expect(() => plan(f.db, '-ordinary-collision', {}, 'ordinary-resource')).toThrow(/human request key/); expect(f.db.serialize()).toEqual(initial);
    const occupiedId = hash([scope, principal, 'ordinary-resource']);
    expect(() => plan(f.db, '-ordinary-id-collision', { source: { initial_acceptance_receipt_id: occupiedId }, generation: { acceptance_receipt_id: occupiedId }, grant: { issuance_receipt_id: occupiedId }, preparation: { acceptance_receipt_id: occupiedId }, receipt: { id: occupiedId } }, 'different-human-tuple')).toThrow(/human request key/); expect(f.db.serialize()).toEqual(initial);
    // Native receipts may use a coincident opaque id; they never impersonate a human tuple.
    expect(nativeReceipt(f.db, accepted, { id: accepted.receipt.id }).id).toBe(accepted.receipt.id);
  } finally { f.close(); }
});

test('native receipt admission is fixed owner/source/generation/phase authority; exact original evidence survives later retirement', () => {
  const f = ready();
  try {
    const accepted = plan(f.db), initial = f.db.serialize();
    for (const patch of invalidRows({ domain: 'human' }, { owner_id: 'foreign-owner' }, { source_id: 'foreign-source' }, { source_generation: 2 }, { scope_id: 'tenant:other' }, { grant_epoch: 2 }, { phase: 'prepare' }, { policy_digest: hash('other-policy') }, { accepted_ms: 10000 })) {
      expect(() => nativeReceipt(f.db, accepted, patch)).toThrow(); expect(f.db.serialize()).toEqual(initial);
    }
    const native = nativeReceipt(f.db, accepted); expect(() => nativeReceipt(f.db, accepted, { id: 'different-id' }, true)).toThrow();
    expect(() => f.db.run('UPDATE _calendar_series_native_receipts SET outcome=outcome')).toThrow();
    publication(f.db, accepted, native);
    f.db.run("UPDATE calendar_series SET lifecycle='retired',control_revision=control_revision+1,grant_epoch=grant_epoch+1 WHERE id=?", [accepted.source.id]);
    expect(f.db.query('SELECT * FROM _calendar_series_native_receipts WHERE id=?').get(native.id)).toEqual(native);
    expect(() => nativeReceipt(f.db, accepted, { id: 'new-native-after-retirement', logical_key: 'new-batch' })).toThrow();
  } finally { f.close(); }
});

test('one immutable publication atomically selects its complete preparation and cannot publish stale, expired or mismatched facts', () => {
  const f = ready();
  try {
    const accepted = plan(f.db), native = nativeReceipt(f.db, accepted), initial = f.db.serialize(), old = rows(f.db);
    for (const patch of invalidRows({ manifest_digest: hash('wrong') }, { owner_id: 'substitution' }, { grant_epoch: 2 }, { published_ms: 10000 }, { generation_id: 'missing' }, { base_publication_id: 'missing' })) {
      expect(() => publication(f.db, accepted, native, patch)).toThrow(); expect(f.db.serialize()).toEqual(initial);
    }
    const applied = publication(f.db, accepted, native);
    expect(f.db.query('SELECT published_generation_id,published_publication_id,active_preparation_id,control_revision FROM calendar_series').get()).toEqual({ published_generation_id: accepted.generation.id, published_publication_id: applied.id, active_preparation_id: null, control_revision: 1 });
    expect(f.db.query('SELECT state,revision,publication_id FROM _calendar_series_preparations').get()).toEqual({ state: 'published', revision: 2, publication_id: applied.id });
    expect(f.db.query('SELECT operation FROM _calendar_series_receipts').get()).toEqual({ operation: 'series.plan.accepted' }); expect(rows(f.db)).toEqual(old);
    const final = f.db.serialize(); expect(() => publication(f.db, accepted, native, { id: 'another-publication' })).toThrow(); expect(() => f.db.run('UPDATE _calendar_series_publications SET manifest_digest=manifest_digest')).toThrow(); expect(() => f.db.run('DELETE FROM _calendar_series_publications')).toThrow(); expect(f.db.serialize()).toEqual(final);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('a later complete acceptance advances control/grant CAS while old published evidence stays authoritative until one cutover', () => {
  const f = ready();
  try {
    const first = plan(f.db), firstNative = nativeReceipt(f.db, first), firstPublication = publication(f.db, first, firstNative);
    const second = successor(first, firstPublication); acceptSuccessor(f.db, second);
    expect(f.db.query('SELECT control_revision,grant_epoch,current_grant_id,published_publication_id,active_preparation_id FROM calendar_series').get()).toEqual({ control_revision: 2, grant_epoch: 2, current_grant_id: second.grant.id, published_publication_id: firstPublication.id, active_preparation_id: second.preparation.id });
    expect(f.db.query('SELECT * FROM _calendar_series_publications WHERE id=?').get(firstPublication.id)).toEqual(firstPublication);
    const before = f.db.serialize(); expect(() => nativeReceipt(f.db, first, { id: hash('stale-first-operation'), logical_key: 'stale-first-operation' })).toThrow(); expect(f.db.serialize()).toEqual(before);
    const nextNative = nativeReceipt(f.db, second, { id: hash('second-native-operation'), source_generation: 2, grant_epoch: 2 });
    const nextPublication = publication(f.db, second, nextNative, { id: 'second-publication', base_publication_id: firstPublication.id, source_generation: 2, grant_epoch: 2 });
    expect(f.db.query('SELECT published_publication_id,published_generation_id,control_revision FROM calendar_series').get()).toEqual({ published_publication_id: nextPublication.id, published_generation_id: second.generation.id, control_revision: 2 });
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_publications').get()).toEqual({ n: 2 }); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('a different orphan source cannot borrow the forthcoming later-generation receipt as its deferred bootstrap anchor', () => {
  const f = ready();
  try {
    const first = plan(f.db), firstPublication = publication(f.db, first, nativeReceipt(f.db, first)), second = successor(first, firstPublication), before = f.db.serialize();
    expect(() => f.db.transaction(() => {
      insert(f.db, 'calendar_series', { ...first.source, id: 'orphan-b', source_id: 'orphan-b-source', initial_acceptance_receipt_id: second.receipt.id, current_grant_id: 'nonexistent-grant', active_preparation_id: 'nonexistent-preparation' });
      acceptSuccessor(f.db, second);
    })()).toThrow(/acceptance is inconsistent/);
    expect(f.db.serialize()).toEqual(before); expect(f.db.query('SELECT id FROM calendar_series').all()).toEqual([{ id: first.source.id }]);
    acceptSuccessor(f.db, second); expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_receipts').get()).toEqual({ n: 2 });
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('a forthcoming acceptance cannot also seal an unselected grant or another source generation/preparation', () => {
  const f = ready();
  try {
    const first = plan(f.db), firstPublication = publication(f.db, first, nativeReceipt(f.db, first)), second = successor(first, firstPublication), before = f.db.serialize();
    expect(() => f.db.transaction(() => {
      insert(f.db, '_calendar_series_generations', second.generation); insert(f.db, '_calendar_series_segments', second.segment); insert(f.db, '_calendar_series_grants', second.grant);
      insert(f.db, '_calendar_series_grants', { ...second.grant, id: 'unselected-extra-grant', grant_revision: 3 });
      insert(f.db, '_calendar_series_preparations', second.preparation); insert(f.db, '_calendar_series_receipts', second.receipt);
    })()).toThrow(/acceptance is inconsistent/);
    expect(f.db.serialize()).toEqual(before);
    const other = plan(f.db, '-other'), otherPublication = publication(f.db, other, nativeReceipt(f.db, other)), otherNext = successor(other, otherPublication), withOther = f.db.serialize();
    expect(() => f.db.transaction(() => {
      insert(f.db, '_calendar_series_generations', { ...otherNext.generation, id: 'orphan-other-generation', acceptance_receipt_id: second.receipt.id });
      acceptSuccessor(f.db, second);
    })()).toThrow(); expect(f.db.serialize()).toEqual(withOther);
    expect(() => f.db.transaction(() => {
      insert(f.db, '_calendar_series_generations', second.generation); insert(f.db, '_calendar_series_segments', second.segment); insert(f.db, '_calendar_series_grants', second.grant);
      insert(f.db, '_calendar_series_preparations', { ...second.preparation, id: 'orphan-preparation', series_id: other.source.id });
      insert(f.db, '_calendar_series_preparations', second.preparation); insert(f.db, '_calendar_series_receipts', second.receipt);
    })()).toThrow(); expect(f.db.serialize()).toEqual(withOther);
    acceptSuccessor(f.db, second); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('late publication selector failure rolls back its marker, preparation transition and retained counters atomically', () => {
  const f = ready();
  try {
    const accepted = plan(f.db), native = nativeReceipt(f.db, accepted);
    f.db.run("CREATE TRIGGER synthetic_series_late_publication BEFORE UPDATE ON calendar_series WHEN NEW.published_publication_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Synthetic late selector refusal'); END");
    const before = f.db.serialize(); expect(() => publication(f.db, accepted, native)).toThrow(/Synthetic late selector refusal/); expect(f.db.serialize()).toEqual(before);
    expect(f.db.query('SELECT state,publication_id FROM _calendar_series_preparations').get()).toEqual({ state: 'preparing', publication_id: null });
    expect(f.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]); expect(f.db.query("SELECT count FROM _calendar_series_capacity WHERE id='_calendar_series_publications'").get()).toEqual({ count: 0 });
  } finally { f.close(); }
});

test('preparation/claim/source CAS keeps immutable candidates and rejects stale transitions or forged publication pointers', () => {
  const f = ready();
  try {
    const accepted = plan(f.db), initial = f.db.serialize();
    for (const sql of ["UPDATE _calendar_series_preparations SET state='blocked',blocked_code='WAIT'", "UPDATE _calendar_series_preparations SET revision=revision+1,manifest_digest='" + hash('tamper') + "'", "UPDATE calendar_series SET control_revision=control_revision+2", "UPDATE calendar_series SET published_publication_id='fabricated'", "UPDATE calendar_series SET active_preparation_id=NULL"]) {
      expect(() => f.db.run(sql)).toThrow(); expect(f.db.serialize()).toEqual(initial);
    }
    f.db.run('UPDATE _calendar_series_preparations SET revision=revision+1,claim_generation=1,claim_nonce=?,claim_until_ms=5000', ['a'.repeat(32)]);
    f.db.run("UPDATE _calendar_series_preparations SET revision=revision+1,state='blocked',blocked_code='POLICY_REVIEW',claim_nonce=NULL,claim_until_ms=NULL");
    expect(f.db.query('SELECT state,revision,claim_generation FROM _calendar_series_preparations').get()).toEqual({ state: 'blocked', revision: 3, claim_generation: 1 });
    expect(() => publication(f.db, accepted, nativeReceipt(f.db, accepted))).toThrow();
    f.db.run("UPDATE _calendar_series_preparations SET revision=revision+1,state='preparing',blocked_code=NULL");
    const native = f.db.query('SELECT * FROM _calendar_series_native_receipts').get() as Row;
    publication(f.db, accepted, native);
    expect(() => f.db.run('UPDATE _calendar_series_preparations SET revision=revision+1')).toThrow();
  } finally { f.close(); }
});

test('private effects bind exact receipt families/publications and never authorize invented child or legacy appointment facts', () => {
  const f = ready();
  try {
    const accepted = plan(f.db), human: Row = { id: 'human-effect', scope_id: scope, series_id: accepted.source.id, generation_id: accepted.generation.id, preparation_id: accepted.preparation.id,
      receipt_family: 'human', receipt_id: accepted.receipt.id, operation: 'series.plan.accepted', publication_id: null, child_version_id: null, child_binding_digest: null };
    const initial = f.db.serialize();
    for (const patch of invalidRows({ receipt_family: 'native' }, { receipt_id: 'missing' }, { scope_id: 'tenant:other' }, { child_version_id: 'imaginary-child', child_binding_digest: hash('binding') }, { operation: 'series.publication.applied' })) {
      expect(() => insert(f.db, '_calendar_series_effect_intents', { ...human, ...patch })).toThrow(); expect(f.db.serialize()).toEqual(initial);
    }
    insert(f.db, '_calendar_series_effect_intents', human); expect(() => insert(f.db, '_calendar_series_effect_intents', { ...human, id: 'duplicate-seal' }, true)).toThrow();
    const native = nativeReceipt(f.db, accepted), applied = publication(f.db, accepted, native);
    insert(f.db, '_calendar_series_effect_intents', { ...human, id: 'publication-effect', receipt_family: 'native', receipt_id: native.id, operation: 'series.publication.applied', publication_id: applied.id });
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_effect_intents').get()).toEqual({ n: 2 });
    expect(f.db.query('SELECT title FROM calendar_appointments').all()).toEqual([{ title: 'PRIVATE_OLD_APPOINTMENT' }]);
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_effect_intents').get()).toEqual({ n: 2 });
  } finally { f.close(); }
});

test('retained source counters have finite exact conserved ceilings and reject manual rollback, raise and replacement', () => {
  const f = ready();
  try {
    plan(f.db); const counters = f.db.query('SELECT * FROM _calendar_series_capacity ORDER BY id').all() as { id: keyof typeof CALENDAR_SERIES_CAPACITY; count: number; ceiling: number }[];
    for (const counter of counters) {
      expect(counter.ceiling).toBe(CALENDAR_SERIES_CAPACITY[counter.id]); expect(counter.count).toBe((f.db.query(`SELECT count(*) AS n FROM ${counter.id}`).get() as { n: number }).n);
      expect(Number.isFinite(counter.ceiling)).toBe(true);
    }
    const initial = f.db.serialize();
    for (const sql of ["UPDATE _calendar_series_capacity SET count=0 WHERE id='calendar_series'", "UPDATE _calendar_series_capacity SET count=count+2 WHERE id='calendar_series'", "UPDATE _calendar_series_capacity SET ceiling=ceiling+1 WHERE id='calendar_series'", "DELETE FROM _calendar_series_capacity WHERE id='calendar_series'", "INSERT OR REPLACE INTO _calendar_series_capacity VALUES('calendar_series',0,10000)"]) {
      expect(() => f.db.run(sql)).toThrow(); expect(f.db.serialize()).toEqual(initial);
    }
  } finally { f.close(); }
});

test('finite retained source pressure rejects the whole next acceptance without opening an unbounded history exception', () => {
  const f = ready();
  try {
    plan(f.db);
    // Deliberately conservative raw pressure injection; never decreases an
    // authoritative count, fabricates accepted rows or claims a scale benchmark.
    const increment = f.db.prepare("UPDATE _calendar_series_capacity SET count=count+1 WHERE id='calendar_series'");
    try { f.db.transaction(() => { for (let index = 1; index < CALENDAR_SERIES_CAPACITY.calendar_series; index++) increment.run(); })(); }
    finally { increment.finalize(); }
    const before = f.db.serialize(); expect(() => plan(f.db, '-over-retained-budget')).toThrow(/capacity exhausted/); expect(f.db.serialize()).toEqual(before);
  } finally { f.close(); }
});

test('canonical maximum tenant scope and principal fit without narrowing Guardian identities', () => {
  const f = fixture(), maximumScope = 'tenant:' + 'a'.repeat(256), maximumPrincipal = 'p'.repeat(256);
  try {
    populate(f.db, false, maximumScope); f.migrate(true);
    const accepted = plan(f.db, '', {}, 'maximum-key', maximumScope, maximumPrincipal);
    expect(f.db.query('SELECT length(scope_id) AS n FROM calendar_series').get()).toEqual({ n: 263 });
    expect(f.db.query('SELECT principal,id FROM _calendar_series_receipts').get()).toEqual({ principal: maximumPrincipal, id: hash([maximumScope, maximumPrincipal, 'maximum-key']) });
    expect(accepted.receipt.scope_id).toBe(maximumScope); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('new source admission probes use bounded indexed identities rather than scanning retained source history', () => {
  const f = ready();
  try {
    const accepted = plan(f.db);
    for (const [sql, params, index] of [
      ['SELECT COALESCE(max(generation),0)+1 FROM _calendar_series_generations WHERE scope_id=? AND series_id=?', [scope, accepted.source.id], 'calendar_series_generation_identity'],
      ['SELECT COALESCE(max(grant_revision),0)+1 FROM _calendar_series_grants WHERE scope_id=? AND series_id=?', [scope, accepted.source.id], 'calendar_series_grant_identity'],
      ['SELECT 1 FROM _calendar_series_receipts WHERE generation_id=?', [accepted.generation.id], 'calendar_series_receipt_generation'],
      ['SELECT count(*) FROM _calendar_series_segments WHERE generation_id=?', [accepted.generation.id], 'calendar_series_segment_generation'],
      ['SELECT 1 FROM _calendar_series_grants WHERE issuance_receipt_id=?', [accepted.receipt.id], 'calendar_series_grant_issuance'],
      ['SELECT 1 FROM _calendar_series_preparations WHERE acceptance_receipt_id=?', [accepted.receipt.id], 'calendar_series_preparation_acceptance'],
    ] as const) {
      const explained = f.db.query('EXPLAIN QUERY PLAN ' + sql).all(...params) as { detail: string }[];
      expect(explained.some(row => row.detail.includes('SEARCH') && row.detail.includes(index))).toBe(true);
      expect(explained.some(row => /SCAN (?:_calendar_series|calendar_series)/.test(row.detail))).toBe(false);
    }
    const counterTriggers = f.db.query("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name LIKE '%_series_counter'").all() as { sql: string }[];
    expect(counterTriggers).toHaveLength(Object.keys(CALENDAR_SERIES_CAPACITY).length);
    expect(counterTriggers.every(trigger => !trigger.sql.includes('SELECT count(*)'))).toBe(true);
  } finally { f.close(); }
});
