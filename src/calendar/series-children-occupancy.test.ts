/** Query-specific synthetic MEMORY fixtures. These exercise selection SQL, not
 * migration triggers or physical actor qualification. All handles close finally. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createDatabaseReadQuerySession, type DatabaseReadQueryConnection } from '../databases/database-read-query-capability';
import { CALENDAR_SERIES_CHILD_ADDITIONS, CALENDAR_SERIES_CHILD_TABLES as t } from './realm-series-children-migration';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';
import { readCalendarSelectedSeriesOccupancy } from './series-children-occupancy';

const scopeId = 'application', start = Date.parse('2030-01-01T10:00:00Z'), end = start + 3_600_000, now = start - 86_400_000;
const requested = { scopeId, resourceIds: ['resource'], occupiedStartMs: start, occupiedEndMs: end, nowMs: now };
function fixture() {
  const raw = new Database(':memory:'); let session: ReturnType<typeof createDatabaseReadQuerySession> | undefined;
  try {
    raw.run('PRAGMA temp_store=MEMORY');
    for (const [table, schema] of Object.entries(CALENDAR_SERIES_CHILD_ADDITIONS)) raw.run(`CREATE TABLE ${table}(${Object.entries(schema)
      .map(([column, definition]) => `${column} ${column === 'id' ? 'TEXT PRIMARY KEY' : String(definition).includes('INTEGER') ? 'INTEGER' : 'TEXT'}`).join(',')})`);
    for (const [table, columns] of Object.entries({
      calendar_series: 'id TEXT PRIMARY KEY,scope_id TEXT,owner_id TEXT,published_publication_id TEXT',
      [n.selectors]: 'id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,source_publication_id TEXT,cell_set_id TEXT,resource_id TEXT,cell_start_ms INTEGER',
      [n.cellSets]: 'id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,run_id TEXT,resource_id TEXT,cell_start_ms INTEGER',
      [n.workingMembers]: 'id TEXT PRIMARY KEY,scope_id TEXT,selector_id TEXT,cell_set_id TEXT,resource_id TEXT,version_id TEXT,from_ms INTEGER,until_ms INTEGER',
      [n.versions]: 'id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,occurrence_id TEXT,run_id TEXT',
      [n.runs]: 'id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,expires_ms INTEGER',
      [n.runState]: 'id TEXT PRIMARY KEY,scope_id TEXT,state TEXT',
      [n.claims]: 'id TEXT PRIMARY KEY,scope_id TEXT,resource_id TEXT,run_id TEXT,version_id TEXT,from_ms INTEGER,until_ms INTEGER,expires_ms INTEGER',
    })) raw.run(`CREATE TABLE ${table}(${columns})`);
    raw.run(`CREATE INDEX occupancy_child_resource ON ${t.resources}(scope_id,view_id,resource_id,occupies,occupied_from_ms,appointment_id)`);
    raw.run(`CREATE INDEX occupancy_child_directory ON ${t.directory}(scope_id,resource_id,view_id)`);
    raw.run(`CREATE UNIQUE INDEX occupancy_child_point ON ${t.heads}(scope_id,view_id,appointment_id)`);
    raw.run(`CREATE INDEX occupancy_child_resource_point ON ${t.resources}(scope_id,view_id,appointment_id,selection_revision,resource_id)`);
    const insert = (table: string, row: Record<string, SQLQueryBindings>) => raw.query(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    insert(t.state, { id: 'application', version: 22, ranges_ready: 1 });
    const source = (id: string, promoted = true) => {
      insert('calendar_series', { id, scope_id: scopeId, owner_id: 'owner', published_publication_id: 'source-' + id });
      insert(n.runState, { id: 'run-' + id, scope_id: scopeId, state: 'published' });
      if (promoted) {
        insert(t.current, { id, scope_id: scopeId, series_id: id, owner_id: 'owner', current_view_id: 'view-' + id });
        insert(t.views, { id: 'view-' + id, scope_id: scopeId, series_id: id, owner_id: 'owner', phase: 'current', source_publication_id: 'source-' + id, publication_id: 'seal-' + id, adoption_digest: 'adoption-' + id });
        insert(t.viewPublications, { id: 'seal-' + id, scope_id: scopeId, series_id: id, view_id: 'view-' + id, source_publication_id: 'source-' + id, adoption_digest: 'adoption-' + id });
        insert(t.directory, { id: 'directory-' + id, scope_id: scopeId, series_id: id, view_id: 'view-' + id, resource_id: 'resource' });
      }
    };
    const legacy = (id: string) => {
      const day = Math.floor(start / 86_400_000) * 86_400_000;
      insert(n.selectors, { id: 'selector-' + id, scope_id: scopeId, series_id: id, source_publication_id: 'source-' + id, cell_set_id: 'cell-' + id, resource_id: 'resource', cell_start_ms: day });
      insert(n.cellSets, { id: 'cell-' + id, scope_id: scopeId, series_id: id, run_id: 'run-' + id, resource_id: 'resource', cell_start_ms: day });
      insert(n.workingMembers, { id: 'member-' + id, scope_id: scopeId, selector_id: 'selector-' + id, cell_set_id: 'cell-' + id, resource_id: 'resource', version_id: 'old-' + id, from_ms: start, until_ms: end });
    };
    const child = (id: string, status = 'confirmed', from = start, until = end, origin = 'native21') => {
      const head = 'head-' + id, version = 'version-' + id;
      insert(n.versions, { id: version, scope_id: scopeId, series_id: id, occurrence_id: id, run_id: 'run-' + id });
      insert(t.heads, { id: head, scope_id: scopeId, series_id: id, view_id: 'view-' + id, appointment_id: id, occurrence_id: id,
        status, origin_kind: origin, version_id: version, native_version_id: version, native_run_id: 'run-' + id,
        child_revision: 1, selection_revision: 1, child_exception_revision: 0, occupied_from_ms: from, occupied_until_ms: until });
      insert(t.resources, { id: 'resource-' + id, scope_id: scopeId, series_id: id, view_id: 'view-' + id, appointment_id: id, head_id: head,
        resource_id: 'resource', occupies: Number(status === 'confirmed'), version_id: version, status, child_revision: 1, selection_revision: 1, occupied_from_ms: from, occupied_until_ms: until });
    };
    const claim = (id: string, kind: 'native' | 'child', state = 'preparing', expires = now + 1000, ownScope = scopeId, resource = 'resource') => {
      if (kind === 'native') {
        insert(n.runs, { id, scope_id: ownScope, expires_ms: expires }); insert(n.runState, { id, scope_id: ownScope, state });
        insert(n.claims, { id, scope_id: ownScope, run_id: id, resource_id: resource, version_id: 'pending-' + id, from_ms: start, until_ms: end, expires_ms: expires });
      } else {
        insert(t.changes, { id, scope_id: ownScope, state, expires_ms: expires });
        insert(t.claims, { id, scope_id: ownScope, change_id: id, variant_id: 'pending-' + id, resource_id: resource, occupied_from_ms: start, occupied_until_ms: end, expires_ms: expires });
      }
    };
    session = createDatabaseReadQuerySession(raw);
    const statements: string[] = [];
    const query: DatabaseReadQueryConnection['query'] = function <T = unknown, P extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[]>(sql: string) {
      statements.push(sql); return session!.context.database.query<T, P>(sql);
    };
    const context = { database: { query, prepare: session.context.database.prepare } };
    return { raw, insert, source, legacy, child, claim, statements, query: (input: unknown = requested) => readCalendarSelectedSeriesOccupancy(context, input),
      close() { session?.close(); raw.close(); } };
  } catch (error) { session?.close(); raw.close(); throw error; }
}

test('selected whole child occupancy replaces promoted stale cells, while unpromoted sources retain legacy protection', () => {
  const f = fixture(); try {
    f.source('moved'); f.legacy('moved'); f.child('moved', 'confirmed', end, end + 3_600_000);
    f.source('cancelled'); f.legacy('cancelled'); f.child('cancelled', 'cancelled');
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
    expect(f.query({ ...requested, occupiedStartMs: end, occupiedEndMs: end + 3_600_000 }).currentConflict).toBe(true);
    f.source('legacy', false); f.legacy('legacy');
    expect(f.query().currentConflict).toBe(true);
    expect(f.query({ ...requested, excludeVersionIds: ['old-legacy'] }).currentConflict).toBe(false);
  } finally { f.close(); }
});

test('a bare selected pointer or mismatched immutable adoption seal cannot suppress legacy occupancy', () => {
  const f = fixture(); try {
    f.source('bad'); f.legacy('bad');
    f.raw.query(`UPDATE ${t.viewPublications} SET adoption_digest='mismatch' WHERE series_id='bad'`).run();
    expect(f.query().currentConflict).toBe(true);
    f.raw.query(`DELETE FROM ${t.viewPublications}`).run();
    expect(f.query().currentConflict).toBe(true);
  } finally { f.close(); }
});

test('actual origin publication and exact resource/head revision select occupancy before LIMIT', () => {
  const f = fixture(); try {
    f.source('hidden'); f.child('hidden');
    f.raw.query(`UPDATE ${n.runState} SET state='sealed' WHERE id='run-hidden'`).run();
    expect(f.query().currentConflict).toBe(false);
    f.raw.query(`UPDATE ${n.runState} SET state='published' WHERE id='run-hidden'`).run();
    f.raw.query(`UPDATE ${t.resources} SET selection_revision=2`).run(); expect(f.query().currentConflict).toBe(false);
    f.raw.query(`UPDATE ${t.resources} SET selection_revision=1`).run(); expect(f.query().currentConflict).toBe(true);
    expect(f.query({ ...requested, excludeVersionIds: ['version-hidden'] }).currentConflict).toBe(false);
    expect(f.query({ ...requested, scopeId: 'tenant:other' }).currentConflict).toBe(false);
  } finally { f.close(); }
});

test('both live claim families block, and expiry or abort remains reconciliation work until physical withdrawal', () => {
  for (const kind of ['native', 'child'] as const) {
    const f = fixture(); try {
      f.claim('working', kind); f.claim('other', kind, 'aborted', now, 'tenant:other'); f.claim('resource-other', kind, 'aborted', now, scopeId, 'other');
      expect(f.query()).toEqual({ currentConflict: false, pendingConflict: true, reconciliationNeeded: false });
      expect(f.query({ ...requested, excludeVersionIds: ['pending-working'] })).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
      expect(f.query({ ...requested, nowMs: now + 1000 })).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: true });
      f.raw.query(`UPDATE ${kind === 'native' ? n.runState : t.changes} SET state='aborted' WHERE id='working'`).run();
      expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: true });
      f.raw.query(`DELETE FROM ${kind === 'native' ? n.claims : t.claims} WHERE id='working'`).run();
      expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
    } finally { f.close(); }
  }
});

test('selected occupancy is readonly and never treats the range readiness flag as free-time proof', () => {
  const f = fixture(); try {
    f.source('current'); f.child('current'); f.raw.query(`UPDATE ${t.state} SET ranges_ready=0`).run();
    const before = f.raw.serialize(); expect(f.query().currentConflict).toBe(true); expect(f.raw.serialize()).toEqual(before);
    f.raw.query(`DELETE FROM ${t.state}`).run(); expect(() => f.query()).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
  } finally { f.close(); }
});

test('published legacy claim remaining after selected replacement requires physical reconciliation, not false free time', () => {
  const f = fixture(); try {
    f.source('changed'); f.child('changed', 'cancelled');
    f.insert(n.runs, { id: 'run-changed', scope_id: scopeId, series_id: 'changed', expires_ms: now + 1000 });
    f.insert(n.claims, { id: 'old-claim', scope_id: scopeId, run_id: 'run-changed', resource_id: 'resource', version_id: 'version-changed', from_ms: start, until_ms: end, expires_ms: now + 1000 });
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: true });
    expect(f.query({ ...requested, excludeVersionIds: ['version-changed'] }).reconciliationNeeded).toBe(false);
    f.raw.query(`DELETE FROM ${n.claims}`).run();
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
  } finally { f.close(); }
});

test('full multi-resource directory query uses index order without sorting retained matching partitions before its limit', () => {
  const f = fixture(); try {
    f.source('current'); f.child('current'); f.query({ ...requested, resourceIds: ['resource', 'other'] });
    const sql = f.statements.find(value => value.startsWith('SELECT d.view_id,d.resource_id'))!;
    expect(sql).toBeString();
    const plan = f.raw.query<{ detail: string }, SQLQueryBindings[]>('EXPLAIN QUERY PLAN ' + sql).all(scopeId, 'other', 'resource', 257).map(row => row.detail).join('\n');
    expect(plan).toContain('occupancy_child_directory'); expect(plan).not.toContain('TEMP B-TREE');
    const stale = f.statements.find(value => value.includes('CROSS JOIN') && value.includes('origin.id=c.version_id'))!;
    const stalePlan = f.raw.query<{ detail: string }, SQLQueryBindings[]>('EXPLAIN QUERY PLAN ' + stale)
      .all(scopeId, 'other', 'resource', start - 33 * 86_400_000, end, start).map(row => row.detail).join('\n');
    expect(stalePlan).toContain('occupancy_child_point');
    // SQLite may choose either exact working-resource index. Both bind the
    // view and appointment, rather than walking all resources for the series.
    expect(stalePlan).toMatch(/SEARCH m USING INDEX .*scope_id=\? AND view_id=\?.*appointment_id=\?/);
    expect(stalePlan).not.toMatch(/SCAN (?:h|m)(?:\s|$)/m);
  } finally { f.close(); }
});
