/** Native MEMORY writer + closed binding/capability tests. No physical fixture. */
import { expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import { DatabaseRuntime } from './database-runtime';
import { DatabaseWriterOperationEngine } from './database-writer-engine';
import { defineDatabaseRealm } from './database-realm';
import { DatabaseError } from './database-error';
import { databaseWriterAdmissionFingerprint, normalizeDatabaseWriterAdmission, validateDatabaseWriterAdmissionInspection, type DatabaseWriterAdmissionDefinition } from './database-writer-admission';
import { validateDatabaseActorBindPayload, validateDatabaseActorBindResult } from './database-actor-protocol';
import { DatabaseCoordinatorExecutorBinding } from './database-coordinator-executor-binding';
import { CoordinatorLease } from './database-coordinator-capability';
import { createDatabaseRef } from './database-file';

const base = { name: 'synthetic-writer-admission', version: '1', tables: { obligations: { id: 'TEXT PRIMARY KEY', units: 'INTEGER NOT NULL' } } };
const admission: DatabaseWriterAdmissionDefinition = {
  id: 'synthetic.admission.v1',
  normalizeBinding(value) {
    if (value === undefined) return { limit: 3 };
    const r = value as { limit?: number };
    if (!r || Object.keys(r).join(',') !== 'limit' || !Number.isSafeInteger(r.limit) || r.limit! < 1) throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Synthetic policy invalid.');
    return { limit: r.limit! };
  },
  snapshot(context) { return Number(context.get('obligations', 'owed')?.units ?? 0); },
  validate(context, operation, previous) {
    const units = Number(context.get('obligations', 'owed')?.units ?? 0), limit = (context.policy as { limit: number }).limit;
    if (context.receipts.totalKeys + 1 + units > limit && !(operation.type === 'command' && operation.name === 'settle' && units < Number(previous))) {
      throw new DatabaseError('DATABASE_PAYLOAD_LIMIT', 'Synthetic native capacity reached.', { outcome: 'not-committed' });
    }
    return undefined;
  },
  project(context) { return { units: Number(context.get('obligations', 'owed')?.units ?? 0), limit: (context.policy as { limit: number }).limit }; },
};
const realm = defineDatabaseRealm({ ...base, writerAdmission: admission, commands: {
  admit(context) { context.db.createStrict('obligations', { id: 'owed', units: 1 }); return { policy: context.writerPolicy ?? null }; },
  noop() { return true; },
  settle(context) { context.db.update('obligations', 'owed', { units: 0 }); return true; },
} });
function fixture() {
  const sqlite = createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false });
  let runtime: DatabaseRuntime | undefined;
  try {
    sqlite.raw.run('PRAGMA temp_store=MEMORY'); runtime = DatabaseRuntime.open({ id: 'synthetic-writer-admission', role: 'named', sqlite, ownsSQLite: true, tables: realm.tables });
    const engine = new DatabaseWriterOperationEngine({ runtime, realm });
    return { runtime, engine, write(name: string, key: string = crypto.randomUUID()) { return engine.execute({ type: 'command', name, input: null, idempotencyKey: key }); },
      close() { try { engine.close(); } finally { runtime!.close(); } } };
  } catch (error) { if (runtime) runtime.close(); else sqlite.close(); throw error; }
}

test('omitted native admission preserves exact realm fingerprint and unused policy fields remain absent', () => {
  expect(defineDatabaseRealm(base).fingerprint).toBe(defineDatabaseRealm({ ...base, writerAdmission: undefined }).fingerprint);
  expect(defineDatabaseRealm(base)).not.toHaveProperty('writerAdmission');
  expect(normalizeDatabaseWriterAdmission(defineDatabaseRealm(base))).toBeUndefined();
  expect(() => normalizeDatabaseWriterAdmission(defineDatabaseRealm(base), {})).toThrow();
  expect(defineDatabaseRealm({ ...base, writerAdmission: admission }).fingerprint).not.toBe(defineDatabaseRealm(base).fingerprint);
});

test('native writer denies new-key retry spending atomically, but exact transport replay precedes admission and settlement remains possible', () => {
  const f = fixture();
  try {
    expect(f.write('admit', 'original-admit').value).toMatchObject({ output: { policy: { limit: 3 } } });
    f.write('noop'); const before = f.engine.inspectAdmission();
    expect(() => f.write('noop')).toThrow(); expect(f.engine.inspectAdmission()).toEqual(before);
    expect(f.write('admit', 'original-admit')).toMatchObject({ replayed: true });
    f.write('settle'); expect(f.engine.inspectAdmission().receipts.totalKeys).toBe(3);
    expect(() => f.write('settle')).toThrow(); expect(f.engine.inspectAdmission().receipts.totalKeys).toBe(3);
    expect(validateDatabaseWriterAdmissionInspection(f.engine.inspectAdmission())).toEqual(f.engine.inspectAdmission());
  } finally { f.close(); }
});

