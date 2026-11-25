/** Private/inert020 source/acceptance groundwork. No commands, child writes, occupancy or recurrence activation. */
import type { Database, Statement } from 'bun:sqlite';
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { calendarOverrideTables } from './realm-overrides-migration';
import { CalendarError } from './error';

const source = 'calendar_series', generations = '_calendar_series_generations', segments = '_calendar_series_segments';
const grants = '_calendar_series_grants', receipts = '_calendar_series_receipts', native = '_calendar_series_native_receipts';
const preparations = '_calendar_series_preparations', publications = '_calendar_series_publications', effects = '_calendar_series_effect_intents';
const state = '_calendar_series_state', capacity = '_calendar_series_capacity';
const key = (field: string) => `TEXT NOT NULL CHECK(length(${field}) BETWEEN 1 AND 128 AND length(trim(${field}))=length(${field}))`;
const hash = (field: string, nullable = false) => `TEXT${nullable ? '' : ' NOT NULL'} CHECK(${nullable ? `${field} IS NULL OR ` : ''}(length(${field})=64 AND ${field} NOT GLOB '*[^a-f0-9]*'))`;
const positive = (field: string) => `INTEGER NOT NULL CHECK(typeof(${field})='integer' AND ${field} BETWEEN 1 AND 9007199254740991)`;
const nonnegative = (field: string) => `INTEGER NOT NULL CHECK(typeof(${field})='integer' AND ${field} BETWEEN 0 AND 9007199254740991)`;
const json = (field: string, kind: 'object' | 'array', bytes: number) => `TEXT NOT NULL CHECK(length(CAST(${field} AS BLOB))<=${bytes} AND CASE WHEN json_valid(${field}) THEN json_type(${field})='${kind}' ELSE 0 END)`;
const ref = (table: string, nullable = false) => `TEXT${nullable ? '' : ' NOT NULL'} REFERENCES ${table}(id) DEFERRABLE INITIALLY DEFERRED`;
// calendarScope admits application or tenant: followed by a 256-character tenant key.
const identity = { id: 'TEXT PRIMARY KEY NOT NULL', scope_id: "TEXT NOT NULL CHECK(scope_id='application' OR (substr(scope_id,1,7)='tenant:' AND length(scope_id) BETWEEN 8 AND 263))" };

/** Retained evidence ceilings, not a working queue or a hidden recurrence horizon.
 * Future configurable capacity must be admitted by the final writer; nothing here silently raises old budgets. */
