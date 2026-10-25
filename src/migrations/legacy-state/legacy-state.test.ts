import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrations, planLegacyStateMigration, stageLegacyStateMigration, verifyStagedLegacyStateMigration, type LegacyStateMigrationInput } from '../index';
import { fileSha256 } from './files';
import { fixture as makeFixture, appMigration, digest, syntheticAction, syntheticResume, syntheticRefresh } from './test-support';

const fixtures: Awaited<ReturnType<typeof makeFixture>>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.dispose(); });
async function fixture(options?: Parameters<typeof makeFixture>[0]) { const f = await makeFixture(options); fixtures.push(f); return f; }

test('stages lossless canonical identities, credentials, trusted roles, tokens, Storage and pending workflows', async () => {
  const f = await fixture();
  const before = readFileSync(f.sourcePath);
  const plan = await planLegacyStateMigration(f.input);
  expect(plan.systemMigrationVersions).toHaveLength(7);
  expect(plan.applicationMigrationVersions).toEqual([appMigration.version]);
  expect(plan.tables).toEqual(expect.arrayContaining([
    expect.objectContaining({ table: '_sync_mutation_receipts', owner: 'application-runtime', rows: 2 }),
    expect.objectContaining({ table: '_zero_sync_table_modes', owner: 'system', rows: 2 }),
  ]));
  expect(JSON.stringify(plan)).not.toContain(f.passwordHash);
  expect(JSON.stringify(plan)).not.toContain(digest(syntheticAction));
  const outputDirectory = join(f.root, 'generation');
  const staged = await stageLegacyStateMigration({ ...f.input, expectedPlanFingerprint: plan.fingerprint, outputDirectory, resetReactiveHistory: true });
  expect(await verifyStagedLegacyStateMigration({ ...f.input, expectedPlanFingerprint: plan.fingerprint, outputDirectory })).toEqual(staged);
  expect(readFileSync(f.sourcePath)).toEqual(before);
  const system = new Database(staged.systemDatabase.path, { readonly: true });
  const app = new Database(staged.applicationDatabase.path, { readonly: true, safeIntegers: true });
  try {
    expect(system.query("SELECT user_id,password_hash FROM _credentials WHERE user_id='legacy-user'").get()).toEqual({ user_id: 'legacy-user', password_hash: f.passwordHash });
    expect(await Bun.password.verify('Synthetic-only-password-123', (system.query('SELECT password_hash FROM _credentials').get() as any).password_hash)).toBe(true);
    expect(system.query('SELECT value FROM user_properties WHERE key=?').get('practice_role')).toEqual({ value: 'clinician' });
    expect(system.query("SELECT token_hash FROM _zero_action_tokens WHERE token_id='action-id'").get()).toEqual({ token_hash: digest(syntheticAction) });
    expect(system.query("SELECT token_hash FROM _zero_resume_tokens WHERE token_id='resume-id'").get()).toEqual({ token_hash: digest(syntheticResume) });
    expect(system.query('SELECT token_hash,session_id FROM _refresh_tokens').get()).toEqual({ token_hash: digest(syntheticRefresh), session_id: null });
    expect(system.query('SELECT object_id FROM storage_objects').get()).toEqual({ object_id: 'legacy-object' });
    expect(system.query('SELECT permission_id,grant_value FROM _storage_permissions').get()).toEqual({ permission_id: 'legacy-grant', grant_value: 'legacy-staff' });
    expect(system.query('SELECT instance_id,status FROM workflow_instances').get()).toEqual({ instance_id: 'legacy-run', status: 'running' });
    expect(system.query('SELECT step_id,wait_event FROM workflow_steps').get()).toEqual({ step_id: 'legacy-step', wait_event: 'approved' });
    expect(system.query('SELECT event_id FROM workflow_events').get()).toEqual({ event_id: 'legacy-history' });
    expect(system.query('SELECT generation FROM _auth_user_generations').get()).toEqual({ generation: 2 });
    expect(system.query('SELECT version FROM _migrations ORDER BY version DESC LIMIT 1').get()).toEqual({ version: migrations.at(-1)!.version });
    expect(system.query('SELECT 1 FROM _migrations WHERE version=?').get(appMigration.version)).toBeNull();
    expect(app.query('SELECT version FROM _migrations').all()).toEqual([{ version: appMigration.version }]);
    expect(app.query('SELECT user_id FROM users ORDER BY user_id').all()).toEqual([{ user_id: 'legacy-outsider' }, { user_id: 'legacy-staff' }, { user_id: 'legacy-user' }]);
    expect(app.query('PRAGMA table_info(users)').all().map((r: any) => r.name)).toEqual(['user_id']);
    expect(app.query('SELECT counter,body FROM patients').get()).toEqual({ counter: 9007199254740993n, body: new Uint8Array([0, 255, 0]) });
    expect(app.query("SELECT name FROM sqlite_schema WHERE name='_credentials' OR name='_changes'").all()).toEqual([]);
    expect(app.query('SELECT id FROM clinical_note_index').get()).toEqual({ id: 'legacy-note' });
    const source = new Database(f.sourcePath, { readonly: true, safeIntegers: true });
    try {
      expect(app.query('SELECT * FROM _sync_mutation_receipts ORDER BY principal,ref').all()).toEqual(source.query('SELECT * FROM _sync_mutation_receipts ORDER BY principal,ref').all());
      expect(system.query('SELECT * FROM _zero_sync_table_modes ORDER BY table_name').all()).toEqual(
        source.query('SELECT * FROM _zero_sync_table_modes ORDER BY table_name').all().map((row: any) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]))));
    } finally { source.close(); }
    expect(app.query('SELECT principal,ref,source_sha256 FROM _sync_legacy_mutation_receipt_bindings').all()).toEqual([
      { principal: 'user:legacy-user', ref: 'legacy-sync-ref', source_sha256: f.input.sourceSha256 },
    ]);
    expect(system.query("SELECT name FROM sqlite_schema WHERE name='_sync_mutation_receipts'").get()).toBeNull();
    expect(app.query("SELECT name FROM sqlite_schema WHERE name='_zero_sync_table_modes'").get()).toBeNull();
  } finally { system.close(); app.close(); }
  expect(staged.workflowRecovery).toBe('requires-reviewed-authority');
  expect(statSync(outputDirectory).mode & 0o777).toBe(0o700);
  for (const path of [staged.systemDatabase.path, staged.applicationDatabase.path, join(outputDirectory, 'staged.json')]) expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(plan).toEqual(await planLegacyStateMigration(f.input));
  await expect(stageLegacyStateMigration({ ...f.input, expectedPlanFingerprint: plan.fingerprint, outputDirectory, resetReactiveHistory: true })).rejects.toMatchObject({ code: 'LEGACY_STATE_DESTINATION_INVALID' });
});

