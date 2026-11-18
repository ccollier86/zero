/** Runtime existing-only routing over synthetic SYSTEM/private :memory: state and owned fake leases. No files/actors/timers. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { assertDatabaseCommitAuthorityCurrent } from '../databases/database-commit-authority';
import { canonicalDatabaseRootIdentity, createDatabaseRef } from '../databases/database-file';
import { createDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmQuery } from '../databases/database-realm';
import { createReactiveDB } from '../sync/reactive-db';
import { JobsError } from './error';
import { installJobsOwnerSchema } from './owner-schema';
import { jobsRealm } from './realm';
import { JobsRuntime, type JobsOwnerRecord, type JobsRuntimeOptions } from './runtime';
import { jobHash } from './validation';

const scope = trustedSystemServiceDataScope({ scopeKind: 'application' });
const tenant = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'synthetic-tenant' });
const id = 'jobs:' + jobHash('application');
// Only a canonical identity input: neither this directory nor any database file is created.
const rootDirectory = '/Volumes/code-bank/tmp/scratch/zero-platform/core-worker-runtime-upgrades/runtime-existing-memory-only';

function fixture(options: { established?: boolean; present?: boolean; record?: Partial<JobsOwnerRecord>; installAllowed?: boolean;
  privateOwner?: { ownerId: string; scopeId: string } | null } = {}) {
  const system = createReactiveDB({ mode: 'memory' }), authority = new AuthorityCommitCoordinator(), privateDatabase = new Database(':memory:');
  const calls = { acquire: [] as string[], acquireExisting: [] as string[], operations: [] as any[], released: 0, outstanding: 0,
    fileChecks: [] as string[], sourcePrepared: [] as string[], sourceWoken: [] as string[], ownerClosed: 0, sourceClosed: 0 };
  const state = { present: options.present ?? true, returnNullLease: false, onAcquire: null as (() => void) | null,
    onExecute: null as ((operation: any) => void | Promise<void>) | null,
    respond: null as ((operation: any) => unknown) | null };
  installJobsOwnerSchema(system, true);
  const ownerRecord: JobsOwnerRecord = { id, scope_id: 'application', owner_id: 'job_00000000-0000-4000-8000-000000000001',
    root_hash: jobHash(canonicalDatabaseRootIdentity(rootDirectory)), realm_fingerprint: jobsRealm.fingerprint,
    established: 1, wake_at: 42, wake_generation: 7, ...options.record };
  privateDatabase.run('PRAGMA temp_store=MEMORY');
  privateDatabase.run("CREATE TABLE _jobs_owner(id TEXT PRIMARY KEY CHECK(id='application'),owner_id TEXT NOT NULL,scope_id TEXT NOT NULL)");
  const privateOwner = options.privateOwner === undefined ? { ownerId: ownerRecord.owner_id, scopeId: ownerRecord.scope_id } : options.privateOwner;
  if (privateOwner) privateDatabase.run("INSERT INTO _jobs_owner VALUES('application',?,?)", [privateOwner.ownerId, privateOwner.scopeId]);
  const storeRecord = () => system.prepare('INSERT INTO _jobs_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established,wake_at,wake_generation) VALUES(?,?,?,?,?,?,?,?)')
    .run(ownerRecord.id, ownerRecord.scope_id, ownerRecord.owner_id, ownerRecord.root_hash, ownerRecord.realm_fingerprint, ownerRecord.established, ownerRecord.wake_at, ownerRecord.wake_generation);
  if (options.established !== false) storeRecord();
  const acquire = async (databaseId: string, admitted: any, existing: boolean) => {
    (existing ? calls.acquireExisting : calls.acquire).push(databaseId); state.onAcquire?.();
    if (state.returnNullLease) return null;
    calls.outstanding++;
    let released = false;
    return {
      async execute(operation: any, execution: any = {}) {
        assertDatabaseCommitAuthorityCurrent(admitted.commitAuthority, authority, createDatabaseRef(databaseId));
        execution.signal?.throwIfAborted(); calls.operations.push(operation); await state.onExecute?.(operation);
        if (operation.type === 'query' && operation.name === 'jobs.owner.check') {
          const session = createDatabaseReadQuerySession(privateDatabase);
          try { return { value: runDatabaseRealmQuery(jobsRealm, session.context, operation.name, operation.input), replayed: false }; }
          finally { session.close(); }
        }
        const output = state.respond ? state.respond(operation) : operation.type === 'query' && operation.name === 'jobs.wake' ? null : { synthetic: true };
        return { value: operation.type === 'command' ? { kind: 'command', name: operation.name, output: { ok: true, value: output } } : { ok: true, value: output }, replayed: false };
      },
      release() { if (!released) { released = true; calls.released++; calls.outstanding--; } },
    };
  };
  const owner = { acquire: (databaseId: string, admitted: any) => acquire(databaseId, admitted, false),
    acquireExisting: (databaseId: string, admitted: any) => acquire(databaseId, admitted, true),
    async close() { calls.ownerClosed++; }, diagnostics() { return { synthetic: true }; } };
  const config = { rootDirectory, createExecutor: () => { throw new Error('No actor may be created by this memory fixture.'); }, defaultActorEntrypoint: null,
    maxActiveDatabases: 1, maxDatabaseFiles: 10, concurrency: 1 };
  // Narrow, explicit test seam: exercise real methods without JobsRuntime.open's filesystem coordinator.
  const Construct = JobsRuntime as unknown as new (runtimeOptions: JobsRuntimeOptions, fakeOwner: unknown) => JobsRuntime;
  const runtime = new Construct({ config: config as never, system, installAllowed: options.installAllowed ?? true,
    authority: { coordinator: authority, actorContext: null } }, owner);
  (runtime as any).filePresent = (databaseId: string) => { calls.fileChecks.push(databaseId); return databaseId === id && state.present; };
  (runtime as any).source = { prepare(databaseId: string) { calls.sourcePrepared.push(databaseId); },
    wake(databaseId: string) { calls.sourceWoken.push(databaseId); }, async close() { calls.sourceClosed++; } };
  return { system, privateDatabase, runtime, authority, state, calls, storeRecord,
    record: () => system.prepare('SELECT * FROM _jobs_owners WHERE id=?').get(id) as JobsOwnerRecord | null,
    async close() {
      try { await runtime.close(); expect(calls.outstanding).toBe(0); }
      finally { try { await authority.close(); } finally { try { privateDatabase.close(true); } finally { system.dispose(); } } }
    } };
}

test('readExisting absent ownership returns null without owner/catalog/file provisioning', async () => {
  const f = fixture({ established: false, present: false });
  try {
    expect(await f.runtime.readExisting(scope, 'jobs.source.receipt', { requestId: 'synthetic' }, () => {})).toBeNull();
    expect(f.record()).toBeNull(); expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([]);
    expect(f.calls.operations).toEqual([]); expect(f.calls.sourcePrepared).toEqual([]);
    expect(f.calls.fileChecks).toEqual([id]);
    await expect(f.runtime.writeExisting(scope, 'jobs.source.retire', {}, 'synthetic-retire', () => {})).rejects.toMatchObject({ code: 'JOBS_NOT_FOUND', outcome: 'not-started' });
    expect(f.record()).toBeNull(); expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([]);
  } finally { await f.close(); }
});

test('orphan physical file and missing established file fail closed without provisioning', async () => {
  for (const options of [{ established: false, present: true }, { established: true, present: false }]) {
    const f = fixture(options);
    try {
      await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {})).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
      await expect(f.runtime.writeExisting(scope, 'jobs.source.retire', {}, 'retire', () => {})).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
      expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([]); expect(f.calls.operations).toEqual([]);
    } finally { await f.close(); }
  }
});

test('unestablished catalog owner never becomes an established file through existing-only APIs', async () => {
  const f = fixture({ record: { established: 0 }, present: false });
  try {
    const prior = f.record();
    expect(await f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {})).toBeNull();
    await expect(f.runtime.writeExisting(scope, 'jobs.source.retire', {}, 'retire', () => {})).rejects.toMatchObject({ code: 'JOBS_NOT_FOUND' });
    expect(f.record()).toEqual(prior); expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([]);
    expect(f.calls.operations).toEqual([]); expect(f.calls.sourcePrepared).toEqual([]);
  } finally { await f.close(); }
});

test('retained owner identity/root/realm corruption and incompatible deployment fail closed before lease acquisition', async () => {
  for (const record of [{ owner_id: 'forged-owner' }, { scope_id: 'tenant:forged' }, { root_hash: '0'.repeat(64) }, { realm_fingerprint: 'forged-fingerprint' }, { wake_generation: -1 }]) {
    const f = fixture({ record: record.wake_generation === -1 ? {} : record });
    try {
      // Schema CHECK rejects corrupt wake counters; bypass CHECK only in this owned synthetic memory DB to inspect the runtime guard.
      if (record.wake_generation === -1) { f.system.exec('PRAGMA ignore_check_constraints=ON'); f.system.prepare('UPDATE _jobs_owners SET wake_generation=-1 WHERE id=?').run(id); }
      await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {})).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
      expect(f.calls.acquireExisting).toEqual([]); expect(f.calls.acquire).toEqual([]);
    } finally { await f.close(); }
  }
  const f = fixture({ record: { realm_fingerprint: 'sha256:' + '0'.repeat(64) }, installAllowed: false });
  try {
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {})).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(f.calls.acquireExisting).toEqual([]); expect(f.calls.acquire).toEqual([]);
  } finally { await f.close(); }
});

test('readExisting proves the exact private owner on its existing lease, returns evidence, and never binds/writes ownership', async () => {
  const f = fixture();
  try {
    const before = f.record(), receipt = { id: 'synthetic-job', revision: 1 };
    f.state.respond = () => receipt;
    let checks = 0;
    expect(await f.runtime.readExisting<typeof receipt>(scope, 'jobs.source.receipt', { requestId: 'retired-source-original-key' }, () => { checks++; })).toEqual(receipt);
    expect(checks).toBeGreaterThan(3); expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([id]);
    expect(f.calls.operations).toEqual([
      { type: 'query', name: 'jobs.owner.check', input: { ownerId: before!.owner_id, scopeId: 'application' }, consistency: { mode: 'strong' } },
      { type: 'query', name: 'jobs.source.receipt', input: { requestId: 'retired-source-original-key' }, consistency: { mode: 'strong' } },
    ]);
    expect(f.record()).toEqual(before); expect(f.calls.sourcePrepared).toEqual([]); expect(f.calls.sourceWoken).toEqual([]);
    expect(f.calls.released).toBe(1); expect(f.calls.outstanding).toBe(0);
    expect(await f.runtime.readExisting(tenant, 'jobs.source.receipt', {}, () => {})).toBeNull();
    expect(f.calls.acquireExisting).toEqual([id]);
  } finally { await f.close(); }
});

test('missing, foreign and wrong-scope private Jobs owners fail before evidence without provisioning or leaking a lease', async () => {
  for (const privateOwner of [null, { ownerId: 'job_00000000-0000-4000-8000-000000000002', scopeId: 'application' },
    { ownerId: 'job_00000000-0000-4000-8000-000000000001', scopeId: 'tenant:other' }]) {
    const f = fixture({ privateOwner });
    try {
      const catalog = f.record(), rows = f.privateDatabase.query('SELECT * FROM _jobs_owner').all();
      await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', { requestId: 'must-not-read' }, () => {}))
        .rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
      expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([id]);
      expect(f.calls.operations.map(operation => operation.name)).toEqual(['jobs.owner.check']);
      expect(f.privateDatabase.query('SELECT * FROM _jobs_owner').all()).toEqual(rows); expect(f.record()).toEqual(catalog);
      expect(f.calls.sourcePrepared).toEqual([]); expect(f.calls.sourceWoken).toEqual([]);
      expect(f.calls.released).toBe(1); expect(f.calls.outstanding).toBe(0);
    } finally { await f.close(); }
  }
});

test('an earlier owner proof is never cached across later existing-only lease acquisitions', async () => {
  const f = fixture();
  try {
    f.state.respond = () => ({ id: 'synthetic-original-receipt' });
    expect(await f.runtime.readExisting<{ id: string }>(scope, 'jobs.source.receipt', {}, () => {})).toEqual({ id: 'synthetic-original-receipt' });
    f.privateDatabase.run("UPDATE _jobs_owner SET owner_id='job_00000000-0000-4000-8000-000000000002'");
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {})).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
    expect(f.calls.operations.map(operation => operation.name)).toEqual(['jobs.owner.check', 'jobs.source.receipt', 'jobs.owner.check']);
    expect(f.calls.acquireExisting).toEqual([id, id]); expect(f.calls.released).toBe(2); expect(f.calls.outstanding).toBe(0);
  } finally { await f.close(); }
});

test('existing-only acquisition race never falls back to a creating lease', async () => {
  const f = fixture();
  try {
    f.state.returnNullLease = true;
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {})).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
    expect(f.calls.acquireExisting).toEqual([id]); expect(f.calls.acquire).toEqual([]); expect(f.calls.operations).toEqual([]);
    expect(f.calls.outstanding).toBe(0); expect(f.record()!.established).toBe(1);
  } finally { await f.close(); }
});

test('synchronous live guards and abort fences prevent reads without retaining a lease', async () => {
  const f = fixture();
  try {
    const retired = new JobsError('JOBS_AUTHORITY_RETIRED');
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => { throw retired; })).rejects.toBe(retired);
    expect(f.calls.acquireExisting).toEqual([]); expect(f.calls.fileChecks).toEqual([]);
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, (() => Promise.resolve()) as never)).rejects.toMatchObject({ code: 'JOBS_CONFIG_INVALID' });
    expect(f.calls.acquireExisting).toEqual([]);
    const controller = new AbortController(); controller.abort(retired);
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {}, controller.signal)).rejects.toBe(retired);
    expect(f.calls.operations).toEqual([]); expect(f.calls.outstanding).toBe(0); expect(f.calls.released).toBe(1);
  } finally { await f.close(); }
});

test('authority loss after a read began discards evidence and releases its exact existing lease', async () => {
  const f = fixture(); let current = true;
  try {
    f.state.onExecute = () => { current = false; };
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => { if (!current) throw new JobsError('JOBS_AUTHORITY_RETIRED'); }))
      .rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
    expect(f.calls.acquire).toEqual([]); expect(f.calls.released).toBe(1); expect(f.calls.outstanding).toBe(0);
  } finally { await f.close(); }
});

test('writeExisting binds only the retained owner, marks wake dirty, executes on existing leases and refreshes bounded wake', async () => {
  const f = fixture();
  try {
    const before = f.record()!;
    expect(await f.runtime.writeExisting<{ synthetic: boolean }>(scope, 'jobs.source.retire', { expectedRevision: 1 }, 'synthetic-retire-request', () => {})).toEqual({ synthetic: true });
    expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([id, id, id]);
    expect(f.calls.operations.map(operation => [operation.type, operation.name])).toEqual([
      ['command', 'jobs.owner.bind'], ['command', 'jobs.source.retire'], ['query', 'jobs.owner.check'], ['query', 'jobs.wake']]);
    expect(f.calls.operations[0].input).toEqual({ ownerId: before.owner_id, scopeId: 'application' });
    expect(f.calls.operations[1].idempotencyKey).toBe('synthetic-retire-request');
    expect(f.record()).toEqual({ ...before, wake_at: null, wake_generation: before.wake_generation + 1 });
    expect(f.calls.sourcePrepared).toEqual([id]); expect(f.calls.sourceWoken).toEqual([id]);
    expect(f.calls.released).toBe(3); expect(f.calls.outstanding).toBe(0);
  } finally { await f.close(); }
});

test('a file lost after a committed write cannot be recreated by wake refresh or change its acknowledged result', async () => {
  const f = fixture();
  try {
    f.state.onExecute = operation => {
      if (operation.type === 'command' && operation.name === 'jobs.source.retire') { f.state.present = false; f.state.returnNullLease = true; }
    };
    expect(await f.runtime.writeExisting<{ synthetic: boolean }>(scope, 'jobs.source.retire', {}, 'committed-before-file-loss', () => {})).toEqual({ synthetic: true });
    expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([id, id]);
    expect(f.calls.operations.map(operation => operation.name)).toEqual(['jobs.owner.bind', 'jobs.source.retire']);
    expect(f.record()!.wake_at).toBe(0); expect(f.record()!.wake_generation).toBe(8);
    expect(f.calls.released).toBe(2); expect(f.calls.outstanding).toBe(0);
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {})).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
    expect(f.calls.acquire).toEqual([]);
  } finally { await f.close(); }
});

test('runtime closure rejects new existing-only operations and closes every owned resource', async () => {
  const f = fixture();
  try {
    await f.runtime.close();
    await expect(f.runtime.readExisting(scope, 'jobs.source.receipt', {}, () => {})).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    await expect(f.runtime.writeExisting(scope, 'jobs.source.retire', {}, 'after-close', () => {})).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(f.calls.ownerClosed).toBe(1); expect(f.calls.sourceClosed).toBe(1);
    expect(f.calls.acquire).toEqual([]); expect(f.calls.acquireExisting).toEqual([]);
  } finally { await f.close(); }
});
