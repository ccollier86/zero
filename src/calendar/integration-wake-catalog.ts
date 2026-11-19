/** Framework-private SYSTEM coverage only. No domain SQL, source activation,
 * timer engine or physical owner proof belongs to this catalog. */
import type { ReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { CalendarError } from './error';
import { installCalendarOwnerSchema, type CalendarOwnerRecord } from './owner-schema';
import { calendarInteger, calendarKey, calendarScope } from './validation';

const WAKES = '_calendar_integration_wakes';
const STATE = '_calendar_integration_wake_state';
const DUE = 'calendar_integration_wakes_due';
const MAX = Number.MAX_SAFE_INTEGER;
const integer = (column: string, minimum: number) => `CHECK(typeof(${column})='integer' AND ${column} BETWEEN ${minimum} AND ${MAX})`;
export const CALENDAR_INTEGRATION_WAKE_SCHEMA = Object.freeze({
  [WAKES]: `CREATE TABLE ${WAKES} (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,root_hash TEXT NOT NULL,
    wake_at INTEGER CHECK(wake_at IS NULL OR typeof(wake_at)='integer' AND wake_at BETWEEN 0 AND ${MAX}),
    dirty_generation INTEGER NOT NULL ${integer('dirty_generation', 1)},published_generation INTEGER NOT NULL ${integer('published_generation', 0)},
    configuration_generation INTEGER NOT NULL ${integer('configuration_generation', 0)},
    classification TEXT NOT NULL CHECK(classification IN ('ready','retry','review')),
    CHECK(published_generation<=dirty_generation),CHECK(classification='ready' OR published_generation<dirty_generation),
    CHECK(wake_at IS NOT NULL OR published_generation=dirty_generation AND classification='ready'),
    FOREIGN KEY(id) REFERENCES _calendar_owners(id))`,
  [STATE]: `CREATE TABLE ${STATE} (id TEXT PRIMARY KEY CHECK(id='calendar'),version INTEGER NOT NULL CHECK(version=1),
    configuration_stamp TEXT,configuration_generation INTEGER NOT NULL ${integer('configuration_generation', 0)},
    seed_cursor TEXT,seed_tail TEXT,seed_complete INTEGER NOT NULL CHECK(seed_complete IN (0,1)),
    turn_horizon INTEGER CHECK(turn_horizon IS NULL OR typeof(turn_horizon)='integer' AND turn_horizon BETWEEN 0 AND ${MAX}),
    turn_cursor_wake INTEGER CHECK(turn_cursor_wake IS NULL OR typeof(turn_cursor_wake)='integer' AND turn_cursor_wake BETWEEN 0 AND ${MAX}),turn_cursor_id TEXT,
    CHECK((configuration_generation=0 AND configuration_stamp IS NULL AND seed_complete=0 AND seed_cursor IS NULL AND seed_tail IS NULL)
      OR configuration_generation>0 AND configuration_stamp IS NOT NULL),
    CHECK(seed_cursor IS NULL OR seed_tail IS NOT NULL AND seed_cursor<=seed_tail),
    CHECK((turn_cursor_wake IS NULL)=(turn_cursor_id IS NULL)),CHECK(turn_cursor_id IS NULL OR turn_horizon IS NOT NULL AND turn_cursor_wake<=turn_horizon))`,
  [DUE]: `CREATE INDEX ${DUE} ON ${WAKES}(wake_at,id)`,
});
type Binding = string | number | null;
type Reader = Pick<ReactiveDB, 'prepare'>;
type Classification = 'ready' | 'retry' | 'review';
interface StateRow {
  id: string; version: number; configuration_stamp: string | null; configuration_generation: number;
  seed_cursor: string | null; seed_tail: string | null; seed_complete: number;
  turn_horizon: number | null; turn_cursor_wake: number | null; turn_cursor_id: string | null;
}
interface WakeRow {
  id: string; scope_id: string; owner_id: string; root_hash: string; wake_at: number | null;
  dirty_generation: number; published_generation: number; configuration_generation: number; classification: Classification;
}
export interface CalendarIntegrationWakeOptions {
  readonly signal?: AbortSignal;
  /** Native synchronous current-owner/lifecycle fence, never caller JSON. */
  readonly assertCurrent?: () => void;
}
export interface CalendarIntegrationWakeCursor { readonly wakeAt: number; readonly id: string }
export interface CalendarIntegrationWakeCoverage {
  readonly configurationStamp: string | null; readonly configurationGeneration: number;
  readonly seedCursor: string | null; readonly seedTail: string | null; readonly complete: boolean;
  readonly turnHorizon: number | null; readonly turnCursor: CalendarIntegrationWakeCursor | null;
}
export interface CalendarIntegrationWakeCheckpoint {
  readonly owner: CalendarOwnerRecord; readonly configurationGeneration: number; readonly dirtyGeneration: number;
}
export interface CalendarIntegrationWakeEntry {
  readonly owner: CalendarOwnerRecord; readonly wakeAt: number | null; readonly dirtyGeneration: number; readonly publishedGeneration: number;
  readonly configurationGeneration: number; readonly classification: Classification; readonly dirty: boolean;
}
export interface CalendarIntegrationWakePublication { readonly classification: Classification; readonly nextWakeAt: number | null }
export interface CalendarIntegrationWakeDuePage {
  readonly owners: readonly CalendarIntegrationWakeEntry[]; readonly hasMore: boolean;
  readonly turnHorizon: number; readonly coverage: CalendarIntegrationWakeCoverage;
}
const normalize = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
function invalid(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function get<T>(database: Reader, sql: string, ...args: Binding[]): T | null {
  const statement = database.prepare(sql);
  try { return statement.get(...args) as T | null; } finally { statement.finalize(); }
}
function all<T>(database: Reader, sql: string, ...args: Binding[]): T[] {
  const statement = database.prepare(sql);
  try { return statement.all(...args) as T[]; } finally { statement.finalize(); }
}
function run(database: Reader, sql: string, ...args: Binding[]): number {
  const statement = database.prepare(sql);
  try { return statement.run(...args).changes; } finally { statement.finalize(); }
}
function guard(options: CalendarIntegrationWakeOptions): void {
  options.signal?.throwIfAborted();
  if (options.assertCurrent) {
    const result: unknown = options.assertCurrent();
    if (result !== undefined) {
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => {});
      throw new CalendarError('CALENDAR_CONFIG_INVALID');
    }
  }
}
function state(database: Reader): StateRow {
  const row = get<StateRow>(database, `SELECT * FROM ${STATE} WHERE id='calendar'`);
  if (!row || row.id !== 'calendar' || row.version !== 1 || !safe(row.configuration_generation, 0)
    || row.configuration_stamp !== null && !key(row.configuration_stamp) || (row.configuration_generation === 0) !== (row.configuration_stamp === null)
    || ![0, 1].includes(row.seed_complete) || row.configuration_generation === 0 && row.seed_complete !== 0
    || row.seed_cursor !== null && !key(row.seed_cursor) || row.seed_tail !== null && !key(row.seed_tail)
    || row.seed_cursor !== null && (row.seed_tail === null || row.seed_cursor > row.seed_tail)
    || row.configuration_generation === 0 && (row.seed_cursor !== null || row.seed_tail !== null)
    || row.turn_horizon !== null && !safe(row.turn_horizon, 0) || row.turn_cursor_wake !== null && !safe(row.turn_cursor_wake, 0)
    || (row.turn_cursor_wake === null) !== (row.turn_cursor_id === null) || row.turn_cursor_id !== null && (!key(row.turn_cursor_id)
      || row.turn_horizon === null || row.turn_cursor_wake! > row.turn_horizon)) invalid();
  return row;
}
function safe(value: unknown, minimum: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
function key(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function coverage(row: StateRow): CalendarIntegrationWakeCoverage {
  return Object.freeze({ configurationStamp: row.configuration_stamp, configurationGeneration: row.configuration_generation,
    seedCursor: row.seed_cursor, seedTail: row.seed_tail, complete: row.configuration_generation > 0 && row.seed_complete === 1,
    turnHorizon: row.turn_horizon, turnCursor: row.turn_cursor_id === null ? null : Object.freeze({ wakeAt: row.turn_cursor_wake!, id: row.turn_cursor_id }) });
}

/** Exact, read-only admission. Partial canonical installation is missing, not a
 * license to replace incompatible retained objects or evidence. */
export function inspectCalendarIntegrationWakeSchema(database: Reader): 'ready' | 'missing' | 'invalid' {
  const objects = all<{ type: string; name: string; tbl_name: string; sql: string | null }>(database,
    `SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name COLLATE NOCASE IN (?,?,?) OR tbl_name COLLATE NOCASE IN (?,?)`, WAKES, STATE, DUE, WAKES, STATE);
  let missing = false;
  for (const [name, sql] of Object.entries(CALENDAR_INTEGRATION_WAKE_SCHEMA)) {
    const selected = objects.filter(object => object.name.toLowerCase() === name.toLowerCase());
    if (!selected.length) { missing = true; continue; }
    const row = selected[0]!;
    if (selected.length !== 1 || row.name !== name || row.type !== (name === DUE ? 'index' : 'table')
      || row.tbl_name !== (name === DUE ? WAKES : name) || !row.sql || normalize(row.sql) !== normalize(sql)) return 'invalid';
  }
  if (objects.some(row => !Object.hasOwn(CALENDAR_INTEGRATION_WAKE_SCHEMA, row.name)
    && !(row.type === 'index' && row.sql === null && row.name.startsWith('sqlite_autoindex_') && [WAKES, STATE].includes(row.tbl_name)))) return 'invalid';
  if (missing) return 'missing';
  try {
    const count = get<{ n: number }>(database, `SELECT count(*) n FROM ${STATE}`)!.n;
    if (count === 0) return get(database, `SELECT 1 FROM ${WAKES} LIMIT 1`) ? 'invalid' : 'missing';
    if (count !== 1) return 'invalid';
    state(database); return 'ready';
  } catch { return 'invalid'; }
}

/** Explicit admitted SYSTEM addition, not a Calendar realm migration. It never
 * changes the historical owner table/index or visits a private database. */
export async function installCalendarIntegrationWakeCatalog(database: ReactiveDB, allowed: boolean,
  options: CalendarIntegrationWakeOptions = {}): Promise<boolean> {
  guard(options);
  const initial = inspectCalendarIntegrationWakeSchema(database);
  if (initial === 'invalid') invalid();
  if (initial === 'missing' && allowed !== true) return false;
  if (!installCalendarOwnerSchema(database, false)) throw new CalendarError('CALENDAR_NOT_READY');
  if (initial === 'ready') { validateRetained(database); return true; }
  if (database.getRawDatabase().inTransaction) throw new CalendarError('CALENDAR_NOT_READY');
  return withReactiveDBCommitAdmission(database, () => database.transaction(() => {
    guard(options);
    if (inspectCalendarIntegrationWakeSchema(database) === 'invalid') invalid();
    for (const [name, sql] of Object.entries(CALENDAR_INTEGRATION_WAKE_SCHEMA)) {
      if (!get(database, 'SELECT 1 FROM sqlite_master WHERE name=? COLLATE NOCASE', name)) database.exec(sql);
    }
    if (!get(database, `SELECT 1 FROM ${STATE} LIMIT 1`)) run(database,
      `INSERT INTO ${STATE}(id,version,configuration_stamp,configuration_generation,seed_cursor,seed_tail,seed_complete,turn_horizon,turn_cursor_wake,turn_cursor_id)
       VALUES('calendar',1,NULL,0,NULL,NULL,0,NULL,NULL,NULL)`);
    if (inspectCalendarIntegrationWakeSchema(database) !== 'ready') invalid();
    validateRetained(database); return true;
  }), options.signal ? { signal: options.signal } : {});
}

function validateRetained(database: Reader): void {
  const current = state(database);
  if (get(database, `SELECT 1 FROM ${WAKES} w LEFT JOIN _calendar_owners o ON o.id=w.id WHERE o.id IS NULL OR o.established<>1
    OR o.scope_id<>w.scope_id OR o.owner_id<>w.owner_id OR o.root_hash<>w.root_hash OR w.configuration_generation>?
    OR typeof(w.dirty_generation)<>'integer' OR w.dirty_generation NOT BETWEEN 1 AND ${MAX}
    OR typeof(w.published_generation)<>'integer' OR w.published_generation NOT BETWEEN 0 AND w.dirty_generation
    OR typeof(w.configuration_generation)<>'integer' OR w.configuration_generation<0 OR w.classification NOT IN ('ready','retry','review')
    OR w.classification<>'ready' AND w.published_generation=w.dirty_generation
    OR w.wake_at IS NOT NULL AND (typeof(w.wake_at)<>'integer' OR w.wake_at NOT BETWEEN 0 AND ${MAX})
    OR w.wake_at IS NULL AND (w.published_generation<>w.dirty_generation OR w.classification<>'ready') LIMIT 1`, current.configuration_generation)) invalid();
  // Explicit installation may audit retained coverage. Ordinary turns never
  // recount the catalog: their bounded cursor relies on atomic establishment.
  if (current.seed_complete === 1 && get(database, `SELECT 1 FROM _calendar_owners o LEFT JOIN ${WAKES} w ON w.id=o.id
    WHERE o.established=1 AND (w.id IS NULL OR w.configuration_generation<>?) LIMIT 1`, current.configuration_generation)) invalid();
}

export class CalendarIntegrationWakeCatalog {
  constructor(private readonly system: ReactiveDB, private readonly rootHash: string) {
    if (!/^[a-f0-9]{64}$/.test(rootHash)) throw new CalendarError('CALENDAR_CONFIG_INVALID');
    const admitted = inspectCalendarIntegrationWakeSchema(system);
    if (admitted === 'invalid') invalid();
    if (admitted !== 'ready') throw new CalendarError('CALENDAR_NOT_READY');
  }
  coverage(): CalendarIntegrationWakeCoverage { return coverage(state(this.system)); }

  async reconcileConfiguration(stamp: string, now: number, options: CalendarIntegrationWakeOptions = {}): Promise<CalendarIntegrationWakeCoverage> {
    calendarKey(stamp); calendarInteger(now);
    return this.admit(() => {
      const current = state(this.system);
      if (current.configuration_stamp === stamp) return coverage(current);
      if (current.configuration_generation === MAX) invalid();
      const tail = get<{ id: string }>(this.system, 'SELECT id FROM _calendar_owners INDEXED BY calendar_owners_established WHERE established=1 ORDER BY id DESC LIMIT 1')?.id ?? null;
      run(this.system, `UPDATE ${STATE} SET configuration_stamp=?,configuration_generation=configuration_generation+1,
        seed_cursor=NULL,seed_tail=?,seed_complete=?,turn_horizon=NULL,turn_cursor_wake=NULL,turn_cursor_id=NULL WHERE id='calendar'`, stamp, tail, tail === null ? 1 : 0);
      return this.coverage();
    }, options);
  }

  async seedPage(input: { readonly generation: number; readonly now: number; readonly limit?: number },
    options: CalendarIntegrationWakeOptions = {}): Promise<CalendarIntegrationWakeCoverage> {
    calendarInteger(input.generation, 1); calendarInteger(input.now); const limit = calendarInteger(input.limit ?? 25, 1, 100);
    return this.admit(() => {
      const current = state(this.system);
      if (current.configuration_generation !== input.generation) throw new CalendarError('CALENDAR_REVISION_CONFLICT');
      if (current.seed_complete === 1) return coverage(current);
      const owners = all<CalendarOwnerRecord>(this.system, `SELECT * FROM _calendar_owners INDEXED BY calendar_owners_established
        WHERE established=1 AND id<=? ${current.seed_cursor === null ? '' : 'AND id>?'} ORDER BY id LIMIT ?`,
        current.seed_tail, ...(current.seed_cursor === null ? [] : [current.seed_cursor]), limit + 1);
      for (const owner of owners.slice(0, limit)) this.seedEstablishedInTransaction(owner, input.now);
      run(this.system, `UPDATE ${STATE} SET seed_cursor=?,seed_complete=? WHERE id='calendar'`,
        owners.slice(0, limit).at(-1)?.id ?? current.seed_cursor, owners.length > limit ? 0 : 1);
      return this.coverage();
    }, options);
  }

  /** Called synchronously alongside established=1 inside an already admitted
   * SYSTEM transaction. No admission wait, private lease or async callback. */
  seedEstablishedInTransaction(owner: CalendarOwnerRecord, now: number): CalendarIntegrationWakeEntry {
    if (!this.system.getRawDatabase().inTransaction) throw new CalendarError('CALENDAR_NOT_READY');
    // ReactiveDB's nested sentinel poisons the outer transaction on failure,
    // even if an embedding accidentally catches this required-seed rejection.
    return this.system.transaction(() => {
      calendarInteger(now); const selected = this.owner(owner), current = state(this.system);
      const row = this.row(selected);
      if (!row) run(this.system, `INSERT INTO ${WAKES}(id,scope_id,owner_id,root_hash,wake_at,dirty_generation,published_generation,configuration_generation,classification)
        VALUES(?,?,?,?,?,1,0,?,'ready')`, selected.id, selected.scope_id, selected.owner_id, selected.root_hash, now, current.configuration_generation);
      else if (row.configuration_generation !== current.configuration_generation) this.dirty(selected, current.configuration_generation, now);
      return this.entry(selected, this.row(selected)!);
    });
  }

  async markDirty(owner: CalendarOwnerRecord, now: number, options: CalendarIntegrationWakeOptions = {}): Promise<CalendarIntegrationWakeEntry> {
    calendarInteger(now);
    return this.admit(() => {
      const selected = this.owner(owner), current = state(this.system), prior = this.row(selected);
      if (!prior) return this.seedEstablishedInTransaction(selected, now);
      this.dirty(selected, current.configuration_generation, now);
      return this.entry(selected, this.row(selected)!);
    }, options);
  }

  /** Caller must first join its real owner-write bodies, including this pass's
   * writes. A token is a wake CAS only, not a physical-settlement certificate. */
  sample(owner: CalendarOwnerRecord): CalendarIntegrationWakeCheckpoint {
    const selected = this.owner(owner), current = state(this.system), row = this.row(selected);
    if (!row) throw new CalendarError('CALENDAR_NOT_READY');
    return Object.freeze({ owner: selected, configurationGeneration: current.configuration_generation, dirtyGeneration: row.dirty_generation });
  }

  async publish(owner: CalendarOwnerRecord, checkpoint: CalendarIntegrationWakeCheckpoint, result: CalendarIntegrationWakePublication,
    options: CalendarIntegrationWakeOptions = {}): Promise<boolean> {
    calendarInteger(checkpoint.configurationGeneration); calendarInteger(checkpoint.dirtyGeneration, 1);
    if (!['ready', 'retry', 'review'].includes(result.classification)) throw new CalendarError('CALENDAR_INPUT_INVALID');
    if (result.nextWakeAt !== null) calendarInteger(result.nextWakeAt);
    if (result.classification !== 'ready' && result.nextWakeAt === null) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return this.admit(() => {
      const selected = this.owner(owner), current = state(this.system), row = this.row(selected);
      const sampledOwner = checkpoint.owner;
      if (!sampledOwner || sampledOwner.id !== selected.id || sampledOwner.owner_id !== selected.owner_id || sampledOwner.scope_id !== selected.scope_id
        || sampledOwner.root_hash !== selected.root_hash || sampledOwner.realm_fingerprint !== selected.realm_fingerprint || sampledOwner.established !== 1) return false;
      if (!row || current.configuration_generation === 0 || current.configuration_generation !== checkpoint.configurationGeneration
        || row.configuration_generation !== current.configuration_generation || row.dirty_generation !== checkpoint.dirtyGeneration) return false;
      // A failed/reviewed owner remains dirty. Advancing the generation also
      // fences a concurrent older successful read from clearing this failure.
      const failedObservation = result.classification !== 'ready';
      if (failedObservation && row.dirty_generation === MAX) invalid();
      run(this.system, `UPDATE ${WAKES} SET wake_at=?,classification=?,published_generation=?,dirty_generation=? WHERE id=? AND dirty_generation=? AND configuration_generation=?`,
        result.nextWakeAt, result.classification, result.classification === 'ready' ? row.dirty_generation : row.published_generation,
        row.dirty_generation + (failedObservation ? 1 : 0), selected.id, row.dirty_generation, current.configuration_generation);
      return true;
    }, options);
  }

  /** Persistent fixed-horizon keyset discovery, NOT a work claim. Advancing past
   * a failing prefix prevents starvation; insertions behind it join next turn. */
  async takeDuePage(input: { readonly now: number; readonly limit?: number }, options: CalendarIntegrationWakeOptions = {}): Promise<CalendarIntegrationWakeDuePage> {
    calendarInteger(input.now); const limit = calendarInteger(input.limit ?? 25, 1, 100);
    return this.admit(() => {
      const current = state(this.system), horizon = current.turn_horizon ?? input.now;
      const rows = all<WakeRow>(this.system, `SELECT * FROM ${WAKES} INDEXED BY ${DUE} WHERE wake_at<=?
        ${current.turn_cursor_id === null ? '' : 'AND (wake_at,id)>(?,?)'} ORDER BY wake_at,id LIMIT ?`, horizon,
        ...(current.turn_cursor_id === null ? [] : [current.turn_cursor_wake!, current.turn_cursor_id]), limit + 1);
      const selected = rows.slice(0, limit), hasMore = rows.length > limit;
      const owners = selected.map(row => {
        const owner = get<CalendarOwnerRecord>(this.system, 'SELECT * FROM _calendar_owners WHERE id=?', row.id);
        if (!owner) invalid(); return this.entry(this.owner(owner), row);
      });
      const last = selected.at(-1);
      run(this.system, `UPDATE ${STATE} SET turn_horizon=?,turn_cursor_wake=?,turn_cursor_id=? WHERE id='calendar'`,
        hasMore ? horizon : null, hasMore ? last!.wake_at : null, hasMore ? last!.id : null);
      return Object.freeze({ owners: Object.freeze(owners), hasMore, turnHorizon: horizon, coverage: this.coverage() });
    }, options);
  }

  /** Incomplete coverage always schedules another scan. Null means only quiet
   * metadata; unknown domain facts/pins still independently forbid safe disable. */
  nextWakeAt(now: number): number | null {
    calendarInteger(now); const current = state(this.system);
    if (current.configuration_generation === 0 || current.seed_complete !== 1 || current.turn_horizon !== null) return now;
    return get<{ wake_at: number }>(this.system, `SELECT wake_at FROM ${WAKES} INDEXED BY ${DUE} WHERE wake_at IS NOT NULL ORDER BY wake_at,id LIMIT 1`)?.wake_at ?? null;
  }

  private async admit<T>(operation: () => T, options: CalendarIntegrationWakeOptions): Promise<T> {
    guard(options);
    if (this.system.getRawDatabase().inTransaction) throw new CalendarError('CALENDAR_NOT_READY');
    return withReactiveDBCommitAdmission(this.system, () => this.system.transaction(() => { guard(options); return operation(); }), options.signal ? { signal: options.signal } : {});
  }
  private owner(owner: CalendarOwnerRecord): CalendarOwnerRecord {
    if (!key(owner.id) || !key(owner.owner_id) || owner.root_hash !== this.rootHash || owner.established !== 1
      || !/^sha256:[a-f0-9]{64}$/.test(owner.realm_fingerprint)) invalid();
    try { calendarScope(owner.scope_id); } catch { invalid(); }
    const retained = get<CalendarOwnerRecord>(this.system, 'SELECT * FROM _calendar_owners WHERE id=?', owner.id);
    if (!retained || retained.established !== 1 || retained.owner_id !== owner.owner_id || retained.root_hash !== owner.root_hash
      || retained.scope_id !== owner.scope_id || retained.realm_fingerprint !== owner.realm_fingerprint) invalid();
    return Object.freeze({ ...retained });
  }
  private row(owner: CalendarOwnerRecord): WakeRow | null {
    const row = get<WakeRow>(this.system, `SELECT * FROM ${WAKES} WHERE id=?`, owner.id);
    if (row) this.entry(owner, row); return row;
  }
  private entry(owner: CalendarOwnerRecord, row: WakeRow): CalendarIntegrationWakeEntry {
    if (row.id !== owner.id || row.scope_id !== owner.scope_id || row.owner_id !== owner.owner_id || row.root_hash !== owner.root_hash
      || !safe(row.dirty_generation, 1) || !safe(row.published_generation, 0) || row.published_generation > row.dirty_generation
      || !safe(row.configuration_generation, 0) || row.configuration_generation > state(this.system).configuration_generation
      || !['ready', 'retry', 'review'].includes(row.classification)
      || row.classification !== 'ready' && row.published_generation === row.dirty_generation
      || row.wake_at !== null && !safe(row.wake_at, 0) || row.wake_at === null && (row.published_generation !== row.dirty_generation || row.classification !== 'ready')) invalid();
    return Object.freeze({ owner, wakeAt: row.wake_at, dirtyGeneration: row.dirty_generation, publishedGeneration: row.published_generation,
      configurationGeneration: row.configuration_generation, classification: row.classification, dirty: row.published_generation !== row.dirty_generation });
  }
  private dirty(owner: CalendarOwnerRecord, generation: number, now: number): void {
    const row = this.row(owner); if (!row || row.dirty_generation === MAX) invalid();
    run(this.system, `UPDATE ${WAKES} SET dirty_generation=dirty_generation+1,configuration_generation=?,wake_at=? WHERE id=?`,
      generation, row.wake_at === null ? now : Math.min(now, row.wake_at), owner.id);
  }
}
