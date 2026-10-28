/** The matching installed source actor. No implicit environment or main-application boot is permitted. */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runMessagingActorIfRequested, MESSAGING_ACTOR_FLAG } from '@zero/framework/messaging/actor';
const providerSecret = process.env.ZERO_SYNTHETIC_PROVIDER_SECRET !== undefined, dotenvSecret = process.env.ZERO_SYNTHETIC_DOTENV_SECRET !== undefined;
const flag = process.argv.indexOf(MESSAGING_ACTOR_FLAG), role = flag < 0 ? null : process.argv[flag + 1];
await appendFile(join(import.meta.dir, '../actor-probes.ndjson'), JSON.stringify({ pid: process.pid, kind: 'messaging', role, providerSecret, dotenvSecret }) + '\n');
if (providerSecret || dotenvSecret || !await runMessagingActorIfRequested()) process.exit(64);
