/** Raw native MEMORY-only021 evidence. No physical, package, browser or release qualification. */
import { expect, setDefaultTimeout, test } from 'bun:test';
import { hashMigration, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { calendarRealm } from './realm';
import { CALENDAR_SERIES_MIGRATION } from './realm-series-migration';
import { CALENDAR_SERIES_MATERIALIZATION_ADDITIONS, CALENDAR_SERIES_MATERIALIZATION_MIGRATION, CALENDAR_SERIES_MATERIALIZATION_TABLES as t, calendarSeriesMaterializationTables, migrateCalendarSeriesMaterialization } from './realm-series-materialization-migration';
import { seriesMaterializationMemoryFixture as fixture, insertMaterializationRow as insert } from './test-support/series-materialization-fixture';
import type { MaterializationRow as Row } from './test-support/series-materialization-fixture';
import type { Database } from 'bun:sqlite';
import { calendarHash as h } from './validation';
import { createReactiveDB } from '../sync/reactive-db';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { calendarRealm016 } from './test-support/calendar-realm-016';

// Each case runs genuine historical migrations, not a query-only microfixture.
// Keep a finite diagnostic bound without treating scheduler contention as a
// five-second migration performance qualification.
setDefaultTimeout(30_000);

type Fixture = ReturnType<typeof fixture>;
type Accepted = ReturnType<Fixture['accept']>;
type Begun = ReturnType<Fixture['begin']>;
function update(db: Database, table: string, id: string, patch: Row) {
  if (table === t.runState && patch.last_receipt_id) {
    const previous = db.query(`SELECT * FROM ${t.runState} WHERE id=?`).get(id) as Row;
    if (patch.last_receipt_id !== previous.last_receipt_id) patch.receipt_base_json = JSON.stringify(Object.fromEntries(['candidate_count', 'resource_count', 'claim_count', 'cell_count', 'member_count', 'selector_count', 'working_member_count'].map(column => [column, previous[column]])));
  }
  db.run(`UPDATE ${table} SET ${Object.keys(patch).map(column => `${column}=?`).join(',')} WHERE id=?`, [...Object.values(patch), id]);
}
function receipt(f: Fixture, begun: Begun, id: string, revision: number, patch: Row = {}): Row {
  return { ...begun.receipt, id, logical_key: id, revision, row_count: 256, accepted_ms: f.now + revision + 2, ...patch };
}
function expectCapacityMatchesPhysicalRows(f: Fixture) {
  const working = new Set<string>([t.claims, t.cellBuilders, t.selectors, t.workingMembers, t.continuationHeads]);
  for (const value of f.db.query(`SELECT * FROM ${t.capacity}`).all() as Row[]) {
    const actual = f.db.query(`SELECT count(*) AS n FROM ${String(value.id)}`).get() as { n: number };
    expect(working.has(String(value.id)) ? value.working_count : value.retained_count).toBe(actual.n);
    expect(Number(value.current_count) + Number(value.pending_count) + Number(value.retiring_count)).toBe(value.working_count as number);
  }
}
function stageVersion(f: Fixture, accepted: Accepted, begun: Begun, includeClaim = true) {
  const id = h(['stage', begun.run.id]), occurrenceId = 'occurrence-' + begun.run.id, versionId = 'version-' + begun.run.id, logical = 'logical-' + accepted.series;
  const version: Row = { id: versionId, scope_id: f.scope, series_id: accepted.series, occurrence_id: occurrenceId, run_id: begun.run.id, version_digest: h(['version', versionId]), booking_json: '{}', start_ms: 1893492000000, end_ms: 1893495600000, occupied_from_ms: 1893492000000, occupied_until_ms: 1893495600000, resource_ids_json: '["r"]', resource_digest: accepted.resourceDigest, binding_digest: h('binding'), batch_receipt_id: id };
  f.db.transaction(() => {
    insert(f.db, t.logicalSegments, { id: logical, scope_id: f.scope, series_id: accepted.series, segment_key: 'original' });
    insert(f.db, t.generationSegments, { id: 'mapping-' + accepted.series, scope_id: f.scope, series_id: accepted.series, generation_id: accepted.generation, generation_segment_id: accepted.segment, logical_segment_id: logical });
    insert(f.db, t.occurrences, { id: occurrenceId, scope_id: f.scope, series_id: accepted.series, logical_segment_id: logical, nominal_key: 'timed-v1:2030-01-01T10:00:00.000', appointment_id: occurrenceId, batch_receipt_id: id });
    insert(f.db, t.versions, version);
    insert(f.db, t.resources, { id: 'resource-' + versionId, scope_id: f.scope, version_id: versionId, resource_id: 'r', resource_revision: 1, batch_receipt_id: id });
    if (includeClaim) insert(f.db, t.claims, { id: 'claim-' + versionId, scope_id: f.scope, run_id: begun.run.id, version_id: versionId, resource_id: 'r', from_ms: version.occupied_from_ms!, until_ms: version.occupied_until_ms!, expires_ms: begun.run.expires_ms!, batch_receipt_id: id });
    insert(f.db, t.progress, { id: 'progress-' + begun.run.id, scope_id: f.scope, run_id: begun.run.id, revision: 1, before_digest: begun.run.initial_progress_digest!, after_digest: h('completed-nominal-progress'), checkpoint_json: '{"status":"range-complete"}', evaluated_candidates: 3, completion: 'nominal-range-complete', batch_receipt_id: id, created_ms: f.now + 4 });
    update(f.db, t.runState, String(begun.run.id), { revision: 2, last_receipt_id: id, candidate_count: 1, resource_count: 1, claim_count: includeClaim ? 1 : 0, progress_id: 'progress-' + begun.run.id, projection_complete: 1, projection_cursor_json: '{"phase":"complete"}', candidate_root: h('candidate-root'), projection_root: h('projection-root'), updated_ms: f.now + 4 });
    insert(f.db, t.receipts, receipt(f, begun, id, 2, { candidate_delta: 1, resource_delta: 1, claim_delta: includeClaim ? 1 : 0 }));
  })();
  return { id, occurrenceId, versionId, version, logical };
}
function stageCell(f: Fixture, accepted: Accepted, begun: Begun, staged: ReturnType<typeof stageVersion>) {
  const batch = h('cell-batch'), cell = 'cell-' + begun.run.id, selector = 'selector-' + begun.run.id, start = Math.floor(Number(staged.version.start_ms) / 86400000) * 86400000, root = h('member-root');
  f.db.transaction(() => {
    insert(f.db, t.cellSets, { id: cell, scope_id: f.scope, run_id: begun.run.id, series_id: accepted.series, resource_id: 'r', cell_start_ms: start, batch_receipt_id: batch });
    insert(f.db, t.cellBuilders, { id: cell, scope_id: f.scope, run_id: begun.run.id, revision: 1, member_count: 0, member_root: h('empty-member-root'), batch_receipt_id: batch });
    insert(f.db, t.members, { id: 'member-' + cell, scope_id: f.scope, cell_set_id: cell, version_id: staged.versionId, resource_id: 'r', cell_start_ms: start, from_ms: staged.version.occupied_from_ms!, until_ms: staged.version.occupied_until_ms!, batch_receipt_id: batch });
    update(f.db, t.cellBuilders, cell, { revision: 2, member_count: 1, member_root: root });
    insert(f.db, t.cellSeals, { id: 'seal-' + cell, scope_id: f.scope, cell_set_id: cell, run_id: begun.run.id, member_count: 1, member_root: root, batch_receipt_id: batch });
    insert(f.db, t.selectors, { id: selector, scope_id: f.scope, series_id: accepted.series, source_publication_id: begun.run.source_publication_id!, resource_id: 'r', cell_start_ms: start, cell_set_id: cell, publication_id: 'native-publication-' + begun.run.id, revision: 1, created_receipt_id: batch, batch_receipt_id: batch });
    insert(f.db, t.workingMembers, { id: 'working-' + cell, scope_id: f.scope, selector_id: selector, cell_set_id: cell, version_id: staged.versionId, resource_id: 'r', from_ms: staged.version.occupied_from_ms!, until_ms: staged.version.occupied_until_ms!, batch_receipt_id: batch });
    update(f.db, t.runState, String(begun.run.id), { revision: 3, last_receipt_id: batch, cell_count: 1, member_count: 1, selector_count: 1, working_member_count: 1, cell_root: h('cell-root'), updated_ms: f.now + 5 });
    insert(f.db, t.receipts, receipt(f, begun, batch, 3, { cell_delta: 1, member_delta: 1, selector_delta: 1, working_member_delta: 1 }));
  })();
  return { cell, selector };
}
function publish(f: Fixture, accepted: Accepted, begun: Begun, beforeSourcePointer?: () => void, options: { phase?: string; omitHead?: boolean } = {}) {
  const batch = h('publish-batch'), seal = 'final-' + begun.run.id, publication = 'native-publication-' + begun.run.id, nativeId = h('020-native-commit');
  f.db.transaction(() => {
    update(f.db, t.runState, String(begun.run.id), { revision: 4, last_receipt_id: batch, updated_ms: f.now + 6 });
    insert(f.db, t.seals, { id: seal, scope_id: f.scope, run_id: begun.run.id, plan_digest: accepted.planDigest, candidate_root: h('candidate-root'), projection_root: h('projection-root'), cell_root: h('cell-root'), progress_digest: h('completed-nominal-progress'), receipt_id: batch, occurrence_count: 1, resource_count: 1, claim_count: 1, cell_count: 1, member_count: 1, selector_count: 1, sealed_ms: f.now + 6 });
    insert(f.db, t.publications, { id: publication, scope_id: f.scope, run_id: begun.run.id, seal_id: seal, source_publication_id: begun.run.source_publication_id!, base_source_publication_id: null, kind: 'cutover', published_ms: f.now + 7 });
    beforeSourcePointer?.();
    insert(f.db, '_calendar_series_native_receipts', { id: nativeId, scope_id: f.scope, domain: 'calendar-series-native-v1', owner_id: f.owner, source_id: accepted.sourceId, series_id: accepted.series, generation_id: accepted.generation, source_generation: 1, grant_id: accepted.grant, grant_epoch: 1, preparation_id: accepted.preparation, phase: 'commit', logical_key: 'cutover', candidate_digest: accepted.planDigest, cursor_digest: h('completed-nominal-progress'), policy_digest: accepted.policy, outcome: 'publication.ready', accepted_ms: f.now + 8 });
    insert(f.db, '_calendar_series_publications', { id: begun.run.source_publication_id!, scope_id: f.scope, series_id: accepted.series, preparation_id: accepted.preparation, generation_id: accepted.generation, base_publication_id: null, owner_id: f.owner, source_id: accepted.sourceId, source_generation: 1, grant_id: accepted.grant, grant_epoch: 1, manifest_digest: accepted.planDigest, native_receipt_id: nativeId, published_ms: f.now + 9, operation: 'series.publication.applied' });
    if (!options.omitHead) insert(f.db, t.continuationHeads, { id: 'head-' + accepted.series, scope_id: f.scope, series_id: accepted.series, generation_id: accepted.generation, logical_segment_id: 'logical-' + accepted.series, source_publication_id: begun.run.source_publication_id!, grant_id: accepted.grant, grant_epoch: 1, engine_generation: accepted.engine, run_id: begun.run.id, progress_id: 'progress-' + begun.run.id, revision: 1 });
    insert(f.db, t.receipts, receipt(f, begun, batch, 4, { phase: options.phase ?? 'publish', accepted_ms: f.now + 9 }));
  })();
}

test('private021 builds its actual raw map without registering or changing001–020 source/checksums', () => {
  const f = fixture('020');
  try {
    const before = [...calendarRealm.migrations, CALENDAR_SERIES_MIGRATION].map(hashMigration), selected = Object.keys(calendarRealm.tables), ledger = f.db.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(f.migrate()).toEqual(['021']); expect(calendarRealm.version).toBe('19'); expect(Object.keys(calendarRealm.tables)).toEqual(selected);
    expect([...calendarRealm.migrations, CALENDAR_SERIES_MIGRATION].map(hashMigration)).toEqual(before);
    const inspected = inspectDatabaseSchema(f.db), declared = calendarSeriesMaterializationTables();
    expect(diffSchemaSnapshots(snapshotDeclaredTables(declared), { tables: Object.fromEntries(Object.keys(declared).map(name => [name, inspected.tables[name]!])) })).toEqual([]);
    expect(f.db.query('SELECT * FROM _migrations ORDER BY version LIMIT 20').all()).toEqual(ledger);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]); expect(f.migrate()).toEqual([]);
  } finally { f.close(); }
});