test('rejects stale backup bytes, missing/unknown tables, unapproved checksums and unsafe source aliases', async () => {
  const f = await fixture();
  for (const invalid of [{ sourceSha256: 'a'.repeat(64) }, { applicationTables: ['patients'] },
    { applicationTables: ['patients', 'notes', 'unknown'] }, { applicationTables: ['patients', 'notes', 'users'] },
    { applicationTables: ['patients', 'notes', '_sync_mutation_receipts'] },
    { applicationTables: ['patients', 'notes', '_zero_sync_table_modes'] },
    { applicationMigrationChecksums: {} }, { applicationMigrationChecksums: { [appMigration.version]: 'a'.repeat(64) } },
    { offlineSource: false }]) await expect(planLegacyStateMigration({ ...f.input, ...invalid } as LegacyStateMigrationInput)).rejects.toBeDefined();
  const alias = join(f.root, 'alias.db'); symlinkSync(f.sourcePath, alias);
  await expect(planLegacyStateMigration({ ...f.input, sourcePath: alias })).rejects.toMatchObject({ code: 'LEGACY_STATE_SOURCE_INVALID' });
  writeFileSync(f.sourcePath + '-wal', 'synthetic-sidecar');
  await expect(planLegacyStateMigration(f.input)).rejects.toMatchObject({ code: 'LEGACY_STATE_SOURCE_INVALID' });
});

