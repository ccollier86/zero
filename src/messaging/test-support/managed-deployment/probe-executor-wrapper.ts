/** Internal diagnostic ONLY, never an app configuration, public import recipe or a release gate replacement. */
import { appendFileSync } from 'node:fs';
const path = new URL('./src/databases/subprocess-database-executor.ts', import.meta.resolve('@zero/framework/package.json'));
const { SubprocessDatabaseExecutor } = await import(path.href) as typeof import('../../../databases/subprocess-database-executor');
const close = SubprocessDatabaseExecutor.prototype.close; let count = 0;
const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(value) ? value : null;
SubprocessDatabaseExecutor.prototype.close = function (this: InstanceType<typeof SubprocessDatabaseExecutor>) {
  return close.call(this).catch(error => {
    if (count++ < 64) appendFileSync('./executor-failures.ndjson', JSON.stringify({ pid: process.pid,
      code: safeCode(error?.code), phase: safeCode(error?.details?.phase), health: this.diagnostics() }) + '\n');
    throw error; // Preserve failure and every original deadline; never count it as a clean stop.
  });
};
await import('./prepare-source-state');
