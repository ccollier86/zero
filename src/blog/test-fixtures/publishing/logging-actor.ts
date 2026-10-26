/** Explicit matching-package source launch, with no main-app bootstrap or inherited synthetic provider secret. */
import { runLoggingActorIfRequested } from '@zero/framework/server';
import { appendFile } from 'node:fs/promises';
const probe = (stage: string, error?: unknown) => appendFile(new URL('../actor-probes.ndjson', import.meta.url), JSON.stringify({ stage, pid: process.pid, time: Date.now(),
  code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined,
  kind: error instanceof Error ? error.name : undefined }) + '\n');
if (process.env.ZERO_SYNTHETIC_PROVIDER_SECRET || process.env.ZERO_SYNTHETIC_DOTENV_SECRET) throw new Error('Synthetic secret crossed the actor boundary.');
await probe('entered');
try { if (!await runLoggingActorIfRequested()) throw new Error('Synthetic actor was not requested.'); await probe('finished'); }
catch (error) { await probe('failed', error); throw error; }
