/** Real native writer/managed realm over SQLite MEMORY. No file or actor fixture. */
import { createPlatformSQLiteService } from '../../persistence';
import { DatabaseRuntime } from '../../databases/database-runtime';
import { DatabaseWriterOperationEngine } from '../../databases/database-writer-engine';
import type { DatabaseSerializableValue } from '../../databases/database-operations';
import { jobsRealm } from '../realm';
import { jobCapacityPolicyData, normalizeJobsCapacityPolicy, type JobsCapacityConfig } from '../capacity-policy';
import { JobsError, readJobRejection } from '../error';
import { Migrator } from '../../migrations/migrator';

export function memoryJobsWriterFixture(capacity?: JobsCapacityConfig) {
  const sqlite = createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false });
  let runtime: DatabaseRuntime | undefined, engine: DatabaseWriterOperationEngine | undefined;
  try {
    sqlite.raw.run('PRAGMA temp_store=MEMORY'); sqlite.raw.run('PRAGMA foreign_keys=ON');
    const migrator = new Migrator({ database: sqlite.raw, dbPath: ':memory:', migrations: jobsRealm.migrations, createBackups: false, applyPragmas: false, log() {} });
    try { migrator.run(); } finally { migrator.dispose(); }
    runtime = DatabaseRuntime.open({ id: 'synthetic-native-jobs-writer', role: 'named', sqlite, ownsSQLite: true,
      tables: jobsRealm.tables, migrations: jobsRealm.migrations, migrationLog() {} });
    engine = new DatabaseWriterOperationEngine({ runtime, realm: jobsRealm, writerPolicy: jobCapacityPolicyData(normalizeJobsCapacityPolicy(capacity)) });
    const command = <T = any>(name: string, input: unknown, key: string = crypto.randomUUID()): T => {
      try {
        const result = engine!.execute({ type: 'command', name, input: input as DatabaseSerializableValue, idempotencyKey: key });
        const value = result.value as { output?: { ok: boolean; value: T; code?: ConstructorParameters<typeof JobsError>[0] } };
        if (!value.output?.ok) throw new JobsError(value.output?.code ?? 'JOBS_STATE_INVALID');
        return value.output.value;
      } catch (error) { throw readJobRejection(error) ?? error; }
    };
    return { runtime, engine, db: runtime.db, raw: sqlite.raw, command,
      close() { try { engine!.close(); } finally { runtime!.close(); } } };
  } catch (error) { try { engine?.close(); } finally { if (runtime) runtime.close(); else sqlite.close(); } throw error; }
}
