/** Synthetic native SYSTEM metadata only. No private files, actors, providers,
 * migrations/backups or generated output; every MEMORY handle closes finally. */
import { expect, spyOn, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { registerReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { installCalendarOwnerSchema, type CalendarOwnerRecord } from './owner-schema';
import { CalendarIntegrationWakeCatalog, CALENDAR_INTEGRATION_WAKE_SCHEMA, inspectCalendarIntegrationWakeSchema,
  installCalendarIntegrationWakeCatalog, type CalendarIntegrationWakePublication } from './integration-wake-catalog';

const ROOT = 'a'.repeat(64), REALM = 'sha256:' + 'b'.repeat(64);
const WAKES = '_calendar_integration_wakes', STATE = '_calendar_integration_wake_state';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const system = createReactiveDB({ mode: 'memory' });
  system.getRawDatabase().run('PRAGMA temp_store=MEMORY'); system.getRawDatabase().run('PRAGMA foreign_keys=ON');
  installCalendarOwnerSchema(system, true);
  const owner = (ordinal: number, established = 1): CalendarOwnerRecord => ({ id: 'calendar:' + String(ordinal).padStart(5, '0'),
    scope_id: 'tenant:synthetic-' + ordinal, owner_id: 'cal_synthetic-' + ordinal, root_hash: ROOT, realm_fingerprint: REALM, established });
  const insert = (record: CalendarOwnerRecord) => {
    const statement = system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,?)');
    try { statement.run(record.id, record.scope_id, record.owner_id, record.root_hash, record.realm_fingerprint, record.established); }
    finally { statement.finalize(); }
    return record;
  };
  const rows = (table: string) => {
    const statement = system.prepare('SELECT * FROM ' + table + ' ORDER BY id');
    try { return statement.all(); } finally { statement.finalize(); }
  };
  const objects = () => {
    const statement = system.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name');
    try { return statement.all(); } finally { statement.finalize(); }
  };
  return { system, owner, insert, rows, objects, async catalog() {
    await installCalendarIntegrationWakeCatalog(system, true); return new CalendarIntegrationWakeCatalog(system, ROOT);
  }, close() { system.dispose(); } };
}
async function configure(catalog: CalendarIntegrationWakeCatalog, stamp = 'synthetic-native-config-1', now = 10) {
  let coverage = await catalog.reconcileConfiguration(stamp, now);
  while (!coverage.complete) coverage = await catalog.seedPage({ generation: coverage.configurationGeneration, now, limit: 100 });
  return coverage;
}

test('withheld installation is read-only; additive installation preserves populated original owner identities and declarations', async () => {
  const f = fixture();
  try {
    f.insert(f.owner(1)); f.insert(f.owner(2, 0));
    const originalOwners = f.rows('_calendar_owners'), originalObjects = f.objects(), originalSequence = f.system.currentSeq;
    expect(inspectCalendarIntegrationWakeSchema(f.system)).toBe('missing');
    expect(await installCalendarIntegrationWakeCatalog(f.system, false)).toBe(false);
    expect(f.objects()).toEqual(originalObjects);
    expect(await installCalendarIntegrationWakeCatalog(f.system, true)).toBe(true);
    expect(inspectCalendarIntegrationWakeSchema(f.system)).toBe('ready');
    expect(f.rows('_calendar_owners')).toEqual(originalOwners);
    for (const original of originalObjects) expect(f.objects()).toContainEqual(original);
    expect(f.system.currentSeq).toBe(originalSequence);
    const after = f.objects(), state = f.rows(STATE);
    expect(await installCalendarIntegrationWakeCatalog(f.system, false)).toBe(true);
    expect(await installCalendarIntegrationWakeCatalog(f.system, true)).toBe(true);
    expect(f.objects()).toEqual(after); expect(f.rows(STATE)).toEqual(state);
    const catalog = new CalendarIntegrationWakeCatalog(f.system, ROOT);
    expect(catalog.coverage()).toMatchObject({ configurationStamp: null, configurationGeneration: 0, complete: false });
    expect(catalog.nextWakeAt(123)).toBe(123);
  } finally { f.close(); }
});

