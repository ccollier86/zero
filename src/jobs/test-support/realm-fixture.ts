/** Owned synthetic file/WAL subprocess fixture. Not application data, and never a migration recipe. */
import { Database } from 'bun:sqlite';
import { DatabaseCoordinator } from '../../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../../databases/database-client';
import { createSubprocessDatabaseExecutorFactory } from '../../databases/subprocess-database-executor-factory';
import { resolveDatabaseFile } from '../../databases/database-file';
import type { AsyncDatabaseOperationExecutor, DatabaseSerializableValue } from '../../databases/database-operations';
import { ownedWorkerFixture } from '../../workers/test-support/owned-fixture';
import { jobsRealm } from '../realm';
import { readJobRejection } from '../error';

export async function jobsRealmFixture(scopeId = 'application') {
  const fixture = await ownedWorkerFixture('jobs-realm');
  const databaseId = 'jobs:content';
  let owner: DatabaseCoordinator | null = null, lease: Awaited<ReturnType<DatabaseCoordinator['acquire']>> | null = null;
  let data: ReturnType<typeof createAsyncDatabaseClient>;
  const closeHandles = async () => { lease?.release(); lease = null; if (owner) { await owner.close(); owner = null; } };
  const open = async () => {
    owner = new DatabaseCoordinator({ rootDirectory: fixture.root, realm: jobsRealm, sqlite: { synchronous: 'FULL' },
      maxDatabases: 1, readers: true, sweepIntervalMs: false,
      createExecutor: createSubprocessDatabaseExecutorFactory({ launch: { kind: 'source', entrypoint: new URL('../actor-entry.ts', import.meta.url) },
        actorFlag: '--zero-jobs-actor', env: {} }) });
    owner.start(); lease = await owner.acquire(databaseId);
    data = createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor });
  };
  try { await open(); }
  catch (error) { await closeHandles(); await fixture.cleanup(); throw error; }
  const command = async (name: string, input: unknown, transportId = crypto.randomUUID()): Promise<any> => {
    try { const result = await data.command(name, input as DatabaseSerializableValue, { idempotencyKey: transportId }); return (result.value as any).output; }
    catch (error) { const domain = readJobRejection(error); if (!domain) throw error; return { ok: false, code: domain.code, outcome: domain.outcome }; }
  };
  try {
    const bound = await command('jobs.owner.bind', { scopeId, ownerId: 'synthetic-owner' });
    if (!bound.ok) throw new Error('Synthetic jobs owner was not bound.');
  } catch (error) { await closeHandles(); await fixture.cleanup(); throw error; }
  return {
    root: fixture.root, command,
    async query(name: string, input: unknown): Promise<any> { return (await data.query(name, input as DatabaseSerializableValue, { consistency: { mode: 'strong' } })).value; },
    async restart() { await closeHandles(); await open(); },
    async offline(run: (database: Database) => void) {
      await closeHandles(); const database = new Database(resolveDatabaseFile(fixture.root, databaseId).path);
      try { run(database); } finally { database.close(true); }
      await open();
    },
    async close() { await closeHandles(); await fixture.cleanup(); },
  };
}
