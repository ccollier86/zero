import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runLoggingActorIfRequested } from '@zero/framework/logging/actor';
const providerSecret = process.env.ZERO_SYNTHETIC_PROVIDER_SECRET !== undefined, dotenvSecret = process.env.ZERO_SYNTHETIC_DOTENV_SECRET !== undefined;
await appendFile(join(import.meta.dir, '../actor-probes.ndjson'), JSON.stringify({ pid: process.pid, kind: 'logging', providerSecret, dotenvSecret }) + '\n');
if (providerSecret || dotenvSecret || !await runLoggingActorIfRequested()) process.exit(64);