test('canonical normalized partial declarations are installed atomically without touching the original owner catalog', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1));
    f.system.exec(CALENDAR_INTEGRATION_WAKE_SCHEMA[WAKES].replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS').replaceAll(' ', '\n  '));
    expect(inspectCalendarIntegrationWakeSchema(f.system)).toBe('missing');
    expect(await installCalendarIntegrationWakeCatalog(f.system, false)).toBe(false);
    expect(await installCalendarIntegrationWakeCatalog(f.system, true)).toBe(true);
    expect(f.rows('_calendar_owners')).toEqual([owner]);
    expect(f.rows(WAKES)).toEqual([]); expect(f.rows(STATE)).toHaveLength(1);
  } finally { f.close(); }
});

test('incompatible/case-colliding tables, views, indexes and unexpected triggers fail exact admission without repair', async () => {
  for (const sql of [
    `CREATE TABLE ${WAKES} (id TEXT PRIMARY KEY,retained TEXT)`,
    `CREATE TABLE ${WAKES.toUpperCase()} (id TEXT PRIMARY KEY)`,
    `CREATE VIEW ${STATE} AS SELECT 'retained' AS id`,
    'CREATE INDEX calendar_integration_wakes_due ON _calendar_owners(scope_id)',
    CALENDAR_INTEGRATION_WAKE_SCHEMA[WAKES] + '; CREATE TRIGGER forbidden_wake_write AFTER INSERT ON ' + WAKES + ' BEGIN DELETE FROM _calendar_owners; END',
  ]) {
    const f = fixture();
    try {
      f.insert(f.owner(1)); f.system.exec(sql);
      const before = f.objects(), owners = f.rows('_calendar_owners');
      expect(inspectCalendarIntegrationWakeSchema(f.system)).toBe('invalid');
      for (const allowed of [false, true]) await expect(installCalendarIntegrationWakeCatalog(f.system, allowed)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
      expect(f.objects()).toEqual(before); expect(f.rows('_calendar_owners')).toEqual(owners);
    } finally { f.close(); }
  }
});

test('late DDL failure rolls back the entire addition and a later admitted retry succeeds', async () => {
  const f = fixture(); let fail = true;
  const execute = f.system.exec.bind(f.system), ddl = spyOn(f.system, 'exec').mockImplementation(sql => {
    execute(sql); if (fail && sql.startsWith('CREATE INDEX calendar_integration_wakes_due')) throw new Error('synthetic late DDL refusal');
  });
  try {
    f.insert(f.owner(1)); const before = f.objects();
    await expect(installCalendarIntegrationWakeCatalog(f.system, true)).rejects.toThrow('synthetic late DDL refusal');
    expect(f.objects()).toEqual(before); expect(inspectCalendarIntegrationWakeSchema(f.system)).toBe('missing');
    fail = false; expect(await installCalendarIntegrationWakeCatalog(f.system, true)).toBe(true);
  } finally { ddl.mockRestore(); f.close(); }
});

test('installed generation zero accepts exact owner seed/dirty writes but cannot publish quiet before configuration', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), other = f.insert(f.owner(2)), catalog = await f.catalog();
    expect(() => catalog.seedEstablishedInTransaction(owner, 10)).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    const seeded = f.system.transaction(() => catalog.seedEstablishedInTransaction(owner, 10));
    expect(seeded).toMatchObject({ owner, configurationGeneration: 0, dirtyGeneration: 1, publishedGeneration: 0, dirty: true, wakeAt: 10 });
    const first = await catalog.markDirty(other, 8);
    expect(first).toMatchObject({ configurationGeneration: 0, dirtyGeneration: 1, dirty: true, wakeAt: 8 });
    expect(await catalog.markDirty(other, 9)).toMatchObject({ dirtyGeneration: 2, wakeAt: 8 });
    const sample = catalog.sample(other); expect(sample.owner).toEqual(other); expect(Object.isFrozen(sample.owner)).toBe(true);
    expect(await catalog.publish(other, sample, { classification: 'ready', nextWakeAt: null })).toBe(false);
    expect(catalog.coverage().complete).toBe(false); expect(catalog.nextWakeAt(20)).toBe(20);
    expect(f.rows(WAKES)).toHaveLength(2);
  } finally { f.close(); }
});

