import { Database, constants } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from '../auth/auth-schema';
import { normalizeAuthUserProfile } from '../auth/auth-config-user-profile';
import { reconcileUserAvatarSchema } from '../auth/auth-user-avatar-schema';
import { profileCompletionPolicyFingerprint } from '../auth/auth-user-profile-completion-policy';
import { reconcileUserProfilePolicy } from '../auth/auth-user-profile-policy';
import { UserStore } from '../auth/user-store';
import { reconcilePresenceSystemSchema } from '../presence/presence-schema';
import { admitPinnedPresenceProjection } from '../presence/presence-projection-schema';
import { guardianPresenceRealmContribution } from '../presence/presence-realm';
import { composeDatabaseRealm, defineDatabaseRealm } from '../databases';
import type { AuthBehaviorConfig } from '../auth/types';
import { runPlatformDoctor } from './platform-doctor';
import { createPlatformSQLiteService, type PlatformSQLiteService } from '../persistence';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) {
  if (!basename(root).startsWith('zero-guardian-doctor-')) throw new Error('Invalid synthetic fixture root');
  rmSync(root, { recursive: true, force: true });
} });
const policy = { fields: { firstName: { required: true } }, contacts: { enabled: true },
  avatars: { enabled: true }, completion: { enabled: true } } as const;
function report(system: PlatformSQLiteService, auth: AuthBehaviorConfig, application?: Database) {
  return runPlatformDoctor({ db: application ? { database: application } : { mode: 'memory' },
    systemDb: { sqlite: system }, tables: {}, auth, email: false, migrate: false },
  { env: {}, projectRoot: '/synthetic-unused-doctor-root', usageAudit: false });
}
function codes(value: ReturnType<typeof runPlatformDoctor>) { return value.findings.map(item => item.code); }
function snapshot(db: Database) { return { schema: db.query('SELECT type,name,sql FROM sqlite_master ORDER BY name').all(),
  changes: db.query('SELECT total_changes() AS count').get() }; }