test('plan mismatch creates no output and a tampered staged generation is never repaired or accepted', async () => {
  const f = await fixture();
  const plan = await planLegacyStateMigration(f.input), outputDirectory = join(f.root, 'generation');
  await expect(stageLegacyStateMigration({ ...f.input, outputDirectory, expectedPlanFingerprint: 'a'.repeat(64), resetReactiveHistory: true })).rejects.toMatchObject({ code: 'LEGACY_STATE_PLAN_CHANGED' });
  expect(readdirSync(f.root)).not.toContain('generation');
  const staged = await stageLegacyStateMigration({ ...f.input, outputDirectory, expectedPlanFingerprint: plan.fingerprint, resetReactiveHistory: true });
  const db = new Database(staged.applicationDatabase.path); db.query('UPDATE notes SET text=?').run('Tampered'); db.close();
  await expect(verifyStagedLegacyStateMigration({ ...f.input, outputDirectory, expectedPlanFingerprint: plan.fingerprint })).rejects.toMatchObject({ code: 'LEGACY_STATE_PRESERVATION_FAILED' });
  // Replacing a receipt's byte hash does not defeat source-bound typed evidence.
  const receiptPath = join(outputDirectory, 'staged.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.applicationDatabase.sha256 = await fileSha256(staged.applicationDatabase.path);
  writeFileSync(receiptPath, JSON.stringify(receipt));
  await expect(verifyStagedLegacyStateMigration({ ...f.input, outputDirectory, expectedPlanFingerprint: plan.fingerprint })).rejects.toMatchObject({ code: 'LEGACY_STATE_PRESERVATION_FAILED' });
  expect(await fileSha256(f.sourcePath)).toBe(f.input.sourceSha256);
});

test('rejects changed canonical shapes, triggers, orphaned FKs and cross-owned ledger history', async () => {
  const f = await fixture();
  const corruptions = [
    { sql: 'ALTER TABLE users ADD COLUMN unreviewed_authority TEXT', code: 'LEGACY_STATE_SOURCE_UNSUPPORTED' },
    { sql: 'CREATE TRIGGER custom_authority AFTER UPDATE ON users BEGIN SELECT 1; END', code: 'LEGACY_STATE_SOURCE_UNSUPPORTED' },
    { sql: 'ALTER TABLE _sync_mutation_receipts ADD COLUMN unexpected TEXT', code: 'LEGACY_STATE_SOURCE_UNSUPPORTED' },
    { sql: 'CREATE TRIGGER custom_receipt AFTER INSERT ON _sync_mutation_receipts BEGIN SELECT 1; END', code: 'LEGACY_STATE_SOURCE_UNSUPPORTED' },
    { sql: 'ALTER TABLE _zero_sync_table_modes ADD COLUMN unexpected TEXT', code: 'LEGACY_STATE_SOURCE_UNSUPPORTED' },
    { sql: 'DROP TABLE _sync_mutation_receipts; CREATE TABLE _sync_mutation_receipts (principal TEXT NOT NULL, ref TEXT NOT NULL, request_hash TEXT NOT NULL, ack_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(ref,principal))', code: 'LEGACY_STATE_SOURCE_UNSUPPORTED' },
    { sql: "INSERT INTO notes VALUES ('orphan','missing','synthetic-only')", code: 'LEGACY_STATE_INTEGRITY_FAILED' },
    { sql: "UPDATE _migrations SET checksum='" + 'f'.repeat(64) + "' WHERE version='001'", code: 'LEGACY_STATE_LEDGER_INVALID' },
    { sql: "UPDATE _zero_schema_history SET migration_version='unapproved' WHERE migration_version='2026072901'", code: 'LEGACY_STATE_LEDGER_INVALID' },
  ];
  for (const [index, corruption] of corruptions.entries()) {
    const sourcePath = join(f.root, `bad-${index}.db`); copyFileSync(f.sourcePath, sourcePath);
    const db = new Database(sourcePath);
    try { db.exec(corruption.sql); } finally { db.close(); }
    const sourceSha256 = await fileSha256(sourcePath);
    await expect(planLegacyStateMigration({ ...f.input, sourcePath, sourceSha256 })).rejects.toMatchObject({ code: corruption.code });
    expect(await fileSha256(sourcePath)).toBe(sourceSha256);
  }
});

test('admits optional never-created runtime tables and the real-source empty-receipt shape without relabeling', async () => {
  for (const options of [{ runtimeTables: false }, { populatedReceipts: false }]) {
    const f = await fixture(options), plan = await planLegacyStateMigration(f.input);
    const receipt = plan.tables.find(table => table.table === '_sync_mutation_receipts');
    expect(receipt?.owner).toBe(options.runtimeTables === false ? undefined : 'application-runtime');
    expect(receipt?.rows).toBe(options.runtimeTables === false ? undefined : 0);
    const operation = { ...f.input, expectedPlanFingerprint: plan.fingerprint, outputDirectory: join(f.root, 'empty-runtime'), resetReactiveHistory: true as const };
    const staged = await stageLegacyStateMigration(operation);
    expect(await verifyStagedLegacyStateMigration(operation)).toEqual(staged);
  }
}, 60_000);

test('tampered legacy replay bindings cannot pass verification even if the archive receipt is rehashed', async () => {
  const f = await fixture(), plan = await planLegacyStateMigration(f.input);
  const operation = { ...f.input, expectedPlanFingerprint: plan.fingerprint, outputDirectory: join(f.root, 'bindings'), resetReactiveHistory: true as const };
  const staged = await stageLegacyStateMigration(operation);
  const db = new Database(staged.applicationDatabase.path);
  try { db.query('UPDATE _sync_legacy_mutation_receipt_bindings SET source_sha256=?').run('f'.repeat(64)); } finally { db.close(); }
  const path = join(operation.outputDirectory, 'staged.json'), receipt = JSON.parse(readFileSync(path, 'utf8'));
  receipt.applicationDatabase.sha256 = await fileSha256(staged.applicationDatabase.path);
  writeFileSync(path, JSON.stringify(receipt));
  await expect(verifyStagedLegacyStateMigration(operation)).rejects.toMatchObject({ code: 'LEGACY_STATE_PRESERVATION_FAILED' });
}, 60_000);

test('failed app-view conversion retains a private rejected generation and cannot be resumed or accepted', async () => {
  const f = await fixture(), db = new Database(f.sourcePath);
  try { db.exec('CREATE VIEW unsupported_profile_projection AS SELECT email FROM users'); } finally { db.close(); }
  const input = { ...f.input, sourceSha256: await fileSha256(f.sourcePath) };
  const plan = await planLegacyStateMigration(input), outputDirectory = join(f.root, 'rejected');
  const operation = { ...input, expectedPlanFingerprint: plan.fingerprint, outputDirectory, resetReactiveHistory: true as const };
  await expect(stageLegacyStateMigration(operation)).rejects.toMatchObject({ code: 'LEGACY_STATE_STAGE_FAILED', phase: 'verify-split' });
  expect(existsSync(join(outputDirectory, 'failed.json'))).toBe(true);
  expect(existsSync(join(outputDirectory, 'staged.json'))).toBe(false);
  await expect(verifyStagedLegacyStateMigration(operation)).rejects.toMatchObject({ code: 'LEGACY_STATE_MANIFEST_INVALID' });
  await expect(stageLegacyStateMigration(operation)).rejects.toMatchObject({ code: 'LEGACY_STATE_DESTINATION_INVALID' });
  expect(await fileSha256(f.sourcePath)).toBe(input.sourceSha256);
});

test('terminal workflow history does not require a fabricated resumption permission', async () => {
  const f = await fixture(), db = new Database(f.sourcePath);
  const completed = new Date().toISOString();
  try {
    db.query("UPDATE workflow_instances SET status='completed', current_step=1, completed_at=?").run(completed);
    db.query("UPDATE workflow_steps SET status='completed', started_at=?, completed_at=?").run(completed, completed);
  } finally { db.close(); }
  const input = { ...f.input, sourceSha256: await fileSha256(f.sourcePath) }, plan = await planLegacyStateMigration(input);
  expect(plan.pendingWorkflowCount).toBe(0);
  const operation = { ...input, expectedPlanFingerprint: plan.fingerprint, outputDirectory: join(f.root, 'terminal'), resetReactiveHistory: true as const };
  const staged = await stageLegacyStateMigration(operation);
  expect(staged.workflowRecovery).toBe('no-pending-work');
  expect(await verifyStagedLegacyStateMigration(operation)).toEqual(staged);
});