test('establishment and wake seeding roll back together and stale/unestablished/replaced owner proofs cannot seed', async () => {
  const f = fixture();
  try {
    const catalog = await f.catalog(), owner = f.owner(1);
    expect(() => f.system.transaction(() => { f.insert(owner); catalog.seedEstablishedInTransaction(owner, 10); throw new Error('rollback'); })).toThrow('rollback');
    expect(f.rows('_calendar_owners')).toEqual([]); expect(f.rows(WAKES)).toEqual([]);
    expect(() => f.system.transaction(() => {
      f.insert(owner);
      try { catalog.seedEstablishedInTransaction({ ...owner, root_hash: 'c'.repeat(64) }, 10); } catch { /* Cannot make a required seed optional. */ }
    })).toThrow();
    expect(f.rows('_calendar_owners')).toEqual([]); expect(f.rows(WAKES)).toEqual([]);
    f.insert(owner); f.insert(f.owner(2, 0));
    for (const supplied of [{ ...owner, owner_id: 'cal_other' }, { ...owner, scope_id: 'tenant:other' }, { ...owner, root_hash: 'c'.repeat(64) },
      { ...owner, realm_fingerprint: 'sha256:' + 'c'.repeat(64) }, f.owner(2, 0)]) {
      await expect(catalog.markDirty(supplied, 10)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    }
    expect(f.rows(WAKES)).toEqual([]);
  } finally { f.close(); }
});

test('bounded keyset backfill resumes after reconstruction beyond 64 retained owners without whole-catalog discovery', async () => {
  const f = fixture();
  try {
    const retained = Array.from({ length: 137 }, (_, index) => f.insert(f.owner(index + 1)));
    f.insert(f.owner(200, 0)); let catalog = await f.catalog(); await catalog.markDirty(retained[0]!, 1);
    let current = await catalog.reconcileConfiguration('synthetic-config', 10), pages = 0;
    const prepare = spyOn(f.system, 'prepare');
    try {
      while (!current.complete) {
        expect(catalog.nextWakeAt(20)).toBe(20);
        current = await catalog.seedPage({ generation: current.configurationGeneration, now: 10, limit: 7 }); pages++;
        expect(current.seedCursor).not.toBeNull(); catalog = new CalendarIntegrationWakeCatalog(f.system, ROOT);
      }
      const scans = prepare.mock.calls.map(([sql]) => sql).filter(sql => sql.includes('FROM _calendar_owners INDEXED BY calendar_owners_established'));
      expect(scans).toHaveLength(20); expect(scans.every(sql => sql.includes('LIMIT ?') && sql.includes('id<=?'))).toBe(true);
    } finally { prepare.mockRestore(); }
    expect(pages).toBe(20); expect(catalog.coverage()).toEqual(current); expect(f.rows(WAKES)).toHaveLength(137);
    expect(f.rows('_calendar_owners')).toEqual([...retained, f.owner(200, 0)]);
    expect(catalog.nextWakeAt(20)).toBe(1);
    expect(await catalog.reconcileConfiguration('synthetic-config', 999)).toEqual(current);
  } finally { f.close(); }
});

test('atomic establishment seeds owners inserted behind a captured cursor and beyond its tail without false missing coverage', async () => {
  const f = fixture();
  try {
    for (const ordinal of [10, 20, 30]) f.insert(f.owner(ordinal));
    const catalog = await f.catalog(), initial = await catalog.reconcileConfiguration('synthetic-config', 10);
    const partial = await catalog.seedPage({ generation: initial.configurationGeneration, now: 10, limit: 1 });
    expect(partial).toMatchObject({ seedCursor: f.owner(10).id, seedTail: f.owner(30).id, complete: false });
    for (const ordinal of [5, 40]) f.system.transaction(() => { const owner = f.insert(f.owner(ordinal)); catalog.seedEstablishedInTransaction(owner, 11); });
    const pending = f.insert(f.owner(2, 0));
    f.system.transaction(() => {
      f.system.prepare('UPDATE _calendar_owners SET established=1 WHERE id=?').run(pending.id);
      catalog.seedEstablishedInTransaction({ ...pending, established: 1 }, 12);
    });
    let current = partial;
    while (!current.complete) current = await catalog.seedPage({ generation: initial.configurationGeneration, now: 13, limit: 1 });
    expect(current.seedTail).toBe(f.owner(30).id);
    expect(f.rows(WAKES).map(row => (row as { id: string }).id)).toEqual([2, 5, 10, 20, 30, 40].map(n => f.owner(n).id));
    const due = await catalog.takeDuePage({ now: 20, limit: 100 }); expect(due.owners).toHaveLength(6);
    expect(catalog.nextWakeAt(20)).not.toBeNull();
  } finally { f.close(); }
});

test('configuration movement preserves history, resumes its exact generation and invalidates old publication tokens', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog);
    const token = catalog.sample(owner); expect(await catalog.publish(owner, token, { classification: 'ready', nextWakeAt: null })).toBe(true);
    expect(catalog.nextWakeAt(20)).toBeNull();
    const changed = await catalog.reconcileConfiguration('synthetic-native-config-2', 30);
    expect(changed).toMatchObject({ configurationGeneration: 2, complete: false, seedCursor: null });
    expect(catalog.nextWakeAt(30)).toBe(30);
    expect(await catalog.publish(owner, token, { classification: 'ready', nextWakeAt: null })).toBe(false);
    expect(await catalog.reconcileConfiguration('synthetic-native-config-2', 40)).toEqual(changed);
    await expect(catalog.seedPage({ generation: 1, now: 40 })).rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    await catalog.seedPage({ generation: 2, now: 40 });
    const refreshed = catalog.sample(owner); expect(refreshed.dirtyGeneration).toBeGreaterThan(token.dirtyGeneration);
    expect(refreshed.configurationGeneration).toBe(2); expect(catalog.nextWakeAt(40)).toBe(40);
    expect(f.rows('_calendar_owners')).toEqual([owner]);
  } finally { f.close(); }
});

