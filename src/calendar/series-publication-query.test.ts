/** Query-specific synthetic SQLite MEMORY evidence, not a real migration,
 * actor/publication or file qualification. Sessions/databases close finally;
 * no generated fixture files, servers or dependencies exist. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createDatabaseReadQuerySession, type DatabaseReadQueryStatement } from '../databases/database-read-query-capability';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as t } from './realm-series-materialization-migration';
import { readCalendarSeriesPublicationWork, CALENDAR_SERIES_PUBLICATION_QUERY } from './series-publication-query';
import { calendarHash } from './validation';

const scopeId = 'application', ownerId = 'owner', seriesId = 'series', runId = 'run';
const input = { scopeId, ownerId, seriesId, runId };
function fixture() {
  const raw = new Database(':memory:'); let session: ReturnType<typeof createDatabaseReadQuerySession> | undefined;
  try {
    raw.run('CREATE TABLE _calendar_owner(id TEXT PRIMARY KEY,scope_id TEXT,owner_id TEXT)');
    raw.run('CREATE TABLE calendar_series(id TEXT PRIMARY KEY,scope_id TEXT,owner_id TEXT,source_id TEXT,published_publication_id TEXT)');
    raw.run(`CREATE TABLE ${t.runs}(id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,owner_id TEXT,source_id TEXT,source_publication_id TEXT)`);
    raw.run(`CREATE TABLE ${t.runState}(id TEXT PRIMARY KEY,scope_id TEXT,state TEXT,revision INTEGER)`);
    raw.run(`CREATE TABLE ${t.cellSets}(id TEXT PRIMARY KEY,scope_id TEXT,run_id TEXT,series_id TEXT,resource_id TEXT,cell_start_ms INTEGER)`);
    raw.run(`CREATE TABLE ${t.cellBuilders}(id TEXT PRIMARY KEY,scope_id TEXT,run_id TEXT,revision INTEGER,member_count INTEGER,member_root TEXT)`);
    raw.run(`CREATE TABLE ${t.cellSeals}(id TEXT PRIMARY KEY,scope_id TEXT,cell_set_id TEXT,run_id TEXT,member_count INTEGER,member_root TEXT,base_selector_id TEXT,base_cell_set_id TEXT,base_selector_revision INTEGER)`);
    raw.run(`CREATE TABLE ${t.selectors}(id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,source_publication_id TEXT,resource_id TEXT,cell_start_ms INTEGER,cell_set_id TEXT,revision INTEGER)`);
    raw.run(`CREATE TABLE ${t.members}(id TEXT PRIMARY KEY,scope_id TEXT,cell_set_id TEXT,version_id TEXT,resource_id TEXT,cell_start_ms INTEGER,from_ms INTEGER,until_ms INTEGER)`);
    raw.run(`CREATE TABLE ${t.workingMembers}(id TEXT PRIMARY KEY,scope_id TEXT,selector_id TEXT,cell_set_id TEXT,version_id TEXT,resource_id TEXT,from_ms INTEGER,until_ms INTEGER)`);
    raw.run(`CREATE INDEX calendar_series_cell_set_scope_run ON ${t.cellSets}(scope_id,run_id,id)`);
    raw.run(`CREATE INDEX calendar_series_cell_member_page ON ${t.members}(cell_set_id,scope_id,id)`);
    raw.run(`CREATE INDEX calendar_series_working_member_page ON ${t.workingMembers}(selector_id,cell_set_id,scope_id,id)`);
    raw.run(`CREATE INDEX calendar_series_working_member_cell_page ON ${t.workingMembers}(cell_set_id,scope_id,id)`);
    raw.run(`CREATE INDEX calendar_series_selector_cell ON ${t.selectors}(cell_set_id,scope_id,id)`);
    raw.run(`CREATE INDEX calendar_series_cell_seal_run ON ${t.cellSeals}(run_id,id)`);
    raw.run(`CREATE INDEX calendar_series_selected_cell ON ${t.selectors}(scope_id,series_id,source_publication_id,resource_id,cell_start_ms)`);
    raw.run(`CREATE INDEX calendar_series_cell_seal_identity ON ${t.cellSeals}(cell_set_id,scope_id,run_id)`);
    raw.query("INSERT INTO _calendar_owner VALUES('application',?,?)").run(scopeId, ownerId);
    raw.query('INSERT INTO calendar_series VALUES(?,?,?,?,?)').run(seriesId, scopeId, ownerId, 'source', 'publication');
    for (const [id, state] of [[runId, 'preparing'], ['old-run', 'published'], ['other-run', 'preparing']]) {
      raw.query(`INSERT INTO ${t.runs} VALUES(?,?,?,?,?,?)`).run(id!, scopeId, seriesId, ownerId, 'source', 'publication');
      raw.query(`INSERT INTO ${t.runState} VALUES(?,?,?,1)`).run(id!, scopeId, state!);
    }
    session = createDatabaseReadQuerySession(raw);
    function cell(id: string, selectedRun = runId, day = 0, resource = 'resource') {
      raw.query(`INSERT INTO ${t.cellSets} VALUES(?,?,?,?,?,?)`).run(id, scopeId, selectedRun, seriesId, resource, day);
      raw.query(`INSERT INTO ${t.cellBuilders} VALUES(?,?,?,1,0,?)`).run(id, scopeId, selectedRun, calendarHash('empty'));
    }
    function selector(id: string, cellId: string, day = 0, resource = 'resource') {
      raw.query(`INSERT INTO ${t.selectors} VALUES(?,?,?,?,?,?,?,1)`).run(id, scopeId, seriesId, 'publication', resource, day, cellId);
    }
    function seal(cellId: string, selectedRun = runId, baseSelectorId: string | null = null, baseCellSetId: string | null = null) {
      raw.query(`INSERT INTO ${t.cellSeals} VALUES(?,?,?,?,0,?,?,?,?)`).run('seal-' + cellId, scopeId, cellId, selectedRun, calendarHash('empty'), baseSelectorId, baseCellSetId, baseSelectorId === null ? 0 : 1);
    }
    function member(id: string, cellId: string, versionId = 'version', selectedScope = scopeId) {
      raw.query(`INSERT INTO ${t.members} VALUES(?,?,?,?,?,0,1,2)`).run(id, selectedScope, cellId, versionId, 'resource');
    }
    function working(id: string, selectorId: string, cellId: string, versionId = 'version') {
      raw.query(`INSERT INTO ${t.workingMembers} VALUES(?,?,?,?,?,?,1,2)`).run(id, scopeId, selectorId, cellId, versionId, 'resource');
    }
    return { raw, session, cell, selector, seal, member, working,
      query: (requested: Record<string, unknown>) => readCalendarSeriesPublicationWork(session!.context, { ...input, ...requested }) as any,
      close() { session?.close(); raw.close(); } };
  } catch (error) { session?.close(); raw.close(); throw error; }
}

test('fixed publication work selects only the exact owned run next cell and its logical current selector without writing', () => {
  const f = fixture();
  try {
    expect(CALENDAR_SERIES_PUBLICATION_QUERY).toBe('calendar.series.publicationWork');
    f.cell('a-retained-other-run', 'other-run'); f.cell('z-current-run'); f.selector('selected', 'old-cell');
    const before = f.raw.serialize();
    const result = f.query({ kind: 'cell' }); expect(result.cell.id).toBe('z-current-run'); expect(result.selector.id).toBe('selected');
    expect(result.builder.id).toBe('z-current-run'); expect(result.seal).toBeNull(); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.cell)).toBe(true);
    expect(f.query({ kind: 'cell', after: 'z-current-run' })).toEqual({ cell: null, selector: null, builder: null, seal: null });
    expect(f.raw.serialize()).toEqual(before);
  } finally { f.close(); }
});

test('carry pages current selected published membership before LIMIT and reports changed selector capture without copying a stale prefix', () => {
  const f = fixture();
  try {
    f.cell('old-cell', 'old-run'); f.cell('new-cell'); f.selector('selected', 'old-cell');
    for (let index = 0; index < 100; index++) f.working('a-stale-' + index, 'selected', 'superseded-cell');
    f.working('z-live-a', 'selected', 'old-cell', 'a'); f.working('z-live-b', 'selected', 'old-cell', 'b');
    const page = { kind: 'carry', selectorId: 'selected', baseCellSetId: 'old-cell', cellSetId: 'new-cell', limit: 1 };
    const first = f.query(page); expect(first.items.map((row: any) => row.id)).toEqual(['z-live-a']); expect(first.more).toBe(true); expect(first.selector.revision).toBe(1);
    const next = f.query({ ...page, after: 'z-live-a' }); expect(next.items.map((row: any) => row.id)).toEqual(['z-live-b']); expect(next.more).toBe(false);
    f.raw.query(`UPDATE ${t.selectors} SET cell_set_id='new-cell',revision=2 WHERE id='selected'`).run();
    const changed = f.query(page); expect(changed.selector.revision).toBe(2); expect(changed.items).toEqual([]);
    f.raw.query(`UPDATE ${t.selectors} SET cell_set_id='old-cell',revision=3 WHERE id='selected'`).run();
    f.raw.query(`UPDATE ${t.runState} SET state='sealed' WHERE id='old-run'`).run();
    expect(f.query(page).items).toEqual([]);
    f.raw.query(`UPDATE ${t.runState} SET state='published' WHERE id='old-run'`).run();
    f.raw.query("UPDATE calendar_series SET published_publication_id='different-current-publication'").run();
    expect(f.query(page).items).toEqual([]);
  } finally { f.close(); }
});

test('new immutable member pages are exact owned-cell bounded and cannot read another run or scope', () => {
  const f = fixture();
  try {
    f.cell('new-cell'); f.cell('other-cell', 'other-run');
    for (let index = 0; index < 100; index++) f.member('a-retained-' + index, 'other-cell');
    f.member('a-foreign-scope', 'new-cell', 'foreign', 'tenant:other'); f.member('z-new-a', 'new-cell', 'a'); f.member('z-new-b', 'new-cell', 'b');
    const first = f.query({ kind: 'members', cellSetId: 'new-cell', limit: 1 }); expect(first.items.map((row: any) => row.id)).toEqual(['z-new-a']); expect(first.more).toBe(true);
    expect(f.query({ kind: 'members', cellSetId: 'new-cell', after: 'z-new-a', limit: 1 }).items.map((row: any) => row.id)).toEqual(['z-new-b']);
    expect(() => f.query({ kind: 'members', cellSetId: 'other-cell' })).toThrow();
    expect(() => f.query({ kind: 'members', cellSetId: 'new-cell', ownerId: 'another-owner' })).toThrow();
    expect(() => f.query({ kind: 'members', cellSetId: 'new-cell', scopeId: 'tenant:other' })).toThrow();
  } finally { f.close(); }
});

test('final manifest streams at most64 cell/seal/selector triples per actor-serializable page and refuses missing facts', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 65; index++) {
      const id = 'cell-' + String(index).padStart(3, '0'), day = index * 86_400_000;
      f.cell(id, runId, day); f.seal(id); f.selector('selector-' + id, id, day);
    }
    const first = f.query({ kind: 'final' }); expect(first.items).toHaveLength(64); expect(first.more).toBe(true); expect(() => cloneDatabaseSerializableValue(first)).not.toThrow();
    const next = f.query({ kind: 'final', after: first.items.at(-1).cell.id }); expect(next.items).toHaveLength(1); expect(next.more).toBe(false);
    f.raw.query(`DELETE FROM ${t.cellSeals} WHERE cell_set_id='cell-064'`).run(); expect(() => f.query({ kind: 'final', after: 'cell-063' })).toThrow();
  } finally { f.close(); }
});

test('published cleanup selects only owned manifest base membership that is no longer selected, before its64-row limit', () => {
  const f = fixture();
  try {
    f.cell('old-selected', 'old-run'); f.cell('old-retired', 'old-run'); f.cell('new-selected'); f.cell('new-retired');
    f.selector('still-current', 'old-selected'); f.selector('replaced', 'new-retired');
    f.seal('new-selected', runId, 'still-current', 'old-selected'); f.seal('new-retired', runId, 'replaced', 'old-retired');
    f.raw.query(`UPDATE ${t.runState} SET state='published' WHERE id=?`).run(runId);
    for (let index = 0; index < 100; index++) f.working('a-current-' + index, 'still-current', 'old-selected');
    for (let index = 0; index < 65; index++) f.working('z-retired-' + String(index).padStart(3, '0'), 'replaced', 'old-retired');
    f.working('unrelated-retired', 'not-captured', 'other-history'); f.working('new-current', 'replaced', 'new-retired'); f.member('immutable-history', 'old-retired');
    const page = f.query({ kind: 'cleanup' }); expect(page.items).toHaveLength(64); expect(page.more).toBe(true);
    expect(page.items.every((row: any) => row.kind === 'working-member' && row.selector_id === 'replaced' && row.cell_set_id === 'old-retired')).toBe(true);
    for (const row of page.items) f.raw.query(`DELETE FROM ${t.workingMembers} WHERE id=?`).run(row.id);
    const last = f.query({ kind: 'cleanup' }); expect(last.items).toHaveLength(1); expect(last.more).toBe(false);
    expect(f.raw.query(`SELECT id FROM ${t.members} WHERE id='immutable-history'`).get()).not.toBeNull();
    expect(f.raw.query(`SELECT id FROM ${t.workingMembers} WHERE id='a-current-0'`).get()).not.toBeNull();
    expect(f.raw.query(`SELECT id FROM ${t.workingMembers} WHERE id='unrelated-retired'`).get()).not.toBeNull();
  } finally { f.close(); }
});

test('aborted cleanup drains own hidden working rows before empty headers, preserving selected published and externally referenced headers', () => {
  const f = fixture();
  try {
    f.cell('own-hidden'); f.cell('own-empty', runId, 86_400_000); f.cell('own-referenced', runId, 2 * 86_400_000); f.cell('old-published', 'old-run', 3 * 86_400_000);
    f.selector('own-hidden-selector', 'own-hidden'); f.selector('own-empty-selector', 'own-empty', 86_400_000); f.selector('referenced-selector', 'own-referenced', 2 * 86_400_000);
    f.selector('published-selector', 'old-published', 3 * 86_400_000);
    f.working('own-hidden-member', 'own-hidden-selector', 'own-hidden'); f.working('published-member', 'published-selector', 'old-published');
    f.working('other-run-reference', 'referenced-selector', 'not-owned-cell'); f.member('immutable-hidden-evidence', 'own-hidden');
    f.raw.query(`UPDATE ${t.runState} SET state='aborted' WHERE id=?`).run(runId);
    const first = f.query({ kind: 'cleanup', limit: 1 }); expect(first.items.map((row: any) => [row.kind, row.id])).toEqual([['working-member', 'own-hidden-member']]); expect(first.more).toBe(true);
    f.raw.query(`DELETE FROM ${t.workingMembers} WHERE id='own-hidden-member'`).run();
    const headers = f.query({ kind: 'cleanup' }); expect(headers.items.map((row: any) => [row.kind, row.id])).toEqual([
      ['selector', 'own-empty-selector'], ['selector', 'own-hidden-selector'] ]);
    for (const row of headers.items) f.raw.query(`DELETE FROM ${t.selectors} WHERE id=?`).run(row.id);
    expect(f.query({ kind: 'cleanup' })).toEqual({ items: [], more: false });
    expect(f.raw.query(`SELECT id FROM ${t.selectors} WHERE id='referenced-selector'`).get()).not.toBeNull();
    expect(f.raw.query(`SELECT id FROM ${t.workingMembers} WHERE id='published-member'`).get()).not.toBeNull();
    expect(f.raw.query(`SELECT id FROM ${t.members} WHERE id='immutable-hidden-evidence'`).get()).not.toBeNull();
  } finally { f.close(); }
});

test('page limits, routing fields, hostile inputs and query capability lifetimes remain closed', () => {
  const f = fixture();
  try {
    for (const patch of [{ kind: 'unknown' }, { kind: 'cell', limit: 0 }, { kind: 'cell', limit: 65 }, { kind: 'cell', after: 'bad cursor' },
      { kind: 'cell', sql: 'SELECT * FROM calendar_series' }, { kind: 'cell', actor: {} }, { kind: 'cell', runId: 'other-run', seriesId: 'unowned-series' }])
      expect(() => f.query(patch)).toThrow();
    let touched = false; const getter = Object.defineProperty({ ...input, kind: 'cell' }, 'after', { enumerable: true, get() { touched = true; return 'x'; } });
    expect(() => readCalendarSeriesPublicationWork(f.session.context, getter)).toThrow(); expect(touched).toBe(false);
    expect(() => readCalendarSeriesPublicationWork(f.session.context, new Proxy({ ...input, kind: 'cell' }, { ownKeys() { touched = true; return []; } }))).toThrow(); expect(touched).toBe(false);
    f.session.close(); expect(() => f.query({ kind: 'cell' })).toThrow();
  } finally { f.close(); }
});

test('publication pages use exact-run and exact selected/current cell indexes rather than retained history scans', () => {
  const f = fixture();
  try {
    f.cell('new-cell'); f.member('member', 'new-cell'); f.cell('old-cell', 'old-run'); f.selector('selected', 'old-cell'); f.working('working', 'selected', 'old-cell');
    const observed: { sql: string; params: any[] }[] = [], database = f.session.context.database;
    const traced = { database: { ...database, query<TRow = unknown, TParams extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[]>(sql: string): DatabaseReadQueryStatement<TRow, TParams> {
      const statement = database.query<TRow, TParams>(sql);
      return { ...statement, all(...params: Parameters<typeof statement.all>) { observed.push({ sql, params }); return statement.all(...params); } };
    } } };
    readCalendarSeriesPublicationWork(traced, { ...input, kind: 'members', cellSetId: 'new-cell' });
    readCalendarSeriesPublicationWork(traced, { ...input, kind: 'carry', selectorId: 'selected', baseCellSetId: 'old-cell' });
    const member = observed.find(row => row.sql.includes(`FROM ${t.members}`))!, carry = observed.find(row => row.sql.includes(`FROM ${t.workingMembers}`))!;
    const plan = ({ sql, params }: { sql: string; params: any[] }) => f.raw.query('EXPLAIN QUERY PLAN ' + sql).all(...params).map((row: any) => row.detail).join('\n');
    expect(plan(member)).toContain('calendar_series_cell_member_page'); expect(plan(carry)).toContain('calendar_series_working_member_page');
    for (const row of [member, carry]) { expect(row.sql).not.toContain('COUNT('); expect(row.sql.indexOf('WHERE')).toBeLessThan(row.sql.indexOf('LIMIT')); }
    f.seal('new-cell', runId, 'selected', 'old-cell');
    f.raw.query(`UPDATE ${t.selectors} SET cell_set_id='new-cell' WHERE id='selected'`).run();
    f.raw.query(`UPDATE ${t.runState} SET state='published' WHERE id=?`).run(runId);
    readCalendarSeriesPublicationWork(traced, { ...input, kind: 'cleanup' });
    const cleanup = observed.find(row => row.sql.includes(`FROM ${t.cellSeals} z INDEXED`))!;
    expect(plan(cleanup)).toContain('calendar_series_cell_seal_run'); expect(plan(cleanup)).toContain('calendar_series_working_member_page'); expect(plan(cleanup)).not.toContain('SCAN m');
    f.raw.query(`UPDATE ${t.runState} SET state='aborted' WHERE id=?`).run(runId); f.working('own-hidden', 'selected', 'new-cell');
    readCalendarSeriesPublicationWork(traced, { ...input, kind: 'cleanup' });
    const aborted = observed.find(row => row.sql.includes('calendar_series_working_member_cell_page'))!;
    expect(plan(aborted)).toContain('calendar_series_cell_set_scope_run'); expect(plan(aborted)).toContain('calendar_series_working_member_cell_page'); expect(plan(aborted)).not.toContain('SCAN m');
  } finally { f.close(); }
});
