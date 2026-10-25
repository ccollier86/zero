/** Offline staging only. Framework-owned SQL never escapes as an app import requirement. */
import { Database } from 'bun:sqlite';
import { chmodSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Migrator, migrations, hashMigration } from '../index';
import { LEGACY_LEDGER_TABLES } from './catalog';
import { LegacyStateMigrationError, failLegacyState, type LegacyStateMigrationPhase, type LegacyStateMigrationPlan, type StageLegacyStateMigrationInput, type StagedLegacyStateMigration } from './contracts';
import { assertLegacyIntegrity, closeLegacyRead, legacyRowsEvidence, legacySchemaSha256, openLegacyRead, quoteLegacyIdentifier as q } from './evidence';
import { canonicalDirectory, copyPrivateFile, createGeneration, exists, fileSha256, readPrivateJson, sourceFile, syncPrivatePath, writePrivateJson } from './files';
import { planLegacyStateMigration } from './inspect';
import { hasTable, partitionLegacyLedgers } from './ledger';
import { bindLegacyMutationReceipts, verifyLegacyMutationReceiptBindings } from './runtime-state';

export async function stageLegacyStateMigration(input: StageLegacyStateMigrationInput): Promise<StagedLegacyStateMigration> {
  let created = false;
  let phase: LegacyStateMigrationPhase = 'plan';
  try {
    if (input?.resetReactiveHistory !== true) failLegacyState('LEGACY_STATE_INPUT_INVALID');
    const plan = await planLegacyStateMigration(input);
    if (plan.fingerprint !== input.expectedPlanFingerprint) failLegacyState('LEGACY_STATE_PLAN_CHANGED');
    await createGeneration(input.outputDirectory, input.sourcePath); created = true;
    await writePrivateJson(join(input.outputDirectory, 'plan.json'), plan);
    phase = 'copy';
    const systemPath = join(input.outputDirectory, 'system.db'), systemWork = join(input.outputDirectory, 'system.work.db');
    const appPath = join(input.outputDirectory, 'application.db'), appWork = join(input.outputDirectory, 'application.work.db');
    for (const destination of [systemWork, appWork]) {
      await copyPrivateFile(input.sourcePath, destination);
      if (await fileSha256(destination) !== plan.sourceSha256) failLegacyState('LEGACY_STATE_SOURCE_CHANGED');
    }
    if (await fileSha256(sourceFile(input.sourcePath)) !== plan.sourceSha256) failLegacyState('LEGACY_STATE_SOURCE_CHANGED');
    phase = 'partition-system'; partitionGeneration(systemWork, plan, 'system');
    phase = 'partition-application'; partitionGeneration(appWork, plan, 'application');
    // Verify the lossless split before advancing any canonical system schema.
    phase = 'verify-split'; verifyPartition(input.sourcePath, systemWork, plan, 'system', true);
    verifyPartition(input.sourcePath, appWork, plan, 'application', true);

    const backupDir = join(input.outputDirectory, 'system-migration-backups');
    await mkdir(backupDir, { mode: 0o700 });
    const system = new Database(systemWork, { strict: true, create: false });
    try {
      phase = 'upgrade-system';
      system.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      const migrator = new Migrator({ database: system, dbPath: systemWork, ownsDatabase: false,
        migrations, backupDir, createBackups: true, applyPragmas: false, log() {} });
      try { migrator.run(); } finally { migrator.dispose(); }
      // Preserve original statuses/history verbatim, but never invent actor
      // permissions or silently fail old runs during ordinary managed recovery.
      system.exec(`CREATE TABLE _workflow_legacy_migration_holds (instance_id TEXT PRIMARY KEY,
        plan_fingerprint TEXT NOT NULL, source_sha256 TEXT NOT NULL)`);
      system.query(`INSERT INTO _workflow_legacy_migration_holds SELECT instance_id,?,?
        FROM workflow_instances WHERE status NOT IN ('completed','failed','cancelled')`).run(plan.fingerprint, plan.sourceSha256);
      phase = 'snapshot';
      const checkpoint = system.query('PRAGMA wal_checkpoint(TRUNCATE)').all()[0] as { busy: number };
      if (checkpoint.busy !== 0) failLegacyState('LEGACY_STATE_STAGE_FAILED');
      system.run('VACUUM INTO ?', [systemPath]);
      chmodSync(systemPath, 0o600);
    } finally { system.close(); }
    const application = new Database(appWork, { strict: true, create: false });
    try { application.run('VACUUM INTO ?', [appPath]); chmodSync(appPath, 0o600); }
    finally { application.close(); }
    // Added columns/derived workflow pins are allowed; original values/IDs are not changed.
    phase = 'verify-upgrade'; verifyPartition(input.sourcePath, systemPath, plan, 'system', false);
    verifyPartition(input.sourcePath, appPath, plan, 'application', true);
    if (await fileSha256(sourceFile(input.sourcePath)) !== plan.sourceSha256) failLegacyState('LEGACY_STATE_SOURCE_CHANGED');
    const staged: StagedLegacyStateMigration = {
      version: 1, kind: 'zero.legacy-state-staged', planFingerprint: plan.fingerprint, sourceSha256: plan.sourceSha256,
      systemDatabase: { path: systemPath, sha256: await fileSha256(systemPath) },
      applicationDatabase: { path: appPath, sha256: await fileSha256(appPath) }, requiresApplicationAcceptance: true,
      workflowRecovery: plan.pendingWorkflowCount ? 'requires-reviewed-authority' : 'no-pending-work',
    };
    phase = 'manifest';
    await syncPrivatePath(systemPath); await syncPrivatePath(appPath);
    await writePrivateJson(join(input.outputDirectory, 'staged.json'), staged);
    await syncPrivatePath(input.outputDirectory);
    return Object.freeze(staged);
  } catch (error) {
    const safe = new LegacyStateMigrationError(error instanceof LegacyStateMigrationError ? error.code : 'LEGACY_STATE_STAGE_FAILED', phase);
    if (created) {
      try { await writePrivateJson(join(input.outputDirectory, 'failed.json'), { version: 1, code: safe.code, phase: safe.phase }); } catch { /* Preserve the primary error; never reuse this directory. */ }
    }
    throw safe;
  }
}