test('generation CAS rejects concurrent and same-pass writes; only a post-settlement sample publishes canonical wake', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog);
    const original = catalog.sample(owner); await catalog.markDirty(owner, 11); await catalog.markDirty(owner, 12);
    expect(await catalog.publish(owner, original, { classification: 'ready', nextWakeAt: null })).toBe(false);
    const current = catalog.sample(owner);
    expect(current.dirtyGeneration).toBe(original.dirtyGeneration + 2);
    expect(await catalog.publish(owner, current, { classification: 'ready', nextWakeAt: 100 })).toBe(true);
    expect(catalog.nextWakeAt(20)).toBe(100);
    const wrongOwner = { ...current, owner: { ...current.owner, owner_id: 'cal_wrong' } };
    expect(await catalog.publish(owner, wrongOwner, { classification: 'ready', nextWakeAt: null })).toBe(false);
    expect(catalog.nextWakeAt(20)).toBe(100);
  } finally { f.close(); }
});

test('SYSTEM admission waits with no SQL transaction held and a dirty race while publication waits cannot be cleared', async () => {
  const f = fixture(), held = deferred(), entered = deferred(); let hold = true, publishing: Promise<boolean> | undefined;
  let remove: (() => void) | undefined;
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog); const token = catalog.sample(owner);
    remove = registerReactiveDBCommitAdmission(f.system, async operation => {
      expect(f.system.getRawDatabase().inTransaction).toBe(false);
      if (hold) { hold = false; entered.resolve(); await held.promise; }
      return operation();
    });
    publishing = catalog.publish(owner, token, { classification: 'ready', nextWakeAt: null }); await entered.promise;
    expect(f.system.getRawDatabase().inTransaction).toBe(false); await catalog.markDirty(owner, 11);
    held.resolve(); expect(await publishing).toBe(false); expect(catalog.nextWakeAt(20)).toBe(10);
  } finally { held.resolve(); await publishing?.catch(() => {}); remove?.(); f.close(); }
});

