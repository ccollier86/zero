/** Real Bun IPC entrypoint for DatabaseActorRuntime integration tests. */

import { runDatabaseActorSubprocess } from '../database-actor-bootstrap';
import type { DatabaseActorRole } from '../database-actor-protocol';
import { databaseActorFixtureRealm } from './database-actor-realm';

const rawRole = process.argv[2];
const rawSlot = Number(process.argv[3]);
if ((rawRole !== 'writer' && rawRole !== 'reader')
  || !Number.isSafeInteger(rawSlot)
  || rawSlot < 0) {
  process.exitCode = 64;
} else {
  try {
    await runDatabaseActorSubprocess({
      role: rawRole as DatabaseActorRole,
      slot: rawSlot,
      loadRealm: () => databaseActorFixtureRealm,
    });
  } catch {
    process.exitCode = 70;
  }
}