test('actual private021 realm imports through native FK graph validation without changing the registered019 fingerprint', async () => {
  const fingerprint = calendarRealm.fingerprint, checksums = calendarRealm.migrationChecksums, commands = Object.keys(calendarRealm.commands);
  const { calendarSeriesMaterializationRealm: privateRealm } = await import('./series-materialization-realm');
  expect(privateRealm.version).toBe('21'); expect(hashMigration(privateRealm.migrations.at(-1)!)).toBe(hashMigration(CALENDAR_SERIES_MATERIALIZATION_MIGRATION));
  expect(Object.keys(privateRealm.tables).sort()).toEqual(Object.keys(calendarSeriesMaterializationTables()).sort());
  expect(privateRealm.fingerprint).not.toBe(fingerprint); expect(calendarRealm.fingerprint).toBe(fingerprint);
  expect(calendarRealm.migrationChecksums).toEqual(checksums); expect(Object.keys(calendarRealm.commands)).toEqual(commands); expect(commands.some(name => name.startsWith('calendar.series.'))).toBe(false);
});

test('genuine populated016 reaches private021 while preserving accepted appointments, receipts, sequence and old effects', () => {
  const f = fixture('016');
  try {
    const reactive = createReactiveDB({ database: f.db, ownsDatabase: false });
    let sequence = 0;
    try {
      for (const [name, definition] of Object.entries(calendarRealm016.tables)) reactive.defineTable(name, definition);
      runDatabaseRealmCommand(calendarRealm016, reactive, 'calendar.appointment.create', { actor: { scopeId: f.scope, userId: 'synthetic-user', principal: f.principal, manageAll: true, createOwn: true }, requestId: 'old-booking', id: 'old-appointment', title: 'Synthetic retained appointment', resourceIds: ['r'], startAt: '2031-01-01T10:00:00.000Z', endAt: '2031-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
      sequence = reactive.currentSeq;
    } finally { reactive.dispose(); }
    const retained = Object.fromEntries(Object.keys(calendarRealm016.tables).map(table => [table, f.db.query(`SELECT * FROM ${table} ORDER BY id`).all() as Row[]]));
    const ledger = f.db.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(f.migrate()).toEqual(['017', '018', '019', '020', '021']);
    for (const [table, rows] of Object.entries(retained)) for (const row of rows) expect(f.db.query(`SELECT ${Object.keys(row).join(',')} FROM ${table} WHERE id=?`).get(row.id!)).toEqual(row);
    expect(f.db.query('SELECT * FROM _migrations ORDER BY version LIMIT 16').all()).toEqual(ledger);
    const after = createReactiveDB({ database: f.db, ownsDatabase: false });
    try { expect(after.currentSeq).toBe(sequence); } finally { after.dispose(); }
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('late021 DDL collision rolls back all new DDL and preserves populated020 bytes', () => {
  const f = fixture('020');
  try {
    f.accept(); f.db.run('CREATE TABLE calendar_series_run_parent(id TEXT PRIMARY KEY)');
    // The existing object has exactly the name of the final021 trigger.
    f.db.run('CREATE TRIGGER calendar_series_run_parent BEFORE INSERT ON calendar_resources BEGIN SELECT 1; END');
    const before = f.db.serialize(); expect(() => migrateCalendarSeriesMaterialization(f.db)).toThrow(); expect(f.db.serialize()).toEqual(before);
    for (const name of Object.keys(CALENDAR_SERIES_MATERIALIZATION_ADDITIONS)) expect(f.db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(name)).toBeNull();
  } finally { f.close(); }
});

test('native run begins with a mandatory closed same-transaction receipt and retains authored generation', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), before = f.db.query('SELECT * FROM _calendar_series_receipts').all(), begun = f.begin(accepted);
    expect(f.db.query(`SELECT generation_id,kind FROM ${t.runs}`).get()).toEqual({ generation_id: accepted.generation, kind: 'cutover' });
    expect(f.db.query('SELECT * FROM _calendar_series_receipts').all()).toEqual(before);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => insert(f.db, t.runs, { ...begun.run, id: 'reused-begin-receipt' })).toThrow();
    expect(() => insert(f.db, t.runs, { ...begun.run, id: 'another-run', window_from_ms: 1893751200000, window_until_ms: 1894010400000, initial_receipt_id: 'missing-receipt' })).toThrow();
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.runs}`).get()).toEqual({ n: 1 });
  } finally { f.close(); }
});

test('a native version cannot COMMIT with a partial resource/whole-interval claim set', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), begun = f.begin(accepted), before = f.db.serialize();
    expect(() => stageVersion(f, accepted, begun, false)).toThrow('Private native batch receipt is inconsistent');
    expect(f.db.serialize()).toEqual(before); expect(f.db.query(`SELECT count(*) AS n FROM ${t.versions}`).get()).toEqual({ n: 0 });
  } finally { f.close(); }
});

test('complete pending claims block ordinary writes before any cells have been projected', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), begun = f.begin(accepted); stageVersion(f, accepted, begun);
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.members}`).get()).toEqual({ n: 0 });
    const reactive = createReactiveDB({ database: f.db, ownsDatabase: false });
    try {
      for (const [name, definition] of Object.entries(calendarRealm.tables)) reactive.defineTable(name, definition);
      const actor = { scopeId: f.scope, userId: 'synthetic-user', principal: f.principal, manageAll: true, createOwn: true };
      expect(() => runDatabaseRealmCommand(calendarRealm, reactive, 'calendar.block.create', { actor, requestId: 'conflicting-block', id: 'conflicting-block', title: 'Synthetic conflict', resourceIds: ['r'], startAt: '2030-01-01T10:15:00.000Z', endAt: '2030-01-01T10:30:00.000Z', timeZone: 'UTC' })).toThrow();
      expect(reactive.get('calendar_blocks', 'conflicting-block')).toBeNull();
    } finally { reactive.dispose(); }
    expect(() => f.db.run(`DELETE FROM ${t.claims}`)).toThrow('Private pending series claim remains authoritative');
    expect(f.db.query(`SELECT retained_count,working_count,pending_count FROM ${t.capacity} WHERE id=?`).get(t.claims)).toEqual({ retained_count: 0, working_count: 1, pending_count: 1 });
  } finally { f.close(); }
});

