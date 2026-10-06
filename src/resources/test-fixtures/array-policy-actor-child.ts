/** Real Bun actor IPC entrypoint for the isolated authorization acceptance realm. */
import { runDatabaseActorSubprocess } from '../../databases/database-actor-bootstrap';
import { arrayPolicyRealm } from './array-policy-realm';

const role = process.argv[2], slot = Number(process.argv[3]);
if ((role !== 'writer' && role !== 'reader') || !Number.isSafeInteger(slot) || slot < 0) {
  process.exitCode = 64;
} else {
  try { await runDatabaseActorSubprocess({ role, slot, loadRealm: () => arrayPolicyRealm }); }
  catch { process.exitCode = 70; }
}
