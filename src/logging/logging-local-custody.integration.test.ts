/** Disposable, real private Fabric actors. No external custody service or application credentials. */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFile, mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDatabaseFile } from '../databases/database-file';
import { MemoryEventStore } from '../observability/memory-event-store';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from './logging-managed-config';
import { LoggingRuntime } from './logging-runtime';
import { loggingEvent } from './test-support/logging-fixture';
import { openLocalLoggingIdentity } from './logging-local-identity';

function config(root: string, adoptExisting = false, keyId?: string): ResolvedManagedLoggingConfig {
  return resolveManagedLoggingConfig({ preset: 'activity', rootDirectory: root, custody: { kind: 'local', adoptExisting, keyId } }, root) as ResolvedManagedLoggingConfig;
}
function fallback() { const store = new MemoryEventStore(); return { sink: store, store, config: { console: false } }; }

test('self-contained signing and a separate Fabric checkpoint database survive restart and reject content edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-local-checkpoint-')); let runtime: LoggingRuntime | undefined;
  try {
    runtime = await LoggingRuntime.open(config(root), fallback());
    await runtime.deliver(loggingEvent('immutable-local'));
    expect(runtime.diagnostics()).toMatchObject({ custody: { state: 'ready' }, databases: { files: 3 } });
    await runtime.close();
    const identity = await readFile(join(root, 'identity/signing.json'), 'utf8');
    expect((await stat(join(root, 'identity/signing.json'))).mode & 0o777).toBe(0o600);
    const audit = new Database(resolveDatabaseFile(root, 'logging:audit').path);
    try {
      expect(() => audit.run("UPDATE logging_events SET action='changed'")).toThrow('immutable');
      expect(() => audit.run("DELETE FROM logging_proofs")).toThrow('retained');
    } finally { audit.close(); }
    const checkpoints = new Database(resolveDatabaseFile(root, 'logging:checkpoints').path);
    try {
      expect(checkpoints.query('SELECT COUNT(*) AS n FROM logging_checkpoints').get()).toEqual({ n: 2 });
      expect(() => checkpoints.run("UPDATE logging_checkpoints SET hash='changed'")).toThrow('append-only');
      expect(() => checkpoints.run('DELETE FROM logging_checkpoints')).toThrow('append-only');
      expect(checkpoints.query('SELECT COUNT(*) AS n FROM logging_events').get()).toEqual({ n: 0 });
    } finally { checkpoints.close(); }
    runtime = await LoggingRuntime.open(config(root), fallback());
    expect((await runtime.page('audit', { kind: 'platform' })).events[0]?.event.id).toBe('immutable-local');
    expect(await readFile(join(root, 'identity/signing.json'), 'utf8')).toBe(identity);
    await runtime.close();
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('built-in key rotation retains old verification keys and a deleted checkpoint database is not recreated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-local-rotation-')); let runtime: LoggingRuntime | undefined;
  try {
    runtime = await LoggingRuntime.open(config(root, false, 'first-signing-key'), fallback());
    await runtime.deliver(loggingEvent('before-rotation')); await runtime.close();
    runtime = await LoggingRuntime.open(config(root, false, 'second-signing-key'), fallback());
    await runtime.deliver(loggingEvent('after-rotation')); await runtime.close();
    const value = JSON.parse(await readFile(join(root, 'identity/signing.json'), 'utf8'));
    expect(value.keyId).toBe('second-signing-key');
    expect(Object.keys(value.publicKeys).sort()).toEqual(['first-signing-key', 'second-signing-key']);
    const path = resolveDatabaseFile(root, 'logging:checkpoints').path;
    // A standalone closed WAL connection may need to recreate SQLite sidecars.
    // The test performs SELECT only; production readers remain Fabric-owned.
    const db = new Database(path, { readwrite: true, create: false });
    try {
      const rows = db.query<{ envelope: string }, []>('SELECT envelope FROM logging_checkpoints ORDER BY position').all();
      expect(rows.map(r => JSON.parse(r.envelope).keyId)).toEqual(['first-signing-key', 'first-signing-key', 'second-signing-key', 'second-signing-key']);
    } finally { db.close(); }
    await expect(LoggingRuntime.open(config(root, false, 'first-signing-key'), fallback())).rejects.toMatchObject({ code: 'LOGGING_CONFIG_INVALID' });
    await unlink(path);
    await expect(LoggingRuntime.open(config(root, true), fallback())).rejects.toMatchObject({ code: 'LOGGING_INTEGRITY_FAILED' });
    expect(await Bun.file(path).exists()).toBe(false);
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('startup verification checks historical pages, not just the first page and newest checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-local-historical-tamper-')); let runtime: LoggingRuntime | undefined;
  try {
    runtime = await LoggingRuntime.open(config(root), fallback());
    await Promise.all(Array.from({ length: 205 }, (_, i) => runtime!.deliver(loggingEvent('historic-' + i))));
    await runtime.close();
    const audit = new Database(resolveDatabaseFile(root, 'logging:audit').path);
    try {
      audit.run('DROP TRIGGER logging_event_no_update');
      audit.run("UPDATE logging_events SET envelope=replace(envelope,'record.read','record.fake') WHERE ordinal=150");
    } finally { audit.close(); }
    await expect(LoggingRuntime.open(config(root), fallback())).rejects.toThrow();
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('older event-database restores fail against retained checkpoints instead of blessing a rewritten history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-local-rollback-')); let runtime: LoggingRuntime | undefined;
  try {
    runtime = await LoggingRuntime.open(config(root), fallback());
    await runtime.deliver(loggingEvent('old-event')); await runtime.close();
    const path = resolveDatabaseFile(root, 'logging:audit').path, backup = join(root, 'disposable-old-audit.backup');
    await copyFile(path, backup);
    runtime = await LoggingRuntime.open(config(root), fallback());
    await runtime.deliver(loggingEvent('new-event')); await runtime.close();
    await copyFile(backup, path);
    await expect(LoggingRuntime.open(config(root), fallback())).rejects.toThrow();
    const checkpoints = new Database(resolveDatabaseFile(root, 'logging:checkpoints').path, { readwrite: true, create: false });
    try { expect(checkpoints.query<{ ordinal: number }, []>('SELECT ordinal FROM logging_checkpoints ORDER BY position DESC LIMIT 1').get()!.ordinal).toBe(2); }
    finally { checkpoints.close(); }
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('missing signing identity cannot regenerate over existing signed evidence, even with adoption requested', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-local-key-loss-')); let runtime: LoggingRuntime | undefined;
  try {
    runtime = await LoggingRuntime.open(config(root), fallback());
    await runtime.deliver(loggingEvent('must-remain-signed')); await runtime.close();
    await unlink(join(root, 'identity/signing.json'));
    for (const adopt of [false, true]) {
      await expect(LoggingRuntime.open(config(root, adopt), fallback())).rejects.toMatchObject({ code: 'LOGGING_INTEGRITY_FAILED' });
      expect(await Bun.file(join(root, 'identity/signing.json')).exists()).toBe(false);
    }
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('local adoption is explicit for an existing unsigned trail and does not turn into a repair mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-local-adoption-')); let runtime: LoggingRuntime | undefined;
  try {
    const unsigned = resolveManagedLoggingConfig({ preset: 'activity', rootDirectory: root }, root) as ResolvedManagedLoggingConfig;
    runtime = await LoggingRuntime.open(unsigned, fallback()); await runtime.deliver(loggingEvent('unsigned-old')); await runtime.close();
    await expect(openLocalLoggingIdentity(root, false)).rejects.toMatchObject({ code: 'LOGGING_NOT_READY' });
    runtime = await LoggingRuntime.open(config(root, true), fallback());
    expect(runtime.diagnostics().custody?.state).toBe('ready');
    await runtime.close();
    const audit = new Database(resolveDatabaseFile(root, 'logging:audit').path);
    try {
      audit.run('DROP TRIGGER logging_event_no_update');
      audit.run("UPDATE logging_events SET envelope=replace(envelope,'record.read','record.fake')");
    } finally { audit.close(); }
    await expect(LoggingRuntime.open(config(root, true), fallback())).rejects.toThrow();
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