function partitionGeneration(path: string, plan: LegacyStateMigrationPlan, plane: 'system' | 'application'): void {
  const db = new Database(path, { strict: true, create: false });
  try {
    // Only brand-new output clones. FK actions must not delete clinical rows
    // while full canonical tables are replaced with referential-only anchors.
    db.exec('PRAGMA foreign_keys=OFF; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
    db.transaction(() => {
      if (plane === 'system') for (const view of plan.applicationViews) db.exec(`DROP VIEW ${q(view)}`);
      else db.exec('CREATE TEMP TABLE legacy_user_ids AS SELECT user_id FROM users');
      for (const table of plan.tables) {
        const belongs = table.owner === plane || (plane === 'application' && table.owner === 'application-runtime');
        if (table.owner === 'derived' || (table.owner !== 'ledger' && !belongs)) db.exec(`DROP TABLE ${q(table.table)}`);
      }
      partitionLegacyLedgers(db, plane === 'system' ? plan.systemMigrationVersions : plan.applicationMigrationVersions);
      if (plane === 'application') {
        db.exec('CREATE TABLE users (user_id TEXT PRIMARY KEY); INSERT INTO users(user_id) SELECT user_id FROM temp.legacy_user_ids; DROP TABLE temp.legacy_user_ids;');
        bindLegacyMutationReceipts(db, plan);
      }
    })();
    // Purge removed canonical/clinical bytes from output free pages; the exact
    // full source backup is deliberately retained independently.
    db.exec('VACUUM');
    const checkpoint = db.query('PRAGMA wal_checkpoint(TRUNCATE)').all()[0] as { busy: number } | null;
    if (checkpoint && checkpoint.busy !== 0) failLegacyState('LEGACY_STATE_STAGE_FAILED');
  } finally { db.close(); }
}

/** Reverify untouched staged output before app conversion/boot; never repairs or starts services. */
export async function verifyStagedLegacyStateMigration(input: LegacyStateMigrationInputForVerification): Promise<StagedLegacyStateMigration> {
  try {
    const plan = await planLegacyStateMigration(input);
    if (plan.fingerprint !== input.expectedPlanFingerprint) failLegacyState('LEGACY_STATE_PLAN_CHANGED');
    canonicalDirectory(input.outputDirectory);
    if (exists(join(input.outputDirectory, 'failed.json'))) failLegacyState('LEGACY_STATE_MANIFEST_INVALID');
    const staged = await readPrivateJson(join(input.outputDirectory, 'staged.json')) as StagedLegacyStateMigration;
    if (!staged || staged.version !== 1 || staged.kind !== 'zero.legacy-state-staged' || staged.planFingerprint !== plan.fingerprint
      || staged.sourceSha256 !== plan.sourceSha256 || staged.requiresApplicationAcceptance !== true
      || staged.workflowRecovery !== (plan.pendingWorkflowCount ? 'requires-reviewed-authority' : 'no-pending-work')
      || staged.systemDatabase?.path !== join(input.outputDirectory, 'system.db')
      || staged.applicationDatabase?.path !== join(input.outputDirectory, 'application.db')) failLegacyState('LEGACY_STATE_MANIFEST_INVALID');
    for (const file of [staged.systemDatabase, staged.applicationDatabase]) {
      if (!/^[a-f0-9]{64}$/.test(file.sha256)) failLegacyState('LEGACY_STATE_MANIFEST_INVALID');
      if (await fileSha256(sourceFile(file.path)) !== file.sha256) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
    }
    verifyPartition(input.sourcePath, staged.systemDatabase.path, plan, 'system', false);
    verifyPartition(input.sourcePath, staged.applicationDatabase.path, plan, 'application', true);
    if (await fileSha256(sourceFile(input.sourcePath)) !== plan.sourceSha256) failLegacyState('LEGACY_STATE_SOURCE_CHANGED');
    for (const file of [staged.systemDatabase, staged.applicationDatabase]) {
      if (await fileSha256(sourceFile(file.path)) !== file.sha256) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
    }
    return Object.freeze(staged);
  } catch (error) {
    if (error instanceof LegacyStateMigrationError) throw error;
    failLegacyState('LEGACY_STATE_MANIFEST_INVALID');
  }
}

export type LegacyStateMigrationInputForVerification = Omit<StageLegacyStateMigrationInput, 'resetReactiveHistory'>;

function verifyPartition(sourcePath: string, targetPath: string, plan: LegacyStateMigrationPlan, plane: 'system' | 'application', exactSchema: boolean): void {
  const source = openLegacyRead(sourcePath);
  let target: Database | undefined;
  try {
    target = openLegacyRead(targetPath);
    assertLegacyIntegrity(target);
    for (const table of plan.tables) {
      if (table.owner === plane || (plane === 'application' && table.owner === 'application-runtime')) {
        const after = legacyRowsEvidence(target, table.table, [...table.columns]);
        if (after.rows !== table.rows || after.rowsSha256 !== table.rowsSha256
          || (exactSchema && legacySchemaSha256(target, table.table) !== table.schemaSha256)) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
      } else if (table.owner === 'ledger') {
        const versions = plane === 'system' ? plan.systemMigrationVersions : plan.applicationMigrationVersions;
        const column = table.table === '_migrations' || table.table === '_zero_migrations' ? 'version' : 'migration_version';
        const predicate = { column, values: versions };
        const before = legacyRowsEvidence(source, table.table, [...table.columns], predicate);
        const after = legacyRowsEvidence(target, table.table, [...table.columns], predicate);
        if (before.rows !== after.rows || before.rowsSha256 !== after.rowsSha256) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
      } else if (!(plane === 'application' && table.table === 'users') && hasTable(target, table.table)) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
    }
    if (plane === 'application') {
      verifyLegacyMutationReceiptBindings(source, target, plan);
      if (JSON.stringify(target.query('PRAGMA table_info(users)').all().map(row => (row as { name: string }).name)) !== '["user_id"]') failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
      const before = legacyRowsEvidence(source, 'users', ['user_id']), after = legacyRowsEvidence(target, 'users', ['user_id']);
      if (before.rows !== after.rows || before.rowsSha256 !== after.rowsSha256) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
      for (const view of plan.applicationViews) target.query(`SELECT * FROM ${q(view)} LIMIT 0`).all();
    }
    if (plane === 'system' && !exactSchema) {
      const registry = new Map(migrations.map(migration => [migration.version, hashMigration(migration)]));
      const applied = target.query<{ version: string; checksum: string }, []>('SELECT version,checksum FROM _migrations').all();
      if (applied.length !== registry.size || applied.some(row => registry.get(row.version) !== row.checksum)) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
      for (const version of registry.keys()) {
        const latest = target.query<{ direction: string; status: string }, [string]>("SELECT direction,status FROM _zero_migrations WHERE version=? AND status IN ('applied','rolled_back') ORDER BY id DESC LIMIT 1").get(version);
        if (latest?.direction !== 'up' || latest.status !== 'applied') failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
      }
      const held = target.query<{ instance_id: string; plan_fingerprint: string; source_sha256: string }, []>('SELECT * FROM _workflow_legacy_migration_holds').all();
      if (held.length !== plan.pendingWorkflowCount || held.some(row => row.plan_fingerprint !== plan.fingerprint || row.source_sha256 !== plan.sourceSha256
        || !source.query("SELECT 1 FROM workflow_instances WHERE instance_id=? AND status NOT IN ('completed','failed','cancelled')").get(row.instance_id))) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
    }
    // Before migration every ledger row belongs to exactly this plane; after
    // system migration only newly admitted built-in versions may be appended.
    if (exactSchema) for (const table of LEGACY_LEDGER_TABLES) {
      if (!hasTable(target, table)) continue;
      const versions = plane === 'system' ? plan.systemMigrationVersions : plan.applicationMigrationVersions;
      const column = table === '_migrations' || table === '_zero_migrations' ? 'version' : 'migration_version';
      if (target.query(`SELECT 1 FROM ${q(table)} WHERE ${q(column)} NOT IN (${versions.map(() => '?').join(',') || 'NULL'}) LIMIT 1`).get(...versions)) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
    }
  } finally { try { closeLegacyRead(source); } finally { if (target) closeLegacyRead(target); } }
}
