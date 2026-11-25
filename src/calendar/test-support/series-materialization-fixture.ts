/** Synthetic raw native MEMORY fixture only. Never allocates a physical DB. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { Migrator } from '../../migrations/migrator';
import { runDatabaseRealmCommand } from '../../databases/database-realm';
import { createReactiveDB } from '../../sync/reactive-db';
import { calendarRealm } from '../realm';
import { calendarRealm016 } from './calendar-realm-016';
import { CALENDAR_SERIES_MIGRATION, calendarSeriesTables } from '../realm-series-migration';
import { CALENDAR_SERIES_MATERIALIZATION_MIGRATION, calendarSeriesMaterializationTables, CALENDAR_SERIES_MATERIALIZATION_TABLES as t } from '../realm-series-materialization-migration';
import { calendarHash } from '../validation';
export type MaterializationRow = Record<string, SQLQueryBindings>;
export function insertMaterializationRow(db: Database, table: string, row: MaterializationRow, replace = false) {
  return db.run(`INSERT${replace ? ' OR REPLACE' : ''} INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`, Object.values(row));
}
export function seriesMaterializationMemoryFixture(until = '021') {
  const db = new Database(':memory:');
  try {
    db.run('PRAGMA temp_store=MEMORY'); db.run('PRAGMA foreign_keys=ON');
    const migrate = (target = '021') => {
      const migrator = new Migrator({ database: db, dbPath: ':memory:', createBackups: false, log() {},
        migrations: [...calendarRealm.migrations, CALENDAR_SERIES_MIGRATION, CALENDAR_SERIES_MATERIALIZATION_MIGRATION],
        migrationTableStages: [...calendarRealm.migrationTableStages!, { version: '020', tables: calendarSeriesTables() }, { version: '021', tables: calendarSeriesMaterializationTables() }] });
      try { return migrator.run(target); } finally { migrator.dispose(); }
    };
    migrate(until);
    const scope = 'tenant:synthetic-materialization', owner = 'synthetic-owner', principal = 'synthetic-principal', now = Date.now(), h = calendarHash;
    const reactive = createReactiveDB({ database: db, ownsDatabase: false });
    try {
      const retainedRealm = until === '016' ? calendarRealm016 : calendarRealm;
      for (const [name, definition] of Object.entries(retainedRealm.tables)) reactive.defineTable(name, definition);
      const actor = { scopeId: scope, userId: 'synthetic-user', principal, manageAll: true, createOwn: true };
      runDatabaseRealmCommand(retainedRealm, reactive, 'calendar.owner.bind', { scopeId: scope, ownerId: owner });
      runDatabaseRealmCommand(retainedRealm, reactive, 'calendar.resource.create', { actor, requestId: 'resource', id: 'r', label: 'Synthetic resource', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    } finally { reactive.dispose(); }
    const accept = (suffix = '') => {
      const series = 'series' + suffix, generation = 'generation' + suffix, preparation = 'preparation' + suffix, grant = 'grant' + suffix, segment = 'segment-record' + suffix, receipt = h([scope, principal, 'plan' + suffix]);
      const authoring = { kind: 'timed-series-v1', recurrence: { kind: 'timed-local-v1', localStart: '2030-01-01T10:00:00.000', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 3600000, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } } }, template: { resourceIds: ['r'], title: 'Synthetic series', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, appointmentType: null, visit: null, participants: [] } };
      const sourceId = 'source' + suffix, planDigest = h(['plan', suffix]), policy = h('policy'), engine = h('engine'), resourceDigest = h(['r']);
      db.transaction(() => {
        insertMaterializationRow(db, 'calendar_series', { id: series, scope_id: scope, owner_id: owner, source_id: sourceId, created_by: 'synthetic-user', control_revision: 1, initial_acceptance_receipt_id: receipt, lifecycle: 'active', grant_epoch: 1, current_grant_id: grant, published_generation_id: null, published_publication_id: null, active_preparation_id: preparation });
        insertMaterializationRow(db, '_calendar_series_generations', { id: generation, scope_id: scope, series_id: series, generation: 1, predecessor_id: null, base_publication_id: null, kind: authoring.kind, authoring_json: JSON.stringify(authoring), authoring_digest: h(authoring), engine_generation: engine, policy_generation: policy, acceptance_receipt_id: receipt });
        insertMaterializationRow(db, '_calendar_series_segments', { id: segment, scope_id: scope, series_id: series, generation_id: generation, segment_key: 'original', predecessor_segment_id: null, nominal_cut: null, local_from: '2030-01-01', local_until: null, start_json: '{}', rule_json: JSON.stringify(authoring.recurrence.rule), template_json: JSON.stringify(authoring.template), source_digest: h(authoring) });
        insertMaterializationRow(db, '_calendar_series_grants', { id: grant, scope_id: scope, series_id: series, generation_id: generation, grant_revision: 1, issued_epoch: 1, owner_id: owner, source_id: sourceId, source_generation: 1, operations_json: '["series.coverage.commit","series.coverage.prepare","series.coverage.reconcile"]', resource_ids_json: '["r"]', authority_digest: h('authority'), resource_digest: resourceDigest, issuance_receipt_id: receipt, issued_ms: now });
        insertMaterializationRow(db, '_calendar_series_preparations', { id: preparation, scope_id: scope, series_id: series, generation_id: generation, grant_id: grant, grant_epoch: 1, acceptance_receipt_id: receipt, base_publication_id: null, manifest_digest: planDigest, revision: 1, state: 'preparing', created_ms: now, expires_ms: now + 60000, claim_generation: 0, claim_nonce: null, claim_until_ms: null, blocked_code: null, publication_id: null });
        insertMaterializationRow(db, '_calendar_series_receipts', { id: receipt, scope_id: scope, principal, request_id: 'plan' + suffix, digest: h(['intent', suffix]), series_id: series, generation_id: generation, control_revision: 1, preparation_id: preparation, base_publication_id: null, accepted_ms: now + 1, operation: 'series.plan.accepted' });
      })();
      return { series, generation, preparation, grant, segment, sourceId, planDigest, policy, engine, resourceDigest };
    };
    const begin = (source: ReturnType<typeof accept>, suffix = '') => {
      const id = 'run' + suffix, receiptId = h(['begin', id]), run: MaterializationRow = { id, scope_id: scope, series_id: source.series, generation_id: source.generation, grant_id: source.grant, grant_epoch: 1, owner_id: owner, source_id: source.sourceId, initial_receipt_id: receiptId,
        root_hash: h('physical-root'), realm_fingerprint: 'sha256:' + h('realm'), resource_vector_json: '[{"id":"r","revision":1}]', source_binding_json: JSON.stringify({ segmentId: 'logical-' + source.series }), kind: 'cutover', source_preparation_id: source.preparation, source_publication_id: 'source-publication' + suffix, base_source_publication_id: null, plan_digest: source.planDigest, engine_generation: source.engine, policy_generation: source.policy, resource_digest: source.resourceDigest,
        window_from_ms: 1893492000000, window_until_ms: 1893751200000, nominal_from: '2030-01-01', nominal_until: '2030-01-04', initial_progress_digest: h('initial-progress'), created_ms: now + 2, expires_ms: now + 60000 };
      const state: MaterializationRow = { id, scope_id: scope, revision: 1, state: 'preparing', phase: 'pending', progress_id: null, last_receipt_id: receiptId, projection_cursor_json: '{}', projection_complete: 0, candidate_root: h(['candidate-empty', id]), projection_root: h(['projection-empty', id]), cell_root: h(['cell-empty', id]), candidate_count: 0, resource_count: 0, claim_count: 0, cell_count: 0, member_count: 0, selector_count: 0, working_member_count: 0, publication_id: null, updated_ms: now + 2 };
      const receipt: MaterializationRow = { id: receiptId, scope_id: scope, run_id: id, phase: 'batch', logical_key: 'begin', revision: 1, candidate_digest: h('begin-candidate'), before_digest: h('initial-progress'), after_digest: h('initial-progress'), policy_digest: source.policy, projection_before_digest: h('projection-before'), projection_after_digest: h('projection-before'), row_count: 0, candidate_delta: 0, resource_delta: 0, claim_delta: 0, cell_delta: 0, member_delta: 0, selector_delta: 0, working_member_delta: 0, accepted_ms: now + 2 };
      db.transaction(() => { insertMaterializationRow(db, t.runs, run); insertMaterializationRow(db, t.runState, state); insertMaterializationRow(db, t.receipts, receipt); })();
      return { run, state, receipt };
    };
    return { db, scope, owner, principal, now, migrate, accept, begin, close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}