test('late batch facts, forged scopes, natural-key REPLACE and invented CAS counts cannot change retained evidence', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), begun = f.begin(accepted), staged = stageVersion(f, accepted, begun), before = f.db.serialize();
    expect(() => insert(f.db, t.versions, { ...staged.version, id: 'late-version', occurrence_id: 'unknown', batch_receipt_id: begun.receipt.id! })).toThrow();
    const logical = f.db.query(`SELECT * FROM ${t.logicalSegments}`).get() as Row;
    expect(() => insert(f.db, t.logicalSegments, { ...logical, id: 'different-primary-key' }, true)).toThrow();
    expect(() => insert(f.db, t.logicalSegments, { ...logical, id: 'wrong-scope', scope_id: 'tenant:other', segment_key: 'other' })).toThrow();
    expect(() => update(f.db, t.runState, String(begun.run.id), { revision: 3, candidate_count: 2 })).toThrow();
    expect(f.db.serialize()).toEqual(before);
  } finally { f.close(); }
});

test('020 commit/publication cannot claim an empty plan was materialized', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), before = f.db.serialize();
    expect(() => insert(f.db, '_calendar_series_native_receipts', { id: h('empty-native'), scope_id: f.scope, domain: 'calendar-series-native-v1', owner_id: f.owner, source_id: accepted.sourceId, series_id: accepted.series, generation_id: accepted.generation, source_generation: 1, grant_id: accepted.grant, grant_epoch: 1, preparation_id: accepted.preparation, phase: 'commit', logical_key: 'empty', candidate_digest: accepted.planDigest, cursor_digest: h('cursor'), policy_digest: accepted.policy, outcome: 'publication.ready', accepted_ms: f.now + 10 })).toThrow('Private series cutover requires complete materialization');
    expect(f.db.serialize()).toEqual(before);
  } finally { f.close(); }
});

