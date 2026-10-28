/** Exact installed package actor; must not import app/server or inherit provider/dotenv secrets. */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runLoggingActorIfRequested } from '@zero/framework/logging/actor';

const providerSecret = process.env.ZERO_SYNTHETIC_PROVIDER_SECRET !== undefined;
const dotenvSecret = process.env.ZERO_SYNTHETIC_DOTENV_SECRET !== undefined;
await appendFile(join(import.meta.dir, '../actor-probes.ndjson'), JSON.stringify({ pid: process.pid, providerSecret, dotenvSecret }) + '\n');
if (providerSecret || dotenvSecret || !await runLoggingActorIfRequested()) process.exit(64);
