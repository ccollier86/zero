/**
 * Parent-process crash fixture. The writer child intentionally remains inside
 * one transaction when this supervisor is killed by the integration test.
 */

import { fileURLToPath } from 'node:url';

import { DatabaseCoordinator } from '../database-coordinator';
import { SubprocessDatabaseExecutor } from '../subprocess-database-executor';
import { databaseActorFixtureRealm } from './database-actor-realm';

const rootDirectory = process.argv[2];
const enteredPath = process.argv[3];
const releasePath = process.argv[4];
const childPath = fileURLToPath(new URL('./database-actor-child.ts', import.meta.url));

if (!rootDirectory || !enteredPath || !releasePath) {
  process.exitCode = 64;
} else {
  const coordinator = new DatabaseCoordinator({
    rootDirectory,
    realm: databaseActorFixtureRealm,
    readers: false,
    maxDatabases: 1,
    operationTimeoutMs: 30_000,
    sweepIntervalMs: false,
    createExecutor: ({ role, slot }) => new SubprocessDatabaseExecutor({
      command: [process.execPath, childPath, role, String(slot)],
      env: {},
      role,
      slot,
      maxInFlight: 1,
      startupTimeoutMs: 3_000,
      operationTimeoutMs: 30_000,
      shutdownAckTimeoutMs: 2_000,
      shutdownExitTimeoutMs: 2_000,
      sigtermTimeoutMs: 1_000,
      sigkillTimeoutMs: 1_000,
    }),
  });
  try {
    coordinator.start();
    const lease = await coordinator.acquire('tenant-crash-fence');
    await lease.execute({
      type: 'mutate',
      idempotencyKey: 'crash-fence:create',
      mutation: {
        type: 'create',
        table: 'todos',
        row: { id: 'row', title: 'Before crash' },
      },
    });
    await lease.execute({
      type: 'command',
      name: 'test.blockingUpdate',
      input: {
        id: 'row',
        title: 'Committed by orphan',
        enteredPath,
        releasePath,
      },
      idempotencyKey: 'crash-fence:blocking-update',
    });
  } catch {
    process.exitCode = 70;
  }
}