test('marker admission refusal means a simulated private writer was never entered', async () => {
  const f = fixture(); let remove: (() => void) | undefined, privateWrites = 0;
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog); const before = f.rows(WAKES);
    remove = registerReactiveDBCommitAdmission(f.system, () => { throw new Error('synthetic SYSTEM admission pressure'); });
    const command = async () => { await catalog.markDirty(owner, 11); privateWrites++; };
    await expect(command()).rejects.toThrow('synthetic SYSTEM admission pressure');
    expect(privateWrites).toBe(0); expect(f.rows(WAKES)).toEqual(before); expect(f.system.getRawDatabase().inTransaction).toBe(false);
  } finally { remove?.(); f.close(); }
});

test('a private commit followed by failed SYSTEM publication keeps its dirty wake across catalog reconstruction', async () => {
  const f = fixture(), privateEvidence = createReactiveDB({ mode: 'memory' }); let remove: (() => void) | undefined;
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog);
    privateEvidence.getRawDatabase().run('PRAGMA temp_store=MEMORY'); privateEvidence.exec('CREATE TABLE accepted_evidence (id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    await catalog.markDirty(owner, 11);
    privateEvidence.prepare('INSERT INTO accepted_evidence VALUES(?,?)').run('original', 'retained');
    const checkpoint = catalog.sample(owner);
    remove = registerReactiveDBCommitAdmission(f.system, () => { throw new Error('synthetic publication refused'); });
    await expect(catalog.publish(owner, checkpoint, { classification: 'ready', nextWakeAt: null })).rejects.toThrow('synthetic publication refused');
    remove(); remove = undefined;
    const recovered = new CalendarIntegrationWakeCatalog(f.system, ROOT);
    expect((await recovered.takeDuePage({ now: 20 })).owners[0]).toMatchObject({ owner, dirty: true, wakeAt: 10 });
    expect(privateEvidence.prepare('SELECT * FROM accepted_evidence').all()).toEqual([{ id: 'original', value: 'retained' }]);
    expect(await recovered.publish(owner, recovered.sample(owner), { classification: 'ready', nextWakeAt: 50 })).toBe(true);
    expect(recovered.nextWakeAt(20)).toBe(50);
  } finally { remove?.(); try { privateEvidence.dispose(); } finally { f.close(); } }
});

test('retry/review retain dirty occupancy and finite wakes, including failure after a previously clean publication', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog);
    const initial = catalog.sample(owner); await catalog.publish(owner, initial, { classification: 'ready', nextWakeAt: 20 });
    let failures = 0;
    for (const classification of ['retry', 'review'] as const) {
      await expect(catalog.publish(owner, catalog.sample(owner), { classification, nextWakeAt: null })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      expect(await catalog.publish(owner, catalog.sample(owner), { classification, nextWakeAt: 30 })).toBe(true);
      const row = (await catalog.takeDuePage({ now: 30 })).owners[0]!;
      expect(row).toMatchObject({ classification, dirty: true, wakeAt: 30, publishedGeneration: initial.dirtyGeneration });
      expect(row.dirtyGeneration).toBe(initial.dirtyGeneration + ++failures);
    }
    const dirty = await catalog.markDirty(owner, 31); expect(dirty).toMatchObject({ classification: 'review', dirty: true, wakeAt: 30 });
    expect(await catalog.publish(owner, catalog.sample(owner), { classification: 'ready', nextWakeAt: null })).toBe(true);
    expect(catalog.nextWakeAt(40)).toBeNull();
  } finally { f.close(); }
});

test('a newer failed physical proof fences an older successful wake observation even if no private command intervened', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog);
    const beforeFailure = catalog.sample(owner);
    expect(await catalog.publish(owner, beforeFailure, { classification: 'review', nextWakeAt: 50 })).toBe(true);
    expect(await catalog.publish(owner, beforeFailure, { classification: 'ready', nextWakeAt: null })).toBe(false);
    const current = catalog.sample(owner);
    expect(current.dirtyGeneration).toBe(beforeFailure.dirtyGeneration + 1);
    expect(catalog.nextWakeAt(20)).toBe(50);
    expect((await catalog.takeDuePage({ now: 50 })).owners[0]).toMatchObject({ classification: 'review', dirty: true });
  } finally { f.close(); }
});

