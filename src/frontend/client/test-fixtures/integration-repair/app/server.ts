/** Official bundle entry. Actor source entries must never boot this module. */
import { appendFile } from 'node:fs/promises';
import { createApp } from '@zero/framework/server';
import config from '../zero.config';

await appendFile('./main-boots.ndjson', JSON.stringify({ pid: process.pid }) + '\n');
const app = await createApp(config);
app.listen({ hostname: '0.0.0.0', port: 4319 });
await Bun.write('./ready.json', JSON.stringify({ port: app.server!.port, pid: process.pid }));
