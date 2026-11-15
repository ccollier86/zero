/** Fixed source/bundle branch. Uses Zero's existing nonce/generation-fenced IPC transport, not a second protocol. */
import { parseDatabaseActorInvocation } from '../databases/database-actor-entry-contract';
import { DatabaseError } from '../databases/database-error';
import { SubprocessDatabaseServer } from '../databases/subprocess-database-server';
import { WorkerTaskCatalog, type WorkerTask } from './worker-task';
import { workerRecord } from './worker-value';

export const WORKER_CHILD_FLAG = '--zero-task-worker';

export async function runWorkerIfRequested(options: { tasks: readonly WorkerTask[]; argv?: readonly string[] }): Promise<boolean> {
  const invocation = parseDatabaseActorInvocation(options.argv ?? process.argv, WORKER_CHILD_FLAG);
  if (!invocation) return false;
  if (typeof Bun !== 'object' || typeof process.send !== 'function' || process.connected !== true || invocation.role !== 'writer') throw invalid();
  const catalog = new WorkerTaskCatalog(options.tasks);
  const server = new SubprocessDatabaseServer({ role: 'writer', slot: invocation.slot, maxInFlight: 1,
    handle: async request => {
      if (request.operation === 'worker.catalog' && request.kind === 'read' && request.payload === null) return catalog.fingerprint;
      if (request.operation !== 'worker.execute' || request.kind !== 'write') throw invalid();
      let payload: Record<string, unknown>;
      try { payload = workerRecord(request.payload, ['name', 'version', 'input', 'catalog']); } catch { throw invalid(); }
      if (typeof payload.name !== 'string' || payload.catalog !== catalog.fingerprint) throw invalid();
      const task = catalog.get(payload.name);
      if (payload.version !== task.version) throw invalid();
      try {
        return { ok: true, value: await task.invoke(payload.input) };
      } catch {
        // A handler/parser can contain secrets in its Error message. Never
        // serialize arbitrary errors or pretend an external effect rolled back.
        return { ok: false, code: 'WORKER_TASK_FAILED' };
      }
    },
  });
  await server.run(); return true;
}
function invalid() { return new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Worker protocol request was rejected.', { retryable: false, outcome: 'unknown' }); }