test('complete dual-root cutover atomically selects authored publication and preserves published reservations beyond prep TTL', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), begun = f.begin(accepted), staged = stageVersion(f, accepted, begun), cell = stageCell(f, accepted, begun, staged);
    expect(f.db.query(`SELECT current_count,pending_count FROM ${t.capacity} WHERE id=?`).get(t.workingMembers)).toEqual({ current_count: 0, pending_count: 1 });
    const stagedBytes = f.db.serialize();
    expect(() => publish(f, accepted, begun, () => f.db.run(`DELETE FROM ${t.workingMembers} WHERE cell_set_id=?`, [cell.cell]))).toThrow('Private published series occupancy cannot be withdrawn');
    expect(f.db.serialize()).toEqual(stagedBytes);
    expect(() => publish(f, accepted, begun, undefined, { phase: 'batch' })).toThrow('Private native batch receipt is inconsistent'); expect(f.db.serialize()).toEqual(stagedBytes);
    expect(() => publish(f, accepted, begun, undefined, { omitHead: true })).toThrow('Private native batch receipt is inconsistent'); expect(f.db.serialize()).toEqual(stagedBytes);
    publish(f, accepted, begun);
    expect(f.db.query('SELECT published_generation_id,published_publication_id,active_preparation_id FROM calendar_series').get()).toEqual({ published_generation_id: accepted.generation, published_publication_id: begun.run.source_publication_id, active_preparation_id: null });
    expect(f.db.query(`SELECT current_count,pending_count FROM ${t.capacity} WHERE id=?`).get(t.workingMembers)).toEqual({ current_count: 1, pending_count: 0 });
    f.db.run(`DELETE FROM ${t.claims} WHERE run_id=?`, [begun.run.id!]);
    expect(() => f.db.run(`DELETE FROM ${t.workingMembers} WHERE selector_id=?`, [cell.selector])).toThrow('Private published series occupancy cannot be withdrawn');
    expect(() => f.db.run(`DELETE FROM ${t.selectors} WHERE id=?`, [cell.selector])).toThrow('Private selected series cell cannot be withdrawn');
    expect(f.db.query(`SELECT m.version_id FROM ${t.selectors} s JOIN calendar_series a ON a.id=s.series_id AND a.scope_id=s.scope_id AND a.published_publication_id=s.source_publication_id JOIN ${t.cellSets} c ON c.id=s.cell_set_id JOIN ${t.runState} q ON q.id=c.run_id AND q.state='published' JOIN ${t.workingMembers} m ON m.selector_id=s.id AND m.cell_set_id=s.cell_set_id WHERE a.scope_id=?`).all(f.scope)).toEqual([{ version_id: staged.versionId }]);
    expect(f.db.query(`SELECT * FROM ${t.continuationHeads}`).all()).toHaveLength(1); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expectCapacityMatchesPhysicalRows(f);
  } finally { f.close(); }
});

