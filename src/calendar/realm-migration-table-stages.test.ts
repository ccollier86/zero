/** Genuine raw Calendar001–016 startup/reopen. No predeclared application tables or physical output. */
import { Database } from 'bun:sqlite';
import { expect, test, spyOn } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { hashMigration } from '../migrations/schema-snapshot';
import { defineDatabaseRealm, runDatabaseRealmCommand } from '../databases/database-realm';
import { assertDatabaseOpenAdmission } from '../databases/database-open-admission';
import { createDatabaseRef } from '../databases/database-file';
import { createReactiveDB } from '../sync/reactive-db';
import { initializeDatabaseReceiptSchema } from '../databases/database-receipt-schema';
import type { DatabaseRuntime } from '../databases/database-runtime';
import { assertDatabaseRealmMigrationSource } from '../databases/database-realm-migration-tables';
import { CALENDAR_MIGRATION_TABLE_STAGES } from './realm-migration-table-stages';
import { calendarRealm } from './realm';
const preManifest = defineDatabaseRealm({ name: calendarRealm.name, version: '16', tables: calendarRealm.tables,
  migrations: calendarRealm.migrations, queries: calendarRealm.queries, commands: calendarRealm.commands });
function insert(database: Database, table: string, row: Record<string, string | number | null>) {
  database.run(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`, Object.values(row));
}
function fixture() {
  const db = new Database(':memory:');
  try { db.run('PRAGMA temp_store=MEMORY'); db.run('PRAGMA foreign_keys=ON');
    const migrate = (target?: string) => {
      const migrator = new Migrator({ database: db, dbPath: ':memory:', migrations: calendarRealm.migrations,
        migrationTableStages: calendarRealm.migrationTableStages, createBackups: false, log() {} });
      try { return migrator.run(target); } finally { migrator.dispose(); }
    };
    return { db, migrate, close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}
test('Calendar opts into native stages with unchanged016 schema/handlers and genuine pre-manifest identity', () => {
  expect(calendarRealm.migrationTableStages).toEqual(CALENDAR_MIGRATION_TABLE_STAGES); expect(calendarRealm.version).toBe('16');
  expect(preManifest).not.toHaveProperty('migrationTableStages');
  expect(preManifest.fingerprint).toBe('sha256:2b0e98dabe59b6cf27edf49b3bb37b3f11dc6b1e6d0274c6a590db5a3ba601b5');
  expect(preManifest.schemaChecksum).toBe('a9de3c82718367f9dfb5db628706f7a2b2fda542d12fc27be8d2d589a8d1f2a4');
  expect(preManifest.migrationChecksums).toEqual(calendarRealm.migrationChecksums);
  expect(preManifest.migrations.map(hashMigration)).toEqual(calendarRealm.migrations.map(hashMigration));
  expect(preManifest.fingerprint).not.toBe(calendarRealm.fingerprint);
  expect(CALENDAR_MIGRATION_TABLE_STAGES.map(stage => stage.prepare)).toEqual([...Array(15).fill('create-added-tables'), undefined]);
});
test('genuine populated pre-manifest016 retains original receipts/data/ledger through readonly current admission and explicit no-op preparation', () => {
  const raw = new Database(':memory:'), reference = createDatabaseRef('synthetic-premanifest-calendar'), instance = '00000000-0000-4000-8000-000000000001';
  let db: ReturnType<typeof createReactiveDB> | undefined;
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    raw.run(`CREATE TABLE _zero_database_binding_v1 (
      singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
      format_version INTEGER NOT NULL CHECK (format_version = 1),
      database_ref TEXT NOT NULL CHECK (length(database_ref) = 64),
      instance_id TEXT NOT NULL CHECK (length(instance_id) = 36),
      realm_name TEXT NOT NULL CHECK (length(realm_name) BETWEEN 1 AND 128)
    ) WITHOUT ROWID`);
    raw.run('INSERT INTO _zero_database_binding_v1 VALUES(1,1,?,?,?)', [reference, instance, preManifest.name]);
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) raw.run(`CREATE TRIGGER _zero_database_binding_${action.toLowerCase()}_guard_v1 BEFORE ${action} ON _zero_database_binding_v1 BEGIN
      SELECT RAISE(ABORT, 'zero database binding is immutable'); END`);
    // Independently reconstruct the OLD016 setup. No manifest/stage helper
    // participates in producing this retained source or its historical ledger.
    db = createReactiveDB({ database: raw, ownsDatabase: false });
    for (const [name, schema] of Object.entries(preManifest.tables)) db.defineTable(name, schema);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: preManifest.migrations, createBackups: false, log() {} });
    try { expect(historical.run()).toHaveLength(16); } finally { historical.dispose(); }
    const actor = { scopeId: 'application', userId: 'owner', principal: 'session', manageAll: true, createOwn: true };
    const command = (realm: typeof calendarRealm, name: string, input: Record<string, unknown>): any =>
      (runDatabaseRealmCommand(realm, db!, 'calendar.' + name, input as never) as any).value;
    command(preManifest, 'owner.bind', { scopeId: actor.scopeId, ownerId: 'synthetic-premanifest-owner' });
    command(preManifest, 'resource.create', { actor, requestId: 'resource', id: 'resource', label: 'PRIVATE_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    const booking = { actor, requestId: 'original-booking', id: 'appointment', title: 'PRIVATE_ORIGINAL_TITLE', resourceIds: ['resource'],
      startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    const accepted = command(preManifest, 'appointment.create', booking);
    expect(accepted).toMatchObject({ requestId: booking.requestId, operation: 'appointment.created', id: booking.id, revision: 1 });
    initializeDatabaseReceiptSchema({ runtime: { db } as DatabaseRuntime, realmFingerprint: preManifest.fingerprint, validateLegacyResult() {} });
    const before = raw.serialize(), seq = db.currentSeq, ledger = raw.query('SELECT * FROM _zero_migrations ORDER BY id').all();
    const observe = spyOn(Migrator.prototype, 'run'), copy = Database.deserialize(before, { readonly: true, strict: true });
    try {
      copy.run('PRAGMA query_only=ON');
      assertDatabaseOpenAdmission({ database: copy, realm: calendarRealm, databaseRef: reference, instanceId: instance,
        admission: { schema: 'current', row: { table: '_calendar_owner', id: 'application', equals: { scope_id: actor.scopeId, owner_id: 'synthetic-premanifest-owner' } } } });
      expect(observe).not.toHaveBeenCalled(); expect(copy.serialize()).toEqual(before);
    } finally { observe.mockRestore(); copy.close(); }
    expect(raw.serialize()).toEqual(before); expect(db.currentSeq).toBe(seq);
    const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations,
      migrationTableStages: calendarRealm.migrationTableStages, createBackups: false, log() {} });
    try { expect(current.run()).toEqual([]); } finally { current.dispose(); }
    expect(raw.query('SELECT * FROM _zero_migrations ORDER BY id').all()).toEqual(ledger);
    expect(command(calendarRealm, 'appointment.create', booking)).toEqual(accepted);
    expect(db.currentSeq).toBe(seq); expect(raw.serialize()).toEqual(before);
  } finally { try { db?.dispose(); } finally { raw.close(); } }
});
test('native boundary preparation preserves populated010 evidence through011/012/014/016 derived backfills', () => {
  const f = fixture();
  try {
    f.migrate('010'); const scope_id = 'application';
    insert(f.db, '_calendar_owner', { id: 'application', scope_id, owner_id: 'owner' });
    insert(f.db, 'calendar_resources', { id: 'resource', scope_id, label: 'PRIVATE_RESOURCE', kind: 'person', owner_id: 'user', time_zone: 'UTC', revision: 1, active: 1 });
    insert(f.db, 'calendar_appointments', { id: 'appointment', scope_id, title: 'PRIVATE_TITLE', start_at: '1970-01-01T00:00:01.000Z', end_at: '1970-01-01T00:00:02.000Z',
      start_ms: 1000, end_ms: 2000, time_zone: 'UTC', buffer_before: 0, buffer_after: 0, occupied_start_ms: 1000, occupied_end_ms: 2000, status: 'confirmed', revision: 1, created_by: 'user' });
    insert(f.db, '_calendar_reservations', { id: 'reservation', scope_id, appointment_id: 'appointment', resource_id: 'resource', occupied_start_ms: 1000, occupied_end_ms: 2000, active: 1 });
    insert(f.db, '_calendar_receipts', { id: 'receipt', scope_id, principal: 'session', request_id: 'request', digest: 'digest',
      result_json: JSON.stringify({ requestId: 'request', operation: 'appointment.created', id: 'appointment', revision: 1, changed: true }), target_kind: 'appointment', target_id: 'appointment', required_right: 'book' });
    insert(f.db, '_calendar_effect_intents', { id: 'effect', scope_id, receipt_id: 'receipt', operation: 'appointment.created', target_kind: 'appointment', target_id: 'appointment', revision: 1 });
    const sourceId = 'src_' + 'a'.repeat(64);
    const registration = JSON.stringify({ id: sourceId, policyHash: 'source-policy-hash', state: 'active', generation: 1, revision: 1 });
    insert(f.db, '_calendar_integration_policy_history', { id: 'policy', scope_id, rule_id: 'rule', epoch: 1, request_id: 'policy-request', digest: 'policy-digest',
      policy_json: JSON.stringify({ ruleId: 'rule', adapter: 'observation-v1', source: { identity: { scopeId: scope_id, ownerId: 'owner' } }, dueOffsetMs: 0, maxLatenessMs: 1000 }),
      source_id: sourceId, source_policy_hash: 'source-policy-hash', created_ms: 0 });
    insert(f.db, '_calendar_integration_policy_current', { id: 'rule', scope_id, rule_id: 'rule', policy_id: 'policy', epoch: 1, state: 'activating', registration_json: null });
    insert(f.db, '_calendar_integration_policy_registrations', { id: 'policy', scope_id, policy_id: 'policy', registration_json: registration });
    f.db.run("UPDATE _calendar_integration_policy_current SET state='active',registration_json=? WHERE id='rule'", [registration]);
    insert(f.db, '_calendar_integration_intents', { id: 'intent', scope_id, owner_id: 'owner', policy_id: 'policy', rule_id: 'rule', policy_epoch: 1,
      source_effect_id: 'effect', appointment_id: 'appointment', appointment_revision: 1, create_key: 'cal-create:intent', cancel_key: 'cal-cancel:intent',
      input_json: JSON.stringify({ kind: 'calendar-observation-v1', intentId: 'intent', appointmentRevision: 1, policyEpoch: 1 }), due_ms: 1000, expires_ms: 2000, initiated_by: 'user' });
    insert(f.db, '_calendar_integration_dispatch', { id: 'intent', scope_id, rule_id: 'rule', policy_epoch: 1, appointment_id: 'appointment', appointment_revision: 1,
      eligibility: 'current', state: 'pending', claim_nonce: null, claim_generation: 0, claim_until_ms: null, claim_previous_attempted: 0, create_attempted: 0, next_attempt_ms: 0, blocked_code: null });
    insert(f.db, '_calendar_integration_effect_admissions', { id: 'intent', scope_id, intent_id: 'intent', execution_id: 'execution', nonce: 'nonce', admitted_ms: 1000, registration_json: registration });
    const retained = () => JSON.stringify(Object.fromEntries(Object.keys(CALENDAR_MIGRATION_TABLE_STAGES[9]!.tables).map(name => [name, f.db.query(`SELECT * FROM ${name} ORDER BY id`).all()])));
    const before = retained(), ledger = f.db.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(f.migrate()).toEqual(['011', '012', '013', '014', '015', '016']); expect(retained()).toBe(before);
    expect(f.db.query('SELECT * FROM _migrations ORDER BY version LIMIT 10').all()).toEqual(ledger);
    expect(f.db.query('SELECT * FROM _calendar_integration_rule_sources').all()).toEqual([{ id: 'rule', scope_id, rule_id: 'rule', source_id: sourceId }]);
    expect(f.db.query('SELECT * FROM _calendar_integration_pending_effects').all()).toEqual([{ id: 'intent', scope_id }]);
    expect(f.db.query('SELECT appointment_id,resource_id,binding_revision FROM _calendar_appointment_resource_current').all()).toEqual([{ appointment_id: 'appointment', resource_id: 'resource', binding_revision: 1 }]);
    expect(f.db.query('SELECT * FROM _calendar_appointment_update_history').all()).toEqual([]);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
test('raw fresh source runs all sixteen unchanged migrations without latest-schema predefinition', () => {
  const f = fixture();
  try { expect(f.db.query("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all()).toEqual([]);
    expect(f.migrate()).toEqual(calendarRealm.migrations.map(migration => migration.version));
    expect(assertDatabaseRealmMigrationSource(f.db, calendarRealm.migrationTableStages!, calendarRealm.migrations)).toBe(16);
    expect(f.db.query('SELECT * FROM _calendar_appointment_resource_state').all()).toEqual([{ id: 'application', version: 16 }]);
    expect(f.db.query('SELECT * FROM _calendar_appointment_update_history').all()).toEqual([]);
    const ledger = f.db.query('SELECT * FROM _zero_migrations ORDER BY id').all(); expect(f.migrate()).toEqual([]);
    expect(f.db.query('SELECT * FROM _zero_migrations ORDER BY id').all()).toEqual(ledger); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
for (let count = 1; count < 16; count++) test('genuine populated prefix reopens without future predefinition: ' + String(count).padStart(3, '0'), () => {
  const f = fixture();
  try {
    const stage = calendarRealm.migrationTableStages![count - 1]!;
    expect(f.migrate(stage.version)).toHaveLength(count);
    f.db.run("INSERT INTO _calendar_owner(id,scope_id,owner_id) VALUES('application','application','synthetic-owner')");
    const owner = f.db.query('SELECT * FROM _calendar_owner').all(), ledger = f.db.query('SELECT * FROM _migrations ORDER BY version').all();
    for (const name of Object.keys(calendarRealm.tables)) if (!Object.hasOwn(stage.tables, name)) expect(f.db.query('SELECT name FROM sqlite_schema WHERE name=?').get(name)).toBeNull();
    expect(assertDatabaseRealmMigrationSource(f.db, calendarRealm.migrationTableStages!, calendarRealm.migrations)).toBe(count);
    expect(f.migrate()).toHaveLength(16 - count); expect(f.db.query('SELECT * FROM _calendar_owner').all()).toEqual(owner);
    expect(f.db.query('SELECT * FROM _migrations ORDER BY version LIMIT ?').all(count)).toEqual(ledger);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