test('persistent fixed-horizon pages progress past permanent early failures and behind-cursor inserts on a later turn', async () => {
  const f = fixture();
  try {
    for (let ordinal = 1; ordinal <= 73; ordinal++) f.insert(f.owner(ordinal));
    let catalog = await f.catalog(); await configure(catalog, 'fair-native-config', 0);
    let page = await catalog.takeDuePage({ now: 10, limit: 3 }); const seen: string[] = [];
    expect(page.hasMore).toBe(true);
    f.system.transaction(() => { const owner = f.insert(f.owner(0)); catalog.seedEstablishedInTransaction(owner, 0); });
    while (true) {
      expect(page.turnHorizon).toBe(10);
      for (const entry of page.owners) {
        seen.push(entry.owner.id);
        await catalog.publish(entry.owner, catalog.sample(entry.owner), { classification: 'review', nextWakeAt: 0 });
      }
      if (!page.hasMore) break;
      expect(catalog.nextWakeAt(999)).toBe(999);
      catalog = new CalendarIntegrationWakeCatalog(f.system, ROOT); page = await catalog.takeDuePage({ now: 999, limit: 3 });
    }
    expect(seen).toEqual(Array.from({ length: 73 }, (_, index) => f.owner(index + 1).id));
    expect(catalog.coverage().turnCursor).toBeNull();
    const nextTurn = await catalog.takeDuePage({ now: 999, limit: 3 });
    expect(nextTurn.turnHorizon).toBe(999); expect(nextTurn.owners[0]!.owner.id).toBe(f.owner(0).id);
    expect(nextTurn.owners.every(entry => entry.dirty)).toBe(true);
    expect(f.rows(WAKES)).toHaveLength(74); expect(f.rows('_calendar_owners')).toHaveLength(74);
  } finally { f.close(); }
});

test('a due turn does not expand its horizon while processing and backed-off owners do not hide later ready owners', async () => {
  const f = fixture();
  try {
    const owners = [1, 2, 3, 4].map(n => f.insert(f.owner(n))), catalog = await f.catalog(); await configure(catalog, 'horizon-native-config', 0);
    await catalog.publish(owners[3]!, catalog.sample(owners[3]!), { classification: 'ready', nextWakeAt: 11 });
    const first = await catalog.takeDuePage({ now: 10, limit: 1 });
    expect(first.owners[0]!.owner).toEqual(owners[0]); expect(first.hasMore).toBe(true);
    await catalog.publish(owners[0]!, catalog.sample(owners[0]!), { classification: 'retry', nextWakeAt: 1000 });
    const second = await catalog.takeDuePage({ now: 999, limit: 100 });
    expect(second.turnHorizon).toBe(10); expect(second.owners.map(row => row.owner.id)).toEqual(owners.slice(1, 3).map(owner => owner.id));
    expect(second.hasMore).toBe(false);
    const third = await catalog.takeDuePage({ now: 999, limit: 100 });
    expect(third.owners.map(row => row.owner.id)).toEqual(owners.slice(1).map(owner => owner.id));
    expect(catalog.nextWakeAt(999)).toBe(0);
  } finally { f.close(); }
});

test('admission rechecks lifecycle after its wait; pre-aborted work never enters admission or mutates metadata', async () => {
  const f = fixture(), held = deferred(), entered = deferred(); let remove: (() => void) | undefined, pending: Promise<unknown> | undefined;
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog); const before = f.rows(WAKES);
    let current = true, calls = 0;
    remove = registerReactiveDBCommitAdmission(f.system, async operation => { calls++; entered.resolve(); await held.promise; return operation(); });
    pending = catalog.markDirty(owner, 20, { assertCurrent() { if (!current) throw new Error('synthetic retired lifecycle'); } });
    await entered.promise; current = false; held.resolve(); await expect(pending).rejects.toThrow('synthetic retired lifecycle');
    expect(f.rows(WAKES)).toEqual(before);
    const controller = new AbortController(); controller.abort();
    await expect(catalog.markDirty(owner, 20, { signal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(1); expect(f.rows(WAKES)).toEqual(before);
  } finally { held.resolve(); await pending?.catch(() => {}); remove?.(); f.close(); }
});

test('corrupt retained wake identity or state is refused without repair; no replacement owner/evidence is invented', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog);
    f.system.prepare(`UPDATE ${WAKES} SET owner_id='cal_not_original' WHERE id=?`).run(owner.id);
    const corrupted = f.rows(WAKES), owners = f.rows('_calendar_owners');
    await expect(installCalendarIntegrationWakeCatalog(f.system, true)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    await expect(catalog.markDirty(owner, 20)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.rows(WAKES)).toEqual(corrupted); expect(f.rows('_calendar_owners')).toEqual(owners);
    f.system.getRawDatabase().run('PRAGMA ignore_check_constraints=ON');
    f.system.prepare(`UPDATE ${STATE} SET version=2`).run();
    expect(inspectCalendarIntegrationWakeSchema(f.system)).toBe('invalid');
    await expect(installCalendarIntegrationWakeCatalog(f.system, false)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
  } finally { f.close(); }
});