test('repeatable native horizons retain the same authored generation/grant/publication without new human receipts', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), begun = f.begin(accepted), staged = stageVersion(f, accepted, begun); stageCell(f, accepted, begun, staged); publish(f, accepted, begun);
    const before = f.db.query('SELECT * FROM _calendar_series_receipts').all(), originalSource = f.db.query('SELECT * FROM calendar_series').get();
    let previousProgress = h('completed-nominal-progress');
    for (let index = 1; index <= 2; index++) {
      const id = 'horizon-' + index, initial = h(['horizon-begin', index]), progressed = h(['horizon-step', index]), publishing = h(['horizon-publish', index]), progressId = 'progress-' + id, after = h(['horizon-progress-after', index]);
      const run: Row = { ...begun.run, id, initial_receipt_id: initial, kind: 'horizon', source_preparation_id: null, base_source_publication_id: begun.run.source_publication_id!, initial_progress_digest: previousProgress, window_from_ms: 1893751200000 + index * 86400000, window_until_ms: 1893837600000 + index * 86400000 };
      const state: Row = { ...begun.state, id, last_receipt_id: initial };
      const asBegun = { run, state, receipt: { ...begun.receipt, run_id: id } };
      expect(() => insert(f.db, t.runs, { ...run, id: 'reset-' + id, initial_receipt_id: h(['reset-initial', index]), initial_progress_digest: h('unqualified-count-reset') })).toThrow('Private materialization run parent is inconsistent');
      f.db.transaction(() => {
        insert(f.db, t.runs, run); insert(f.db, t.runState, state);
        insert(f.db, t.receipts, receipt(f, asBegun, initial, 1, { logical_key: 'begin', before_digest: previousProgress, after_digest: previousProgress }));
      })();
      f.db.transaction(() => {
        insert(f.db, t.progress, { id: progressId, scope_id: f.scope, run_id: id, revision: 1, before_digest: previousProgress, after_digest: after, checkpoint_json: '{"status":"range-complete","utcCoverage":false}', evaluated_candidates: 1, completion: 'nominal-range-complete', batch_receipt_id: progressed, created_ms: f.now + 4 });
        update(f.db, t.runState, id, { revision: 2, last_receipt_id: progressed, progress_id: progressId, projection_complete: 1, projection_cursor_json: '{"phase":"complete"}', updated_ms: f.now + 4 });
        insert(f.db, t.receipts, receipt(f, asBegun, progressed, 2, { before_digest: previousProgress, after_digest: after }));
      })();
      f.db.transaction(() => {
        update(f.db, t.runState, id, { revision: 3, last_receipt_id: publishing, updated_ms: f.now + 6 });
        insert(f.db, t.seals, { id: 'seal-' + id, scope_id: f.scope, run_id: id, plan_digest: accepted.planDigest, candidate_root: state.candidate_root!, projection_root: state.projection_root!, cell_root: state.cell_root!, progress_digest: after, receipt_id: publishing, occurrence_count: 0, resource_count: 0, claim_count: 0, cell_count: 0, member_count: 0, selector_count: 0, sealed_ms: f.now + 6 });
        insert(f.db, t.publications, { id: 'publication-' + id, scope_id: f.scope, run_id: id, seal_id: 'seal-' + id, source_publication_id: begun.run.source_publication_id!, base_source_publication_id: begun.run.source_publication_id!, kind: 'horizon', published_ms: f.now + 7 });
        update(f.db, t.continuationHeads, 'head-' + accepted.series, { run_id: id, progress_id: progressId, revision: index + 1 });
        insert(f.db, t.receipts, receipt(f, asBegun, publishing, 3, { phase: 'publish', accepted_ms: f.now + 8 }));
      })();
      previousProgress = after;
    }
    expect(f.db.query('SELECT * FROM _calendar_series_receipts').all()).toEqual(before); expect(f.db.query('SELECT * FROM calendar_series').get()).toEqual(originalSource);
    for (const table of ['_calendar_series_generations', '_calendar_series_preparations', '_calendar_series_publications']) expect(f.db.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 1 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.publications}`).get()).toEqual({ n: 3 });
    expect(f.db.query(`SELECT revision,run_id FROM ${t.continuationHeads}`).get()).toEqual({ revision: 3, run_id: 'horizon-2' });
    expect(f.db.query(`SELECT version_id FROM ${t.workingMembers}`).all()).toEqual([{ version_id: staged.versionId }]);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('receipt LAST rejects extra same-batch facts inserted after the state CAS', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), begun = f.begin(accepted), staged = stageVersion(f, accepted, begun), before = f.db.serialize(), batch = h('late-extra-fact-batch');
    expect(() => f.db.transaction(() => {
      const append = (suffix: string) => {
        const occurrence = staged.occurrenceId + suffix, version = staged.versionId + suffix;
        insert(f.db, t.occurrences, { id: occurrence, scope_id: f.scope, series_id: accepted.series, logical_segment_id: staged.logical, nominal_key: 'timed-v1:2030-01-0' + suffix + 'T10:00:00.000', appointment_id: occurrence, batch_receipt_id: batch });
        insert(f.db, t.versions, { ...staged.version, id: version, occurrence_id: occurrence, batch_receipt_id: batch });
        insert(f.db, t.resources, { id: 'resource-' + version, scope_id: f.scope, version_id: version, resource_id: 'r', resource_revision: 1, batch_receipt_id: batch });
        insert(f.db, t.claims, { id: 'claim-' + version, scope_id: f.scope, run_id: begun.run.id, version_id: version, resource_id: 'r', from_ms: staged.version.occupied_from_ms!, until_ms: staged.version.occupied_until_ms!, expires_ms: begun.run.expires_ms!, batch_receipt_id: batch });
      };
      append('2');
      update(f.db, t.runState, String(begun.run.id), { revision: 3, last_receipt_id: batch, candidate_count: 2, resource_count: 2, claim_count: 2, updated_ms: f.now + 5 });
      append('3');
      insert(f.db, t.receipts, receipt(f, begun, batch, 3, { candidate_delta: 2, resource_delta: 2, claim_delta: 2 }));
    })()).toThrow('Private native batch receipt is inconsistent');
    expect(f.db.serialize()).toEqual(before);
  } finally { f.close(); }
});

test('expired revoked work aborts and drains its owned complete claims through repeatable reconciliation', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), begun = f.begin(accepted); stageVersion(f, accepted, begun);
    update(f.db, '_calendar_series_preparations', accepted.preparation, { state: 'aborted', revision: 2 });
    update(f.db, 'calendar_series', accepted.series, { lifecycle: 'retired', control_revision: 2, grant_epoch: 2, active_preparation_id: null });
    for (let index = 0; index < 2; index++) f.db.transaction(() => {
      const batch = h(['cleanup', index]), at = f.now + 60001 + index;
      update(f.db, t.runState, String(begun.run.id), { revision: 3 + index, last_receipt_id: batch, state: 'aborted', phase: 'retiring', updated_ms: at });
      if (!index) {
        expect(f.db.query(`SELECT working_count,retiring_count,pending_count FROM ${t.capacity} WHERE id=?`).get(t.claims)).toEqual({ working_count: 1, retiring_count: 1, pending_count: 0 });
        f.db.run(`DELETE FROM ${t.claims} WHERE run_id=?`, [begun.run.id!]);
      }
      insert(f.db, t.receipts, receipt(f, begun, batch, 3 + index, { phase: 'reconcile', accepted_ms: at }));
    })();
    expect(f.db.query(`SELECT working_count,retiring_count FROM ${t.capacity} WHERE id=?`).get(t.claims)).toEqual({ working_count: 0, retiring_count: 0 });
    expect(f.db.query(`SELECT state,revision FROM ${t.runState}`).get()).toEqual({ state: 'aborted', revision: 4 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.versions}`).get()).toEqual({ n: 1 }); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expectCapacityMatchesPhysicalRows(f);
  } finally { f.close(); }
});