export const CALENDAR_SERIES_CAPACITY = Object.freeze({
  [source]: 10_000, [generations]: 100_000, [segments]: 200_000, [grants]: 100_000,
  [receipts]: 200_000, [native]: 200_000, [preparations]: 100_000, [publications]: 100_000, [effects]: 200_000,
});
export const CALENDAR_SERIES_ADDITIONS: Readonly<Record<string, TableSchema>> = Object.freeze(Object.fromEntries(Object.entries({
  [state]: { id: "TEXT PRIMARY KEY NOT NULL CHECK(id='application')", version: "INTEGER NOT NULL CHECK(typeof(version)='integer' AND version=20)" },
  [capacity]: { id: 'TEXT PRIMARY KEY NOT NULL', count: nonnegative('count'), ceiling: "INTEGER NOT NULL CHECK(typeof(ceiling)='integer' AND ceiling>0 AND count<=ceiling)" },
  // The immutable acceptance anchor points FORWARD to the final receipt, whose
  // trigger checks all candidate parents. This keeps the realm FK graph acyclic
  // while a partial bootstrap still cannot COMMIT without its acceptance seal.
  [source]: { ...identity, owner_id: key('owner_id'), source_id: key('source_id'), created_by: key('created_by'), control_revision: positive('control_revision'), initial_acceptance_receipt_id: ref(receipts),
    lifecycle: "TEXT NOT NULL CHECK(lifecycle IN ('active','retired'))", grant_epoch: positive('grant_epoch'), current_grant_id: 'TEXT NOT NULL',
    published_generation_id: 'TEXT', published_publication_id: 'TEXT', active_preparation_id: 'TEXT' },
  [generations]: { ...identity, series_id: ref(source), generation: positive('generation'), predecessor_id: ref(generations, true), base_publication_id: 'TEXT',
    kind: "TEXT NOT NULL CHECK(kind='timed-series-v1')", authoring_json: json('authoring_json', 'object', 131072), authoring_digest: hash('authoring_digest'),
    engine_generation: key('engine_generation'), policy_generation: hash('policy_generation'), acceptance_receipt_id: ref(receipts) },
  [segments]: { ...identity, series_id: ref(source), generation_id: ref(generations), segment_key: key('segment_key'), predecessor_segment_id: ref(segments, true),
    nominal_cut: 'TEXT', local_from: "TEXT NOT NULL CHECK(length(local_from)=10)", local_until: "TEXT CHECK(local_until IS NULL OR (length(local_until)=10 AND local_until>local_from))",
    start_json: json('start_json', 'object', 16384), rule_json: json('rule_json', 'object', 16384), template_json: json('template_json', 'object', 65536), source_digest: hash('source_digest') },
  [grants]: { ...identity, series_id: ref(source), generation_id: ref(generations), grant_revision: positive('grant_revision'), issued_epoch: positive('issued_epoch'),
    owner_id: key('owner_id'), source_id: key('source_id'), source_generation: positive('source_generation'), operations_json: json('operations_json', 'array', 256),
    resource_ids_json: json('resource_ids_json', 'array', 4096), authority_digest: hash('authority_digest'), resource_digest: hash('resource_digest'),
    issuance_receipt_id: ref(receipts), issued_ms: nonnegative('issued_ms') },
  [receipts]: { ...identity, id: "TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64 AND id NOT GLOB '*[^a-f0-9]*')", principal: "TEXT NOT NULL CHECK(length(principal) BETWEEN 1 AND 256)", request_id: key('request_id'), digest: hash('digest'), series_id: 'TEXT NOT NULL', generation_id: 'TEXT NOT NULL',
    control_revision: positive('control_revision'), preparation_id: 'TEXT NOT NULL', base_publication_id: 'TEXT', accepted_ms: nonnegative('accepted_ms'),
    operation: "TEXT NOT NULL CHECK(operation='series.plan.accepted')" },
  [native]: { ...identity, id: "TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64 AND id NOT GLOB '*[^a-f0-9]*')", domain: "TEXT NOT NULL CHECK(domain='calendar-series-native-v1')", owner_id: key('owner_id'), source_id: key('source_id'), series_id: ref(source),
    generation_id: ref(generations), source_generation: positive('source_generation'), grant_id: ref(grants), grant_epoch: positive('grant_epoch'), preparation_id: ref(preparations),
    phase: "TEXT NOT NULL CHECK(phase IN ('prepare','commit','reconcile'))", logical_key: key('logical_key'), candidate_digest: hash('candidate_digest'), cursor_digest: hash('cursor_digest'),
    policy_digest: hash('policy_digest'), outcome: "TEXT NOT NULL CHECK(outcome IN ('batch.accepted','publication.ready','reconciliation.observed'))", accepted_ms: nonnegative('accepted_ms') },
  [preparations]: { ...identity, series_id: ref(source), generation_id: ref(generations), grant_id: ref(grants), grant_epoch: positive('grant_epoch'), acceptance_receipt_id: ref(receipts),
    base_publication_id: 'TEXT', manifest_digest: hash('manifest_digest'), revision: positive('revision'),
    state: "TEXT NOT NULL CHECK(state IN ('preparing','blocked','published','aborted'))", created_ms: nonnegative('created_ms'),
    expires_ms: "INTEGER NOT NULL CHECK(typeof(expires_ms)='integer' AND expires_ms>created_ms AND expires_ms<=9007199254740991)",
    claim_generation: nonnegative('claim_generation'), claim_nonce: "TEXT CHECK(claim_nonce IS NULL OR (length(claim_nonce)=32 AND claim_nonce NOT GLOB '*[^a-f0-9]*'))",
    claim_until_ms: "INTEGER CHECK(claim_until_ms IS NULL OR (typeof(claim_until_ms)='integer' AND claim_until_ms>created_ms AND claim_until_ms<=expires_ms))", blocked_code: 'TEXT', publication_id: 'TEXT' },
  [publications]: { ...identity, series_id: ref(source), preparation_id: ref(preparations), generation_id: ref(generations), base_publication_id: ref(publications, true),
    owner_id: key('owner_id'), source_id: key('source_id'), source_generation: positive('source_generation'), grant_id: ref(grants), grant_epoch: positive('grant_epoch'),
    manifest_digest: hash('manifest_digest'), native_receipt_id: ref(native), published_ms: nonnegative('published_ms'),
    operation: "TEXT NOT NULL CHECK(operation='series.publication.applied')" },
  [effects]: { ...identity, series_id: ref(source), generation_id: ref(generations), preparation_id: ref(preparations),
    receipt_family: "TEXT NOT NULL CHECK(receipt_family IN ('human','native'))", receipt_id: key('receipt_id'),
    operation: "TEXT NOT NULL CHECK(operation IN ('series.plan.accepted','series.publication.applied'))", publication_id: ref(publications, true),
    // Later child-version tables must supply an additive final seal before these can be nonnull.
    child_version_id: 'TEXT', child_binding_digest: hash('child_binding_digest', true) },
}).map(([name, table]) => [name, Object.freeze(table)])));

