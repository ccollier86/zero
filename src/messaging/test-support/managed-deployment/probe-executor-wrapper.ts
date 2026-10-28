/** Internal diagnostic ONLY, never an app configuration, public import recipe or a release gate replacement. */
import { appendFileSync } from 'node:fs';
const path = new URL('./src/databases/subprocess-database-executor.ts', import.meta.resolve('@zero/framework/package.json'));
const { SubprocessDatabaseExecutor } = await import(path.href) as typeof import('../../../databases/subprocess-database-executor');
const protocol = new URL('./src/databases/database-actor-protocol.ts', import.meta.resolve('@zero/framework/package.json'));
const { DATABASE_ACTOR_OPERATIONS } = await import(protocol.href) as typeof import('../../../databases/database-actor-protocol');
const operations = new Set<string>(Object.values(DATABASE_ACTOR_OPERATIONS));
const close = SubprocessDatabaseExecutor.prototype.close; let count = 0;
const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(value) ? value : null;
let stages = 0;
function stage(executor: InstanceType<typeof SubprocessDatabaseExecutor>, phase: 'begin' | 'accepted' | 'failed', operation: string, started: number, error?: unknown) {
  if (stages++ >= 512) return;
  const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : null;
  // Fixed lifecycle names only. No request identity/body, database IDs, paths,
  // environment, SQL, event text or returned rows are inspected or serialized.
  try { appendFileSync('./executor-stages.ndjson', JSON.stringify({ pid: process.pid, phase, operation, durationMs: Math.round(performance.now() - started),
    code: safeCode(code), health: executor.diagnostics() }) + '\n'); } catch { /* A diagnostic observer cannot change an operation outcome. */ }
}
const start = SubprocessDatabaseExecutor.prototype.start;
SubprocessDatabaseExecutor.prototype.start = function () {
  const at = performance.now(); stage(this, 'begin', 'executor.start', at);
  return start.call(this).then(value => { stage(this, 'accepted', 'executor.start', at); return value; }, error => { stage(this, 'failed', 'executor.start', at, error); throw error; });
};
const execute = SubprocessDatabaseExecutor.prototype.execute;
SubprocessDatabaseExecutor.prototype.execute = function (this: InstanceType<typeof SubprocessDatabaseExecutor>, request, options) {
  const operation = operations.has(request.operation) ? request.operation : 'other';
  const at = performance.now(); stage(this, 'begin', operation, at);
  return execute.call(this, request, options).then(value => { stage(this, 'accepted', operation, at); return value; }, error => { stage(this, 'failed', operation, at, error); throw error; });
} as typeof execute;
SubprocessDatabaseExecutor.prototype.close = function (this: InstanceType<typeof SubprocessDatabaseExecutor>) {
  return close.call(this).catch(error => {
    if (count++ < 64) appendFileSync('./executor-failures.ndjson', JSON.stringify({ pid: process.pid,
      code: safeCode(error?.code), phase: safeCode(error?.details?.phase), health: this.diagnostics() }) + '\n');
    throw error; // Preserve failure and every original deadline; never count it as a clean stop.
  });
};
await import('./prepare-source-state');
