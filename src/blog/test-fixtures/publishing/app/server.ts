/** Normal source server entry. The official build, not a hand-written bundler, prepares its frontend and migration identities. */
import { createApp } from '@zero/framework/server';
import config from '../zero.config';
const app = await createApp(config);
app.listen({ hostname: '127.0.0.1', port: 0 });
await Bun.write('./state/ready.json', JSON.stringify({ port: app.server!.port }));