export function calendarSeriesTables(): Readonly<Record<string, TableSchema>> {
  return Object.freeze({ ...Object.fromEntries(Object.entries(calendarOverrideTables()).map(([name, table]) => [name, Object.freeze({ ...table })])), ...CALENDAR_SERIES_ADDITIONS });
}
function schema(database: Database) {
  const statements: Statement[] = [];
  try { return inspectDatabaseSchema({ prepare(sql: string) { const statement = database.prepare(sql); statements.push(statement); return statement; } } as Database); }
  finally { for (const statement of statements.reverse()) statement.finalize(); }
}
/** Self-contained savepoint also protects callers outside Migrator. Keep the
 * actual DDL in this handler so hashMigration commits its trigger/guard source. */
export function migrateCalendarSeries(database: Parameters<Migration['up']>[0]): void {
  database.transaction(() => {
  const before = schema(database), retained = calendarOverrideTables();
  if (diffSchemaSnapshots(snapshotDeclaredTables(retained), { tables: Object.fromEntries(Object.keys(retained).filter(name => before.tables[name]).map(name => [name, before.tables[name]!])) }).length
    || !database.query("SELECT 1 FROM _calendar_override_state WHERE id='application' AND version=19").get()
    || !database.query("SELECT 1 FROM _calendar_usage WHERE id='overrideVersion' AND count=19").get()
    || database.query('PRAGMA foreign_key_check').get()) throw new CalendarError('CALENDAR_STATE_INVALID');
  for (const name of Object.keys(before.tables)) {
    const folded = name.toLowerCase();
    if ((folded === source || folded.startsWith('_calendar_series_')) && (name !== folded || !Object.hasOwn(CALENDAR_SERIES_ADDITIONS, name))) throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  for (const [name, table] of Object.entries(CALENDAR_SERIES_ADDITIONS)) if (before.tables[name]
    && (diffSchemaSnapshots(snapshotDeclaredTables({ [name]: table }), { tables: { [name]: before.tables[name]! } }).length
      || database.query(`SELECT 1 FROM ${name} LIMIT 1`).get()
      || database.query("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND type IN ('index','trigger') AND name NOT LIKE 'sqlite_%' LIMIT 1").get(name))) throw new CalendarError('CALENDAR_STATE_INVALID');
  for (const [name, table] of Object.entries(CALENDAR_SERIES_ADDITIONS)) database.run(`CREATE TABLE IF NOT EXISTS "${name}" (${Object.entries(table).map(([column, declaration]) => `"${column}" ${declaration}`).join(',')})`);
  database.run(`INSERT INTO ${state} VALUES('application',20)`);
  for (const [table, ceiling] of Object.entries(CALENDAR_SERIES_CAPACITY)) database.run(`INSERT INTO ${capacity} VALUES(?,0,?)`, [table, ceiling]);
  const indices = [
    `CREATE UNIQUE INDEX calendar_series_scope_identity ON ${source}(scope_id,id)`,
    `CREATE UNIQUE INDEX calendar_series_source_identity ON ${source}(scope_id,owner_id,source_id)`,
    `CREATE UNIQUE INDEX calendar_series_initial_acceptance ON ${source}(initial_acceptance_receipt_id)`,
    `CREATE UNIQUE INDEX calendar_series_generation_identity ON ${generations}(scope_id,series_id,generation)`,
    `CREATE UNIQUE INDEX calendar_series_generation_acceptance ON ${generations}(acceptance_receipt_id)`,
    `CREATE UNIQUE INDEX calendar_series_segment_identity ON ${segments}(scope_id,series_id,generation_id,segment_key)`,
    `CREATE UNIQUE INDEX calendar_series_grant_identity ON ${grants}(scope_id,series_id,grant_revision)`,
    `CREATE UNIQUE INDEX calendar_series_human_identity ON ${receipts}(scope_id,principal,request_id)`,
    `CREATE UNIQUE INDEX calendar_series_human_control ON ${receipts}(scope_id,series_id,control_revision)`,
    `CREATE UNIQUE INDEX calendar_series_native_identity ON ${native}(domain,scope_id,owner_id,source_id,source_generation,phase,logical_key)`,
    `CREATE UNIQUE INDEX calendar_series_preparation_generation ON ${preparations}(generation_id)`,
    `CREATE UNIQUE INDEX calendar_series_preparation_working ON ${preparations}(scope_id,series_id) WHERE state IN ('preparing','blocked')`,
    `CREATE UNIQUE INDEX calendar_series_publication_preparation ON ${publications}(preparation_id)`,
    `CREATE UNIQUE INDEX calendar_series_publication_generation ON ${publications}(generation_id)`,
    `CREATE UNIQUE INDEX calendar_series_effect_receipt ON ${effects}(receipt_family,receipt_id,operation)`,
    `CREATE INDEX calendar_series_preparation_due ON ${preparations}(state,expires_ms,id)`,
    `CREATE INDEX calendar_series_receipt_generation ON ${receipts}(generation_id)`,
    `CREATE INDEX calendar_series_segment_generation ON ${segments}(generation_id)`,
    `CREATE INDEX calendar_series_grant_issuance ON ${grants}(issuance_receipt_id)`,
    `CREATE INDEX calendar_series_preparation_acceptance ON ${preparations}(acceptance_receipt_id)`,
  ];
  for (const sql of indices) database.run(sql);
  // REPLACE can delete a different primary key via ANY unique index without
  // running DELETE triggers. Guard every natural identity explicitly as well.
  const duplicate: Record<string, string> = {
    [source]: '(scope_id=NEW.scope_id AND owner_id=NEW.owner_id AND source_id=NEW.source_id) OR initial_acceptance_receipt_id=NEW.initial_acceptance_receipt_id',
    [generations]: '(scope_id=NEW.scope_id AND series_id=NEW.series_id AND generation=NEW.generation) OR acceptance_receipt_id=NEW.acceptance_receipt_id',
    [segments]: 'scope_id=NEW.scope_id AND series_id=NEW.series_id AND generation_id=NEW.generation_id AND segment_key=NEW.segment_key',
    [grants]: 'scope_id=NEW.scope_id AND series_id=NEW.series_id AND grant_revision=NEW.grant_revision',
    [receipts]: '(scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id) OR (scope_id=NEW.scope_id AND series_id=NEW.series_id AND control_revision=NEW.control_revision)',
    [native]: 'domain=NEW.domain AND scope_id=NEW.scope_id AND owner_id=NEW.owner_id AND source_id=NEW.source_id AND source_generation=NEW.source_generation AND phase=NEW.phase AND logical_key=NEW.logical_key',
    [preparations]: "generation_id=NEW.generation_id OR (scope_id=NEW.scope_id AND series_id=NEW.series_id AND state IN ('preparing','blocked') AND NEW.state IN ('preparing','blocked'))",
    [publications]: 'preparation_id=NEW.preparation_id OR generation_id=NEW.generation_id',
    [effects]: 'receipt_family=NEW.receipt_family AND receipt_id=NEW.receipt_id AND operation=NEW.operation',
  };
  for (const table of Object.keys(CALENDAR_SERIES_CAPACITY)) {
    database.run(`CREATE TRIGGER ${table}_series_capacity BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM ${capacity} WHERE id='${table}' AND count<ceiling) BEGIN SELECT RAISE(ABORT,'Private series retained capacity exhausted'); END`);
    database.run(`CREATE TRIGGER ${table}_series_count AFTER INSERT ON ${table} BEGIN UPDATE ${capacity} SET count=count+1 WHERE id='${table}'; END`);
    database.run(`CREATE TRIGGER ${table}_series_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id OR (${duplicate[table]})) BEGIN SELECT RAISE(ABORT,'Private series identity is immutable'); END`);
    database.run(`CREATE TRIGGER ${table}_series_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private series facts are retained'); END`);
    if (table !== source && table !== preparations) database.run(`CREATE TRIGGER ${table}_series_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private series evidence is immutable'); END`);
    database.run(`CREATE TRIGGER ${table}_series_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private series owner is inconsistent'); END`);
    // The exact insertion trigger conserves count without rescanning retained
    // history. Even raw counter tampering cannot decrease/reopen capacity or raise its ceiling.
    database.run(`CREATE TRIGGER ${table}_series_counter BEFORE UPDATE ON ${capacity} WHEN OLD.id='${table}' AND (NEW.id IS NOT OLD.id OR NEW.ceiling IS NOT OLD.ceiling OR NEW.count<>OLD.count+1) BEGIN SELECT RAISE(ABORT,'Private series retained count is inconsistent'); END`);
  }
  for (const table of [state, capacity]) {
    database.run(`CREATE TRIGGER ${table}_series_replace BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'Private series state is immutable'); END`);
    database.run(`CREATE TRIGGER ${table}_series_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private series state is retained'); END`);
  }
  database.run(`CREATE TRIGGER ${state}_series_update BEFORE UPDATE ON ${state} BEGIN SELECT RAISE(ABORT,'Private series state is immutable'); END`);
  const owner = `EXISTS(SELECT 1 FROM _calendar_owner o WHERE o.id='application' AND o.scope_id=NEW.scope_id AND o.owner_id=NEW.owner_id)`;
  database.run(`CREATE TRIGGER calendar_series_initial BEFORE INSERT ON ${source} WHEN NOT ${owner} OR NEW.control_revision<>1 OR NEW.grant_epoch<>1 OR NEW.lifecycle<>'active' OR NEW.published_generation_id IS NOT NULL OR NEW.published_publication_id IS NOT NULL OR NEW.active_preparation_id IS NULL OR EXISTS(SELECT 1 FROM ${receipts} WHERE id=NEW.initial_acceptance_receipt_id) BEGIN SELECT RAISE(ABORT,'Private series initial selection is inconsistent'); END`);
  const humanTables = ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts', '_calendar_location_receipts', '_calendar_type_receipts', '_calendar_lifecycle_receipts', '_calendar_integration_operator_requests'];
  for (const table of humanTables) {
    database.run(`CREATE TRIGGER ${table}_series_human_key BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${receipts} WHERE id=NEW.id OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)) BEGIN SELECT RAISE(ABORT,'Private calendar human request key is occupied'); END`);
    database.run(`CREATE TRIGGER calendar_series_human_key_${table} BEFORE INSERT ON ${receipts} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id OR (scope_id=NEW.scope_id AND principal=NEW.principal AND request_id=NEW.request_id)) BEGIN SELECT RAISE(ABORT,'Private calendar human request key is occupied'); END`);
  }
  const generationOpen = (id: string) => `NOT EXISTS(SELECT 1 FROM ${receipts} r WHERE r.generation_id=${id})`;
  database.run(`CREATE TRIGGER calendar_series_generation_parent BEFORE INSERT ON ${generations} WHEN NOT EXISTS(SELECT 1 FROM ${source} s WHERE s.id=NEW.series_id AND s.scope_id=NEW.scope_id AND s.lifecycle='active' AND s.published_publication_id IS NEW.base_publication_id)
    OR (NEW.generation=1 AND NEW.predecessor_id IS NOT NULL) OR (NEW.generation>1 AND NOT EXISTS(SELECT 1 FROM ${generations} p WHERE p.id=NEW.predecessor_id AND p.scope_id=NEW.scope_id AND p.series_id=NEW.series_id AND p.generation=NEW.generation-1))
    OR NEW.generation<>(SELECT COALESCE(max(generation),0)+1 FROM ${generations} WHERE scope_id=NEW.scope_id AND series_id=NEW.series_id)
    OR EXISTS(SELECT 1 FROM ${receipts} WHERE id=NEW.acceptance_receipt_id) BEGIN SELECT RAISE(ABORT,'Private series source generation is sealed'); END`);
  database.run(`CREATE TRIGGER calendar_series_generation_authoring BEFORE INSERT ON ${generations} WHEN json_extract(NEW.authoring_json,'$.kind') IS NOT NEW.kind OR json_type(NEW.authoring_json,'$.recurrence') IS NOT 'object' OR json_extract(NEW.authoring_json,'$.recurrence.kind') IS NOT 'timed-local-v1' OR json_type(NEW.authoring_json,'$.template') IS NOT 'object' OR json_remove(NEW.authoring_json,'$.kind','$.recurrence','$.template')<>'{}' BEGIN SELECT RAISE(ABORT,'Private series authoring family is malformed'); END`);
  database.run(`CREATE TRIGGER calendar_series_segment_parent BEFORE INSERT ON ${segments} WHEN NOT EXISTS(SELECT 1 FROM ${generations} g WHERE g.id=NEW.generation_id AND g.series_id=NEW.series_id AND g.scope_id=NEW.scope_id AND ${generationOpen('g.id')})
    OR (NEW.predecessor_segment_id IS NULL)<>(NEW.nominal_cut IS NULL) OR (NEW.predecessor_segment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${segments} p JOIN ${generations} g ON g.id=NEW.generation_id WHERE p.id=NEW.predecessor_segment_id AND p.scope_id=NEW.scope_id AND p.series_id=NEW.series_id AND p.generation_id=g.predecessor_id))
    OR (SELECT count(*) FROM ${segments} WHERE generation_id=NEW.generation_id)>=256 BEGIN SELECT RAISE(ABORT,'Private series segment generation is sealed'); END`);
  database.run(`CREATE TRIGGER calendar_series_grant_parent BEFORE INSERT ON ${grants} WHEN NOT EXISTS(SELECT 1 FROM ${source} s JOIN ${generations} g ON g.series_id=s.id AND g.scope_id=s.scope_id WHERE s.id=NEW.series_id AND s.scope_id=NEW.scope_id AND s.owner_id=NEW.owner_id AND s.source_id=NEW.source_id AND s.lifecycle='active' AND g.id=NEW.generation_id AND g.generation=NEW.source_generation AND g.acceptance_receipt_id=NEW.issuance_receipt_id AND ${generationOpen('g.id')} AND NEW.issued_epoch BETWEEN s.grant_epoch AND s.grant_epoch+1)
    OR NEW.grant_revision<>(SELECT COALESCE(max(grant_revision),0)+1 FROM ${grants} WHERE scope_id=NEW.scope_id AND series_id=NEW.series_id)
    OR json_array_length(NEW.resource_ids_json) NOT BETWEEN 1 AND 16 OR NEW.resource_ids_json IS NOT (SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(NEW.resource_ids_json) ORDER BY value))
    OR EXISTS(SELECT 1 FROM json_each(NEW.resource_ids_json) x WHERE x.type<>'text' OR NOT EXISTS(SELECT 1 FROM calendar_resources r WHERE r.id=x.value AND r.scope_id=NEW.scope_id AND r.active=1))
    OR json_array_length(NEW.operations_json) NOT BETWEEN 1 AND 3 OR NEW.operations_json IS NOT (SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(NEW.operations_json) ORDER BY value))
    OR EXISTS(SELECT 1 FROM json_each(NEW.operations_json) WHERE type<>'text' OR value NOT IN ('series.coverage.prepare','series.coverage.commit','series.coverage.reconcile'))
    BEGIN SELECT RAISE(ABORT,'Private series grant is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_series_preparation_parent BEFORE INSERT ON ${preparations} WHEN NEW.state<>'preparing' OR NEW.revision<>1 OR NEW.claim_generation<>0 OR NEW.claim_nonce IS NOT NULL OR NEW.claim_until_ms IS NOT NULL OR NEW.blocked_code IS NOT NULL OR NEW.publication_id IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM ${source} s JOIN ${generations} g ON g.series_id=s.id AND g.scope_id=s.scope_id JOIN ${grants} a ON a.generation_id=g.id AND a.scope_id=g.scope_id WHERE s.id=NEW.series_id AND s.scope_id=NEW.scope_id AND s.lifecycle='active' AND (s.active_preparation_id IS NULL OR s.active_preparation_id=NEW.id) AND s.published_publication_id IS NEW.base_publication_id AND g.id=NEW.generation_id AND g.base_publication_id IS NEW.base_publication_id AND g.acceptance_receipt_id=NEW.acceptance_receipt_id AND a.id=NEW.grant_id AND a.issued_epoch=NEW.grant_epoch AND a.issuance_receipt_id=NEW.acceptance_receipt_id AND ${generationOpen('g.id')}) BEGIN SELECT RAISE(ABORT,'Private series preparation is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_series_acceptance_parent BEFORE INSERT ON ${receipts} WHEN EXISTS(SELECT 1 FROM ${source} anchor WHERE anchor.initial_acceptance_receipt_id=NEW.id AND (anchor.id<>NEW.series_id OR anchor.scope_id<>NEW.scope_id OR NEW.control_revision<>1))
    OR EXISTS(SELECT 1 FROM ${generations} anchor WHERE anchor.acceptance_receipt_id=NEW.id AND (anchor.scope_id<>NEW.scope_id OR anchor.series_id<>NEW.series_id OR anchor.id<>NEW.generation_id))
    OR EXISTS(SELECT 1 FROM ${preparations} anchor WHERE anchor.acceptance_receipt_id=NEW.id AND (anchor.scope_id<>NEW.scope_id OR anchor.series_id<>NEW.series_id OR anchor.generation_id<>NEW.generation_id OR anchor.id<>NEW.preparation_id))
    OR EXISTS(SELECT 1 FROM ${grants} anchor WHERE anchor.issuance_receipt_id=NEW.id AND (anchor.scope_id<>NEW.scope_id OR anchor.series_id<>NEW.series_id OR anchor.generation_id<>NEW.generation_id OR anchor.id IS NOT (SELECT grant_id FROM ${preparations} WHERE id=NEW.preparation_id)))
    OR NOT EXISTS(SELECT 1 FROM ${source} s JOIN ${generations} g ON g.series_id=s.id AND g.scope_id=s.scope_id JOIN ${preparations} p ON p.generation_id=g.id AND p.scope_id=g.scope_id JOIN ${grants} a ON a.id=p.grant_id AND a.scope_id=p.scope_id
    WHERE s.id=NEW.series_id AND s.scope_id=NEW.scope_id AND s.lifecycle='active' AND g.id=NEW.generation_id AND g.acceptance_receipt_id=NEW.id AND p.id=NEW.preparation_id AND p.acceptance_receipt_id=NEW.id AND p.state='preparing' AND p.base_publication_id IS NEW.base_publication_id AND s.published_publication_id IS NEW.base_publication_id
      AND ((s.control_revision=1 AND NEW.control_revision=1 AND s.initial_acceptance_receipt_id=NEW.id AND s.active_preparation_id=p.id AND s.current_grant_id=a.id AND s.grant_epoch=a.issued_epoch) OR (s.active_preparation_id IS NULL AND NEW.control_revision=s.control_revision+1 AND a.issued_epoch=s.grant_epoch+1))
      AND NEW.accepted_ms>=p.created_ms AND NEW.accepted_ms<p.expires_ms AND (SELECT count(*) FROM ${segments} WHERE generation_id=g.id) BETWEEN 1 AND 256)
    BEGIN SELECT RAISE(ABORT,'Private series acceptance is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_series_acceptance_select AFTER INSERT ON ${receipts} WHEN NEW.control_revision>(SELECT control_revision FROM ${source} WHERE id=NEW.series_id) BEGIN UPDATE ${source} SET control_revision=NEW.control_revision,current_grant_id=(SELECT grant_id FROM ${preparations} WHERE id=NEW.preparation_id),grant_epoch=(SELECT grant_epoch FROM ${preparations} WHERE id=NEW.preparation_id),active_preparation_id=NEW.preparation_id WHERE id=NEW.series_id; END`);
  database.run(`CREATE TRIGGER calendar_series_native_parent BEFORE INSERT ON ${native} WHEN NOT EXISTS(SELECT 1 FROM ${source} s JOIN ${generations} g ON g.series_id=s.id AND g.scope_id=s.scope_id JOIN ${grants} a ON a.generation_id=g.id AND a.scope_id=g.scope_id JOIN ${preparations} p ON p.generation_id=g.id AND p.scope_id=g.scope_id
    WHERE s.id=NEW.series_id AND s.scope_id=NEW.scope_id AND s.owner_id=NEW.owner_id AND s.source_id=NEW.source_id AND s.lifecycle='active' AND s.current_grant_id=NEW.grant_id AND s.grant_epoch=NEW.grant_epoch AND s.active_preparation_id=NEW.preparation_id AND g.id=NEW.generation_id AND g.generation=NEW.source_generation AND a.id=NEW.grant_id AND a.issued_epoch=NEW.grant_epoch AND p.id=NEW.preparation_id AND p.state IN ('preparing','blocked') AND p.acceptance_receipt_id=g.acceptance_receipt_id AND NEW.policy_digest=g.policy_generation AND NEW.accepted_ms>=p.created_ms AND NEW.accepted_ms<p.expires_ms
      AND EXISTS(SELECT 1 FROM json_each(a.operations_json) WHERE value='series.coverage.'||NEW.phase))
    OR (NEW.phase='prepare' AND NEW.outcome<>'batch.accepted') OR (NEW.phase='commit' AND NEW.outcome<>'publication.ready') OR (NEW.phase='reconcile' AND NEW.outcome<>'reconciliation.observed')
    BEGIN SELECT RAISE(ABORT,'Private series native acceptance is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_series_publication_parent BEFORE INSERT ON ${publications} WHEN NOT EXISTS(SELECT 1 FROM ${source} s JOIN ${generations} g ON g.series_id=s.id AND g.scope_id=s.scope_id JOIN ${preparations} p ON p.generation_id=g.id AND p.scope_id=g.scope_id JOIN ${native} n ON n.preparation_id=p.id AND n.scope_id=p.scope_id
    WHERE s.id=NEW.series_id AND s.scope_id=NEW.scope_id AND s.lifecycle='active' AND s.owner_id=NEW.owner_id AND s.source_id=NEW.source_id AND s.current_grant_id=NEW.grant_id AND s.grant_epoch=NEW.grant_epoch AND s.active_preparation_id=NEW.preparation_id AND s.published_publication_id IS NEW.base_publication_id AND g.id=NEW.generation_id AND g.generation=NEW.source_generation AND p.id=NEW.preparation_id AND p.grant_id=NEW.grant_id AND p.grant_epoch=NEW.grant_epoch AND p.base_publication_id IS NEW.base_publication_id AND p.state='preparing' AND p.manifest_digest=NEW.manifest_digest AND NEW.published_ms>=p.created_ms AND NEW.published_ms<p.expires_ms
      AND n.id=NEW.native_receipt_id AND n.phase='commit' AND n.outcome='publication.ready' AND n.generation_id=g.id AND n.grant_id=p.grant_id AND n.grant_epoch=p.grant_epoch AND n.candidate_digest=NEW.manifest_digest AND n.accepted_ms<=NEW.published_ms)
    BEGIN SELECT RAISE(ABORT,'Private series publication is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_series_publication_select AFTER INSERT ON ${publications} BEGIN UPDATE ${preparations} SET state='published',revision=revision+1,publication_id=NEW.id,claim_nonce=NULL,claim_until_ms=NULL,blocked_code=NULL WHERE id=NEW.preparation_id; UPDATE ${source} SET published_generation_id=NEW.generation_id,published_publication_id=NEW.id,active_preparation_id=NULL WHERE id=NEW.series_id; END`);
  database.run(`CREATE TRIGGER calendar_series_preparation_cas BEFORE UPDATE ON ${preparations} WHEN NEW.id IS NOT OLD.id OR NEW.scope_id IS NOT OLD.scope_id OR NEW.series_id IS NOT OLD.series_id OR NEW.generation_id IS NOT OLD.generation_id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.grant_epoch IS NOT OLD.grant_epoch OR NEW.acceptance_receipt_id IS NOT OLD.acceptance_receipt_id OR NEW.base_publication_id IS NOT OLD.base_publication_id OR NEW.manifest_digest IS NOT OLD.manifest_digest OR NEW.created_ms IS NOT OLD.created_ms OR NEW.expires_ms IS NOT OLD.expires_ms OR NEW.revision<>OLD.revision+1 OR OLD.state IN ('published','aborted')
    OR ((NEW.claim_nonce IS NULL)<>(NEW.claim_until_ms IS NULL)) OR (NEW.claim_nonce IS NOT NULL AND (NEW.claim_generation<>OLD.claim_generation+1 OR NEW.claim_nonce IS OLD.claim_nonce)) OR (NEW.claim_nonce IS NULL AND NEW.claim_generation<>OLD.claim_generation)
    OR (NEW.state='blocked' AND (NEW.blocked_code IS NULL OR length(NEW.blocked_code) NOT BETWEEN 1 AND 128)) OR (NEW.state<>'blocked' AND NEW.blocked_code IS NOT NULL)
    OR (NEW.state IN ('aborted','published') AND NEW.claim_nonce IS NOT NULL) OR (NEW.state='published' AND NOT EXISTS(SELECT 1 FROM ${publications} p WHERE p.id=NEW.publication_id AND p.preparation_id=NEW.id AND p.scope_id=NEW.scope_id)) OR (NEW.state<>'published' AND NEW.publication_id IS NOT NULL)
    BEGIN SELECT RAISE(ABORT,'Private series preparation CAS is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_series_source_cas BEFORE UPDATE ON ${source} WHEN NEW.id IS NOT OLD.id OR NEW.scope_id IS NOT OLD.scope_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.source_id IS NOT OLD.source_id OR NEW.created_by IS NOT OLD.created_by OR NEW.initial_acceptance_receipt_id IS NOT OLD.initial_acceptance_receipt_id OR (NEW.published_generation_id IS NULL)<>(NEW.published_publication_id IS NULL)
    OR NOT ((NEW.control_revision=OLD.control_revision AND NEW.lifecycle=OLD.lifecycle AND NEW.lifecycle='active' AND NEW.current_grant_id=OLD.current_grant_id AND NEW.grant_epoch=OLD.grant_epoch AND NEW.active_preparation_id IS NULL AND OLD.active_preparation_id IS NOT NULL AND EXISTS(SELECT 1 FROM ${publications} p WHERE p.id=NEW.published_publication_id AND p.generation_id=NEW.published_generation_id AND p.preparation_id=OLD.active_preparation_id AND p.series_id=OLD.id AND p.scope_id=OLD.scope_id AND p.base_publication_id IS OLD.published_publication_id))
      OR (NEW.control_revision=OLD.control_revision+1 AND NEW.published_generation_id IS OLD.published_generation_id AND NEW.published_publication_id IS OLD.published_publication_id AND NEW.grant_epoch=OLD.grant_epoch+1 AND (
        (NEW.lifecycle='retired' AND NEW.active_preparation_id IS NULL AND NEW.current_grant_id=OLD.current_grant_id AND (OLD.active_preparation_id IS NULL OR EXISTS(SELECT 1 FROM ${preparations} WHERE id=OLD.active_preparation_id AND state='aborted')))
        OR (NEW.lifecycle='active' AND OLD.active_preparation_id IS NULL AND EXISTS(SELECT 1 FROM ${receipts} r JOIN ${preparations} p ON p.id=r.preparation_id WHERE r.series_id=NEW.id AND r.scope_id=NEW.scope_id AND r.control_revision=NEW.control_revision AND p.id=NEW.active_preparation_id AND p.grant_id=NEW.current_grant_id AND p.grant_epoch=NEW.grant_epoch AND p.state='preparing')))))
    BEGIN SELECT RAISE(ABORT,'Private series source CAS is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_series_effect_parent BEFORE INSERT ON ${effects} WHEN NEW.child_version_id IS NOT NULL OR NEW.child_binding_digest IS NOT NULL OR NOT (
    (NEW.receipt_family='human' AND NEW.operation='series.plan.accepted' AND NEW.publication_id IS NULL AND EXISTS(SELECT 1 FROM ${receipts} r WHERE r.id=NEW.receipt_id AND r.scope_id=NEW.scope_id AND r.series_id=NEW.series_id AND r.generation_id=NEW.generation_id AND r.preparation_id=NEW.preparation_id))
    OR (NEW.receipt_family='native' AND NEW.operation='series.publication.applied' AND EXISTS(SELECT 1 FROM ${publications} p WHERE p.id=NEW.publication_id AND p.scope_id=NEW.scope_id AND p.series_id=NEW.series_id AND p.generation_id=NEW.generation_id AND p.preparation_id=NEW.preparation_id AND p.native_receipt_id=NEW.receipt_id)))
    BEGIN SELECT RAISE(ABORT,'Private series effect binding is inconsistent'); END`);
  })();
}
export const CALENDAR_SERIES_MIGRATION: Readonly<Migration> = Object.freeze({ version: '020', description: 'Private inert series source, grant, acceptance and publication evidence', up: migrateCalendarSeries });
