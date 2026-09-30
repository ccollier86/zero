/** Real Bun IPC entrypoint for Guardian/Fabric integration tests. */

import { runDatabaseActorSubprocess } from '../database-actor-bootstrap';
import type { DatabaseActorRole } from '../database-actor-protocol';
import { databaseGuardianActorFixtureRealm } from './database-guardian-actor-realm';

const role = process.argv[2];
const slot = Number(process.argv[3]);
if ((role !== 'writer' && role !== 'reader')
  || !Number.isSafeInteger(slot) || slot < 0) {
  process.exitCode = 64;
} else {
  try {
    await runDatabaseActorSubprocess({
      role: role as DatabaseActorRole,
      slot,
      loadRealm: () => databaseGuardianActorFixtureRealm,
    });
  } catch {
    process.exitCode = 70;
  }
}
