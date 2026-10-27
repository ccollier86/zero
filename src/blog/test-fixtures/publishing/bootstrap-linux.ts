/** Container qualification entry. /candidate is a read-only archive; /fixture is read-only source; /proof is fresh disposable scratch. */
import { cp, mkdir } from 'node:fs/promises';

if (process.platform !== 'linux' || process.arch !== 'x64' || process.cwd() !== '/proof') throw new Error('The publishing qualification needs an isolated Linux/amd64 /proof directory.');
await mkdir('./app', { recursive: true }); await mkdir('./server', { recursive: true });
await Bun.write('./package.json', JSON.stringify({ name: 'zero-blog-linux-proof', private: true, type: 'module', dependencies: { '@zero/framework': 'file:/candidate/zero-framework.tgz', react: '19.2.4', 'react-dom': '19.2.4' } }));
for (const [source, target] of [['zero.config.ts', 'zero.config.ts'], ['logging-actor.ts', 'server/logging-actor.ts'], ['app/server.ts', 'app/server.ts'], ['audit-heartbeat.ts', 'audit-heartbeat.ts'], ['prepare.ts', 'prepare.ts'], ['qualify.ts', 'qualify.ts']]) {
  await cp('/fixture/' + source, './' + target);
}
await Bun.write('./.env', 'ZERO_SYNTHETIC_DOTENV_SECRET=fixture-only\n');
const commands = Bun.argv.includes('--resume') ? [['qualify.ts', '--resume']] : [['install', '--ignore-scripts'], ['qualify.ts']];
for (const args of commands) {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { stdout: 'inherit', stderr: 'inherit', env: { PATH: process.env.PATH, BUN_INSTALL_CACHE_DIR: '/cache' } });
  const timer = setTimeout(() => child.kill(), 360000);
  const status = await child.exited; clearTimeout(timer);
  if (status !== 0) process.exit(status || 1);
}