test('native code/normalizer is synchronous, detached/frozen and absent from IPC', () => {
  for (const bad of [{ ...admission, normalizeBinding: async () => ({ limit: 3 }) }, { ...admission, project: function* () {} }, { ...admission, extra: true }]) {
    expect(() => defineDatabaseRealm({ ...base, writerAdmission: bad as never })).toThrow();
  }
  const input = { limit: 8 }, normalized = normalizeDatabaseWriterAdmission(realm, input);
  input.limit = 999; expect(normalized).toEqual({ limit: 8 }); expect(Object.isFrozen(normalized)).toBe(true);
  const malformed = defineDatabaseRealm({ ...base, writerAdmission: { ...admission, normalizeBinding: (() => Promise.resolve({ limit: 8 })) as never } });
  expect(() => normalizeDatabaseWriterAdmission(malformed)).toThrow();
});

test('hostile nested admission proxies reject without invoking their traps', () => {
  let traps = 0;
  const hostile = new Proxy(admission, { getPrototypeOf() { traps++; throw new Error('must not evaluate'); },
    ownKeys() { traps++; throw new Error('must not evaluate'); }, getOwnPropertyDescriptor() { traps++; throw new Error('must not evaluate'); } });
  expect(() => defineDatabaseRealm({ ...base, writerAdmission: hostile })).toThrow();
  expect(traps).toBe(0);
});

test('closed actor bind and current parent handshake require exact native policy fingerprint', () => {
  const databaseRef = createDatabaseRef('synthetic-bind'), fileIdentity = { device: '12', inode: '34' }, instanceId = '00000000-0000-4000-8000-000000000001';
  const bind = { databaseRef, filePath: '/synthetic-never-created/db.sqlite', fileIdentity, instanceId,
    actorLiveness: { filePath: '/synthetic-never-created/liveness.sqlite', fileIdentity, generation: '00000000-0000-4000-8000-000000000002' },
    placement: { mode: 'file' as const }, realmFingerprint: realm.fingerprint, sqlite: {}, writerPolicy: { limit: 7 } };
  const payload = validateDatabaseActorBindPayload(bind, realm);
  expect(payload.writerPolicy).toEqual({ limit: 7 }); expect(Object.isFrozen(payload.writerPolicy)).toBe(true);
  expect(() => validateDatabaseActorBindPayload({ ...bind, writerPolicy: { limit: () => 7 } }, realm)).toThrow();
  expect(() => validateDatabaseActorBindPayload({ ...bind, writerPolicy: { limit: 7, recovery: true } }, realm)).toThrow();
  const fingerprint = databaseWriterAdmissionFingerprint(realm, payload.writerPolicy)!;
  const result = validateDatabaseActorBindResult({ databaseRef, role: 'writer', fileIdentity, instanceId, placement: bind.placement,
    realmFingerprint: realm.fingerprint, schemaChecksum: realm.schemaChecksum, sequence: { seq: 0 }, syncEpoch: 'synthetic', writerPolicyFingerprint: fingerprint });
  const binding = new DatabaseCoordinatorExecutorBinding({ realm, writerPolicy: payload.writerPolicy, createExecutor: (() => {}) as never,
    hotDurabilitySupervisor: {} as never, entries: new Map(), state: () => 'started', retire: async () => {}, emit() {} });
  const entry = { databaseRef, fileIdentity, bindingIdentity: { instanceId }, placement: bind.placement } as never;
  expect(() => binding.assertBindResult(entry, 'writer', result)).not.toThrow();
  expect(() => binding.assertBindResult(entry, 'writer', { ...result, writerPolicyFingerprint: undefined })).toThrow();
  expect(() => binding.assertBindResult(entry, 'writer', { ...result, writerPolicyFingerprint: 'a'.repeat(64) })).toThrow();
  const { writerPolicy: _unusedPolicy, ...withoutPolicy } = bind;
  const noPolicy = validateDatabaseActorBindPayload(withoutPolicy);
  expect(noPolicy).not.toHaveProperty('writerPolicy');
});

test('private lease aggregate inspection is read-authority fenced, non-mutating and revoked on release', async () => {
  const f = fixture(); let checks = 0;
  const lease = new CoordinatorLease({ assertTenantSyncAuthority() { checks++; return undefined; },
    inspectWriterAdmission: async () => f.engine.inspectAdmission(), releaseEntry() {} } as never, {} as never, null);
  try {
    f.write('admit'); const before = f.engine.receiptRetentionCounts();
    expect(await lease.trustedWriter.inspectAdmission!()).toEqual(f.engine.inspectAdmission());
    expect(checks).toBe(2); expect(f.engine.receiptRetentionCounts()).toEqual(before);
    lease.release(); await expect(lease.trustedWriter.inspectAdmission!()).rejects.toThrow();
  } finally { lease.release(); f.close(); }
});