describe('read-only desired/installed Guardian feature diagnostics', () => {
  test('enabled missing SYSTEM substrates are reported without installing tables or a policy marker', () => {
    const sql = createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false });
    const system = sql.raw, app = new Database(':memory:');
    try {
      const before = snapshot(system), appBefore = snapshot(app);
      const result = report(sql, { userProfile: policy, presence: { enabled: true } }, app);
      expect(codes(result)).toContain('auth.user_profile.profile.schema_missing');
      expect(codes(result)).toContain('auth.user_profile.contacts.schema_missing');
      expect(codes(result)).toContain('auth.user_profile.avatars.schema_missing');
      expect(codes(result)).toContain('auth.user_profile.completion.schema_missing');
      expect(codes(result)).toContain('auth.presence.schema_unready');
      expect(codes(result)).toContain('auth.presence.application_unready');
      expect(snapshot(system)).toEqual(before); expect(snapshot(app)).toEqual(appBefore);
    } finally { app.close(); sql.close(); }
  });
  test('installed schema admission is distinguished from unreconciled completion policy', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db); reconcileUserAvatarSchema(db, true);
      const before = snapshot(db.getRawDatabase());
      const result = report(db.getSQLiteService()!, { userProfile: policy });
      expect(codes(result)).toContain('auth.user_profile.profile.schema_ready');
      expect(codes(result)).toContain('auth.user_profile.profile.policy_pending');
      expect(codes(result)).toContain('auth.user_profile.contacts.schema_ready');
      expect(codes(result)).toContain('auth.user_profile.avatars.schema_ready');
      expect(codes(result)).toContain('auth.user_profile.completion.schema_ready');
      expect(codes(result)).toContain('auth.user_profile.completion.policy_pending');
      expect(codes(result)).toContain('auth.user_profile.avatars.storage_missing');
      expect(snapshot(db.getRawDatabase())).toEqual(before);
    } finally { db.dispose(); }
  });
  test('profile policy generation is inspected read-only, including semantic drift and malformed retained clocks', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db); reconcileUserProfilePolicy(db, new UserStore(db), normalizeAuthUserProfile());
      let before = snapshot(db.getRawDatabase());
      expect(codes(report(db.getSQLiteService()!, {}))).not.toContain('auth.user_profile.profile.policy_pending');
      expect(snapshot(db.getRawDatabase())).toEqual(before);
      expect(codes(report(db.getSQLiteService()!, { userProfile: { fields: { bio: true } } })))
        .toContain('auth.user_profile.profile.policy_pending');
      expect(snapshot(db.getRawDatabase())).toEqual(before);
      db.prepare('UPDATE _auth_user_profile_policy SET generation=1.5').run();
      before = snapshot(db.getRawDatabase());
      expect(codes(report(db.getSQLiteService()!, {}))).toContain('auth.user_profile.profile.policy_invalid');
      expect(snapshot(db.getRawDatabase())).toEqual(before);
    } finally { db.dispose(); }
  });
  test('colliding exact objects fail clearly without revealing schema SQL or stored values', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db); db.exec('DROP TABLE _auth_user_profiles');
      db.exec('CREATE TABLE _auth_user_profiles (private_company_value TEXT)');
      db.prepare('INSERT INTO _auth_user_profiles VALUES (?)').run('synthetic-private-value');
      const before = snapshot(db.getRawDatabase());
      const result = report(db.getSQLiteService()!, { userProfile: policy });
      expect(codes(result)).toContain('auth.user_profile.profile.schema_invalid');
      expect(JSON.stringify(result)).not.toContain('synthetic-private-value');
      expect(JSON.stringify(result)).not.toContain('private_company_value');
      expect(snapshot(db.getRawDatabase())).toEqual(before);
    } finally { db.dispose(); }
  });
  test('avatar readiness requires a private global namespace, not just the migration tables', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db); reconcileUserAvatarSchema(db, true);
      db.exec('CREATE TABLE storage_drives (drive_id TEXT PRIMARY KEY, public INTEGER, tenant_id TEXT, owner_id TEXT)');
      db.exec("INSERT INTO storage_drives VALUES ('synthetic-private-drive',0,NULL,NULL)");
      db.exec("INSERT INTO _auth_avatar_namespace VALUES (1,'synthetic-private-drive')");
      let before = snapshot(db.getRawDatabase());
      const ready = report(db.getSQLiteService()!, { userProfile: policy });
      expect(codes(ready)).toContain('auth.user_profile.avatars.namespace_ready');
      expect(snapshot(db.getRawDatabase())).toEqual(before);
      db.exec("UPDATE storage_drives SET public=1,tenant_id='synthetic-private-tenant'");
      before = snapshot(db.getRawDatabase());
      const invalid = report(db.getSQLiteService()!, { userProfile: policy });
      expect(codes(invalid)).toContain('auth.user_profile.avatars.namespace_invalid');
      expect(JSON.stringify(invalid)).not.toContain('synthetic-private-tenant');
      expect(snapshot(db.getRawDatabase())).toEqual(before);
    } finally { db.dispose(); }
  });
  test('exact presence SYSTEM and pinned app schemas are inspected independently without owner takeover', () => {
    const system = createReactiveDB({ mode: 'memory' }), app = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(system); reconcilePresenceSystemSchema(system, true); admitPinnedPresenceProjection(app, true);
      const before = snapshot(system.getRawDatabase()), appBefore = snapshot(app.getRawDatabase());
      const result = report(system.getSQLiteService()!, { userProfile: { enabled: false }, presence: { enabled: true } }, app.getRawDatabase());
      expect(codes(result)).toContain('auth.presence.schema_ready');
      expect(codes(result)).toContain('auth.presence.application_ready');
      expect(codes(result)).not.toContain('auth.user_profile.profile.schema_ready');
      expect(snapshot(system.getRawDatabase())).toEqual(before); expect(snapshot(app.getRawDatabase())).toEqual(appBefore);
      expect(system.prepare('SELECT COUNT(*) AS count FROM _guardian_presence_authority').get()).toEqual({ count: 0 });
    } finally { app.dispose(); system.dispose(); }
  });
  test('physical tenant presence requires the exact realm contribution but does not open tenant files', () => {
    const base = { db: { mode: 'memory' as const }, tables: {}, auth: { tenancy: 'multi' as const, presence: { enabled: true } }, email: false as const };
    const topology = { mode: 'multiple' as const, tenantIsolation: 'tenant-database' as const,
      rootDirectory: '/synthetic-unused-presence-tenants', actors: { launch: { kind: 'source' as const, entrypoint: import.meta.path } } };
    const absent = runPlatformDoctor({ ...base, databaseTopology: { ...topology,
      realm: defineDatabaseRealm({ name: 'doctor-no-presence', version: '1', tables: {} }) } }, { env: {}, usageAudit: false });
    expect(codes(absent)).toContain('auth.presence.realm_missing');
    const ready = runPlatformDoctor({ ...base, databaseTopology: { ...topology,
      realm: composeDatabaseRealm({ name: 'doctor-presence', version: '1', contributions: [guardianPresenceRealmContribution()] }) } },
    { env: {}, usageAudit: false });
    expect(codes(ready)).not.toContain('auth.presence.realm_missing');
    expect(codes(ready)).not.toContain('auth.presence.schema_ready');
  });
  test('disabled features do not report retained feature tables and configured adapters are never called', () => {
    const sql = createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false }); let calls = 0;
    const callback = () => { calls++; throw new Error('Doctor must not call an external adapter'); };
    try {
      const disabled = report(sql, { userProfile: { enabled: false, contacts: { enabled: true }, avatars: { enabled: true }, completion: { enabled: true } } });
      expect(codes(disabled).filter(code => code.startsWith('auth.user_profile.'))).toEqual([]);
      const result = runPlatformDoctor({ db: { mode: 'memory' }, systemDb: { sqlite: sql }, tables: {}, email: false,
        auth: { userProfile: { contacts: { enabled: true, email: { verify: true }, phone: { enabled: true, verify: true } } },
          phoneVerificationAdapter: { id: 'synthetic-doctor-adapter', isReady: callback, start: callback, verify: callback, cancel: callback } } },
      { env: {}, projectRoot: '/synthetic-unused-doctor-root', usageAudit: false });
      expect(codes(result)).toContain('auth.user_profile.contacts.email_delivery_unconfigured');
      expect(codes(result)).not.toContain('auth.user_profile.contacts.phone_adapter_unconfigured');
      expect(calls).toBe(0);
    } finally { sql.close(); }
  });
  test('existing file inspection leaves bytes/schema/rows unchanged and contains policy-marker corruption', async () => {
    const { root, path } = await createAuthFile(true);
    // The test owns this closed rollback-journal image explicitly. Readability
    // must not depend on schema statements delaying a WAL writer's final close.
    const writer = new Database(path, { readwrite: true });
    writer.run('PRAGMA journal_mode=DELETE');
    const beforeState = snapshot(writer);
    writer.close(true);
    const before = await Bun.file(path).arrayBuffer();
    const result = runPlatformDoctor({ db: { mode: 'memory' }, systemDb: { mode: 'file', path }, tables: {},
      auth: { userProfile: policy }, email: false, migrate: false }, { env: {}, projectRoot: root, usageAudit: false });
    expect(codes(result)).toContain('auth.user_profile.completion.schema_ready');
    expect(codes(result)).not.toContain('auth.user_profile.completion.policy_pending');
    expect(await Bun.file(path).arrayBuffer()).toEqual(before);
    const reader = new Database(path, { readonly: true });
    try { expect(snapshot(reader)).toEqual(beforeState); } finally { reader.close(true); }
    const raw = new Database(path);
    try { raw.run('UPDATE _auth_profile_completion_policy SET policy_fingerprint=?', ['x'.repeat(64)]); }
    finally { raw.close(true); }
    const corruptedBytes = await Bun.file(path).arrayBuffer();
    const corrupt = runPlatformDoctor({ db: { mode: 'memory' }, systemDb: { mode: 'file', path }, tables: {},
      auth: { userProfile: policy }, email: false }, { env: {}, projectRoot: root, usageAudit: false });
    expect(codes(corrupt)).toContain('auth.user_profile.completion.policy_invalid');
    expect(await Bun.file(path).arrayBuffer()).toEqual(corruptedBytes);
  });

  test('active WAL inspection sees committed policy state without changing main or WAL bytes', async () => {
    const { root, path } = await createAuthFile(false);
    const writer = new Database(path, { readwrite: true });
    try {
      writer.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
      writer.run('PRAGMA journal_mode=WAL');
      const initialMain = await Bun.file(path).arrayBuffer();
      writer.run('INSERT INTO _auth_profile_completion_policy(singleton,policy_fingerprint,updated_at) VALUES (1,?,1)',
        [profileCompletionPolicyFingerprint(normalizeAuthUserProfile(policy))]);
      const beforeMain = await Bun.file(path).arrayBuffer();
      const beforeWal = await Bun.file(`${path}-wal`).arrayBuffer();
      const beforeState = snapshot(writer);
      expect(beforeMain).toEqual(initialMain);
      expect(beforeWal.byteLength).toBeGreaterThan(0);

      const result = runPlatformDoctor({ db: { mode: 'memory' }, systemDb: { mode: 'file', path }, tables: {},
        auth: { userProfile: policy }, email: false, migrate: false }, { env: {}, projectRoot: root, usageAudit: false });
      expect(codes(result)).toContain('auth.user_profile.completion.schema_ready');
      // The marker was written only into WAL, so a main-file-only copy would
      // incorrectly report policy_pending and fail this assertion.
      expect(codes(result)).not.toContain('auth.user_profile.completion.policy_pending');
      expect(codes(result)).not.toContain('database.system.file_inspection_unavailable');
      expect(await Bun.file(path).arrayBuffer()).toEqual(beforeMain);
      expect(await Bun.file(`${path}-wal`).arrayBuffer()).toEqual(beforeWal);
      expect(snapshot(writer)).toEqual(beforeState);
    } finally { writer.close(true); }
  });

  test('missing WAL sidecars follow actual native readonly admission without false-ready findings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-guardian-doctor-')); roots.push(root);
    const path = join(root, 'native.db');
    const writer = new Database(path, { create: true, readwrite: true });
    try {
      writer.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
      writer.run('PRAGMA journal_mode=WAL');
      writer.run('CREATE TABLE native_marker(id INTEGER PRIMARY KEY, value TEXT)');
      writer.run('INSERT INTO native_marker VALUES (1, ?)', ['synthetic-committed']);
      writer.run('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally { writer.close(true); }
    expect(await Bun.file(`${path}-wal`).exists()).toBe(false);
    expect(await Bun.file(`${path}-shm`).exists()).toBe(false);
    const before = await Bun.file(path).arrayBuffer();
    let available = false;
    let reader: Database | null = null;
    try {
      reader = new Database(path, { readonly: true });
      expect(reader.query('SELECT value FROM native_marker WHERE id=1').get())
        .toEqual({ value: 'synthetic-committed' });
      available = true;
    } catch (error) {
      // This is the native availability boundary, not a waived Doctor failure:
      // unsupported closed-WAL reopening must yield no invented schema state.
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      expect(code).toMatch(/^SQLITE_(?:CANTOPEN|READONLY)(?:_|$)/);
    } finally { reader?.close(true); }
    const result = runPlatformDoctor({ db: { mode: 'memory' }, systemDb: { mode: 'file', path }, tables: {},
      auth: { userProfile: policy }, email: false, migrate: false },
    { env: {}, projectRoot: root, usageAudit: false });
    if (available) {
      expect(codes(result)).not.toContain('database.system.file_inspection_unavailable');
      expect(codes(result)).toContain('auth.authority_revision.schema_missing');
      expect(codes(result)).toContain('auth.user_profile.profile.schema_missing');
    } else {
      expect(result.findings).toContainEqual(expect.objectContaining({
        code: 'database.system.file_inspection_unavailable', severity: 'warning', path: 'systemDb',
      }));
      expect(codes(result).filter(code => code.endsWith('.schema_ready'))).toEqual([]);
      expect(codes(result).filter(code => code.startsWith('auth.user_profile.')
        && (code.includes('.schema_') || code.includes('.policy_')))).toEqual([]);
      expect(codes(result)).not.toContain('auth.authority_revision.schema_missing');
    }
    expect(await Bun.file(path).arrayBuffer()).toEqual(before);
  });
});

/** Produce a complete fixture image, not a copy of a changing file/WAL pair. */
async function createAuthFile(withMarker: boolean): Promise<{ root: string; path: string }> {
  const root = mkdtempSync(join(tmpdir(), 'zero-guardian-doctor-')); roots.push(root);
  const path = join(root, 'system.db');
  const memory = createReactiveDB({ mode: 'memory', emitTelemetry: false });
  try {
    defineAuthTables(memory);
    if (withMarker) {
      const marker = memory.prepare('INSERT INTO _auth_profile_completion_policy(singleton,policy_fingerprint,updated_at) VALUES (1,?,1)');
      try { marker.run(profileCompletionPolicyFingerprint(normalizeAuthUserProfile(policy))); }
      finally { marker.finalize(); }
    }
    await Bun.write(path, memory.getRawDatabase().serialize());
  } finally { memory.dispose(); }
  return { root, path };
}
