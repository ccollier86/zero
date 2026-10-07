/** Bun IPC child for the durable ownership race; not a production server entry. */
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { WorkflowRuntimeLeaseStore } from '../workflow-runtime-lease-store';
import type { OwnerAcquisitionOutcome } from '../test-support/workflow-owner-acquisition';

const [databasePath, ownerId] = Bun.argv.slice(2);
if (!databasePath || !ownerId || typeof process.send !== 'function') {
  throw new Error('Workflow ownership child requires a database, owner, and Bun IPC channel.');
}

const admitted = Promise.withResolvers<void>();
void admitted.promise.catch(() => {});
let startReceived = false, finished = false;
const onMessage = (message: unknown) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || (message as Record<string, unknown>).type !== 'start'
    || (message as Record<string, unknown>).ownerId !== ownerId || startReceived) {
    admitted.reject(new Error('Workflow ownership child received invalid start admission.')); return;
  }
  startReceived = true; admitted.resolve();
};
const onDisconnect = () => {
  if (!finished) admitted.reject(new Error('Workflow ownership parent disconnected before completion.'));
};
process.on('message', onMessage);
process.on('disconnect', onDisconnect);

let db: ReactiveDB | null = null;
try {
  db = createReactiveDB({ mode: 'file', path: databasePath, busyTimeout: 5000, emitTelemetry: false });
  const store = new WorkflowRuntimeLeaseStore(db);
  await send({ type: 'ready', ownerId });
  await admitted.promise;
  let outcome: OwnerAcquisitionOutcome;
  try {
    store.acquire(ownerId, 1000, 1000);
    outcome = { ok: true, ownerId };
  } catch (error) {
    const failure = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : null;
    if (failure?.code !== 'WORKFLOW_RUNTIME_OWNED' || failure.status !== 503) throw error;
    outcome = { ok: false, ownerId, code: failure.code, status: failure.status,
      message: error instanceof Error ? error.message : 'Workflow runtime is owned.' };
  }
  db.dispose(); db = null;
  await send({ type: 'result', disposed: true, outcome });
  finished = true;
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Workflow ownership child failed.');
} finally {
  try { db?.dispose(); }
  catch (error) { process.exitCode = 1; console.error(error instanceof Error ? error.message : 'Workflow ownership child disposal failed.'); }
  finished = true;
  process.off('message', onMessage);
  process.off('disconnect', onDisconnect);
  process.disconnect?.();
}

function send(message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== 'function') { reject(new Error('Bun IPC channel is unavailable.')); return; }
    process.send(message as object, error => error ? reject(error) : resolve());
  });
}