test('published cleanup may drain staging claims/builders after TTL but cannot alter or abort the accepted proof', () => {
  const f = fixture();
  try {
    const accepted = f.accept(), begun = f.begin(accepted), staged = stageVersion(f, accepted, begun); stageCell(f, accepted, begun, staged); publish(f, accepted, begun);
    const proof = f.db.query(`SELECT * FROM ${t.runState} WHERE id=?`).get(begun.run.id!) as Row, batch = h('published-cleanup');
    f.db.transaction(() => {
      update(f.db, t.runState, String(begun.run.id), { revision: Number(proof.revision) + 1, last_receipt_id: batch, updated_ms: f.now + 60001 });
      f.db.run(`DELETE FROM ${t.claims} WHERE run_id=?`, [begun.run.id!]); f.db.run(`DELETE FROM ${t.cellBuilders} WHERE run_id=?`, [begun.run.id!]);
      insert(f.db, t.receipts, receipt(f, begun, batch, Number(proof.revision) + 1, { phase: 'reconcile', accepted_ms: f.now + 60001 }));
    })();
    const after = f.db.query(`SELECT * FROM ${t.runState} WHERE id=?`).get(begun.run.id!) as Row;
    for (const column of ['state', 'phase', 'publication_id', 'progress_id', 'candidate_root', 'projection_root', 'cell_root', 'candidate_count', 'resource_count', 'claim_count', 'cell_count', 'member_count', 'selector_count', 'working_member_count', 'projection_cursor_json', 'publication_cursor_json']) expect(after[column]).toEqual(proof[column]);
    const beforeInvalid = f.db.serialize();
    expect(() => update(f.db, t.runState, String(begun.run.id), { revision: Number(after.revision) + 1, last_receipt_id: h('invalid-published-abort'), state: 'aborted', phase: 'retiring' })).toThrow();
    expect(() => update(f.db, t.runState, String(begun.run.id), { revision: Number(after.revision) + 1, last_receipt_id: h('invalid-published-proof'), candidate_root: h('changed-proof') })).toThrow();
    expect(f.db.serialize()).toEqual(beforeInvalid); expectCapacityMatchesPhysicalRows(f); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('a same-day native horizon must preserve every previously selected cell member before rotating its selector', () => {
  for (const preserve of [false, true]) {
    const f = fixture();
    try {
      const accepted = f.accept(), begun = f.begin(accepted), staged = stageVersion(f, accepted, begun), selected = stageCell(f, accepted, begun, staged); publish(f, accepted, begun);
      const id = 'shared-cell-horizon', initial = h('shared-begin'), batch = h('shared-stage'), publishing = h('shared-publish'), progress = 'shared-progress', cell = 'shared-cell-successor';
      const run: Row = { ...begun.run, id, initial_receipt_id: initial, kind: 'horizon', source_preparation_id: null, base_source_publication_id: begun.run.source_publication_id!, initial_progress_digest: h('completed-nominal-progress'), window_from_ms: 1893495600000, window_until_ms: 1893499200000 };
      const state: Row = { ...begun.state, id, last_receipt_id: initial }, asBegun = { run, state, receipt: { ...begun.receipt, run_id: id } };
      f.db.transaction(() => {
        insert(f.db, t.runs, run); insert(f.db, t.runState, state); insert(f.db, t.receipts, receipt(f, asBegun, initial, 1, { logical_key: 'begin' }));
      })();
      f.db.transaction(() => {
        const oldCell = f.db.query(`SELECT * FROM ${t.cellSets} WHERE id=?`).get(selected.cell) as Row;
        insert(f.db, t.cellSets, { ...oldCell, id: cell, run_id: id, batch_receipt_id: batch });
        insert(f.db, t.cellBuilders, { id: cell, scope_id: f.scope, run_id: id, revision: 1, member_count: 0, member_root: h('shared-root'), batch_receipt_id: batch });
        if (preserve) {
          const member = f.db.query(`SELECT * FROM ${t.members} WHERE cell_set_id=?`).get(selected.cell) as Row;
          insert(f.db, t.members, { ...member, id: 'preserved-member', cell_set_id: cell, batch_receipt_id: batch });
          update(f.db, t.cellBuilders, cell, { revision: 2, member_count: 1 });
        }
        insert(f.db, t.cellSeals, { id: 'seal-' + cell, scope_id: f.scope, cell_set_id: cell, run_id: id, member_count: preserve ? 1 : 0, member_root: h('shared-root'), base_selector_id: selected.selector, base_cell_set_id: selected.cell, base_selector_revision: 1, batch_receipt_id: batch });
        if (preserve) insert(f.db, t.workingMembers, { id: 'preserved-working-member', scope_id: f.scope, selector_id: selected.selector, cell_set_id: cell, version_id: staged.versionId, resource_id: 'r', from_ms: staged.version.occupied_from_ms!, until_ms: staged.version.occupied_until_ms!, batch_receipt_id: batch });
        insert(f.db, t.progress, { id: progress, scope_id: f.scope, run_id: id, revision: 1, before_digest: h('completed-nominal-progress'), after_digest: h('shared-progress-after'), checkpoint_json: '{"status":"range-complete"}', evaluated_candidates: 1, completion: 'nominal-range-complete', batch_receipt_id: batch, created_ms: f.now + 4 });
        update(f.db, t.runState, id, { revision: 2, last_receipt_id: batch, cell_count: 1, member_count: preserve ? 1 : 0, working_member_count: preserve ? 1 : 0, progress_id: progress, projection_complete: 1, projection_cursor_json: '{"phase":"complete"}', updated_ms: f.now + 4 });
        insert(f.db, t.receipts, receipt(f, asBegun, batch, 2, { cell_delta: 1, member_delta: preserve ? 1 : 0, working_member_delta: preserve ? 1 : 0 }));
      })();
      const apply = (skipSelection = false, withdrawPending = false) => f.db.transaction(() => {
        update(f.db, t.runState, id, { revision: 3, last_receipt_id: publishing, updated_ms: f.now + 6 });
        insert(f.db, t.seals, { id: 'seal-' + id, scope_id: f.scope, run_id: id, plan_digest: accepted.planDigest, candidate_root: state.candidate_root!, projection_root: state.projection_root!, cell_root: state.cell_root!, progress_digest: h('shared-progress-after'), receipt_id: publishing, occurrence_count: 0, resource_count: 0, claim_count: 0, cell_count: 1, member_count: preserve ? 1 : 0, selector_count: 0, sealed_ms: f.now + 6 });
        insert(f.db, t.publications, { id: 'publication-' + id, scope_id: f.scope, run_id: id, seal_id: 'seal-' + id, source_publication_id: begun.run.source_publication_id!, base_source_publication_id: begun.run.source_publication_id!, kind: 'horizon', published_ms: f.now + 7 });
        if (withdrawPending) f.db.run(`DELETE FROM ${t.workingMembers} WHERE cell_set_id=?`, [cell]);
        if (!skipSelection) update(f.db, t.selectors, selected.selector, { cell_set_id: cell, publication_id: 'publication-' + id, revision: 2, batch_receipt_id: publishing });
        update(f.db, t.continuationHeads, 'head-' + accepted.series, { run_id: id, progress_id: progress, revision: 2 });
        insert(f.db, t.receipts, receipt(f, asBegun, publishing, 3, { phase: 'publish', accepted_ms: f.now + 8 }));
      })();
      if (preserve) {
        const before = f.db.serialize();
        expect(() => apply(true)).toThrow('Private native batch receipt is inconsistent'); expect(f.db.serialize()).toEqual(before);
        expect(() => apply(false, true)).toThrow('Private published series occupancy cannot be withdrawn'); expect(f.db.serialize()).toEqual(before);
        apply(); expect(f.db.query(`SELECT cell_set_id FROM ${t.selectors} WHERE id=?`).get(selected.selector)).toEqual({ cell_set_id: cell });
        expect(f.db.query(`SELECT m.version_id FROM ${t.selectors} s JOIN ${t.workingMembers} m ON m.selector_id=s.id AND m.cell_set_id=s.cell_set_id WHERE s.id=?`).all(selected.selector)).toEqual([{ version_id: staged.versionId }]);
        f.db.run(`DELETE FROM ${t.workingMembers} WHERE cell_set_id=?`, [selected.cell]);
        expect(f.db.query(`SELECT working_count,current_count,pending_count FROM ${t.capacity} WHERE id=?`).get(t.workingMembers)).toEqual({ working_count: 1, current_count: 1, pending_count: 0 });
      } else {
        const before = f.db.serialize(); expect(apply).toThrow('Private series working selector CAS is inconsistent'); expect(f.db.serialize()).toEqual(before);
        expect(f.db.query(`SELECT cell_set_id FROM ${t.selectors} WHERE id=?`).get(selected.selector)).toEqual({ cell_set_id: selected.cell });
      }
      expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
      expectCapacityMatchesPhysicalRows(f);
    } finally { f.close(); }
  }
});