test('explicit retained admission rejects a claimed-complete catalog with a missing established owner row', async () => {
  const f = fixture();
  try {
    f.insert(f.owner(1)); const catalog = await f.catalog(); await configure(catalog);
    // Model a legacy/unsupported writer that omitted the required atomic seed.
    // Startup must not bless this as proven coverage or repair it silently.
    f.insert(f.owner(2)); const before = f.rows(WAKES);
    await expect(installCalendarIntegrationWakeCatalog(f.system, false)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    await expect(installCalendarIntegrationWakeCatalog(f.system, true)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.rows(WAKES)).toEqual(before); expect(f.rows('_calendar_owners')).toHaveLength(2);
  } finally { f.close(); }
});

test('post-install future-generation wake corruption fails point reads and due discovery rather than spinning nonpublication', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog);
    f.system.prepare(`UPDATE ${WAKES} SET configuration_generation=2 WHERE id=?`).run(owner.id);
    const before = f.rows(WAKES);
    expect(() => catalog.sample(owner)).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
    await expect(catalog.markDirty(owner, 20)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    await expect(catalog.takeDuePage({ now: 20 })).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.rows(WAKES)).toEqual(before); expect(catalog.coverage().turnCursor).toBeNull();
  } finally { f.close(); }
});

test('async catalog mutations refuse an existing SQL transaction instead of awaiting SYSTEM admission with its lock', async () => {
  const f = fixture(); let remove: (() => void) | undefined;
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog); let admissions = 0;
    remove = registerReactiveDBCommitAdmission(f.system, async operation => { admissions++; return operation(); });
    let pending!: Promise<unknown>;
    f.system.transaction(() => { pending = catalog.markDirty(owner, 20); });
    await expect(pending).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(admissions).toBe(0);
    // The deliberately synchronous helper remains the one supported path for
    // atomic owner establishment in an already admitted transaction.
    const seeded = f.system.transaction(() => catalog.seedEstablishedInTransaction(owner, 20));
    expect(seeded.owner).toEqual(owner); expect(admissions).toBe(0);
  } finally { remove?.(); f.close(); }
});

test('monotonic counter overflow refuses rather than wrapping or clearing a retained obligation', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog);
    f.system.prepare(`UPDATE ${WAKES} SET dirty_generation=? WHERE id=?`).run(Number.MAX_SAFE_INTEGER, owner.id);
    const before = f.rows(WAKES);
    await expect(catalog.markDirty(owner, 20)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.rows(WAKES)).toEqual(before);
    f.system.prepare(`UPDATE ${STATE} SET configuration_generation=?`).run(Number.MAX_SAFE_INTEGER);
    await expect(catalog.reconcileConfiguration('synthetic-other-config', 20)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.rows('_calendar_owners')).toEqual([owner]);
  } finally { f.close(); }
});

test('closed publication and page bounds reject invalid inputs without changing retained rows', async () => {
  const f = fixture();
  try {
    const owner = f.insert(f.owner(1)), catalog = await f.catalog(); await configure(catalog); const before = f.rows(WAKES);
    for (const limit of [0, 101, 1.5]) await expect(catalog.takeDuePage({ now: 10, limit })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    for (const publication of [{ classification: 'unknown', nextWakeAt: 10 }, { classification: 'ready', nextWakeAt: -1 }]) {
      await expect(catalog.publish(owner, catalog.sample(owner), publication as CalendarIntegrationWakePublication)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    expect(f.rows(WAKES)).toEqual(before);
  } finally { f.close(); }
});
