/** Explicit source actor, empty inherited environment; no application entry import. */
import { runLoggingActorIfRequested } from '@zero/framework/server';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
// Workers own an empty private cwd. Qualification probes belong to the explicit
// fixture project, never that protected launch directory.
const report = (state: string, code?: string) => appendFile(join(import.meta.dir, '../actor-probes.ndjson'), JSON.stringify({ state, code, pid: process.pid,
  providerSecret: process.env.ZERO_SYNTHETIC_PROVIDER_SECRET !== undefined,
  dotenvSecret: process.env.ZERO_SYNTHETIC_DOTENV_SECRET !== undefined }) + '\n');
await report('entered');
try {
  if (!await runLoggingActorIfRequested()) { await report('not-requested'); process.exitCode = 64; }
  else await report('finished');
} catch (error) {
  await report('failed', typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'UNKNOWN');
  process.exitCode = 70;
}
