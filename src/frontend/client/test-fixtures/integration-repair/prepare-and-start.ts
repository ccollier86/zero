/** Rebuild only synthetic fixture source over an immutable installed qualification image. */
import { cp } from 'node:fs/promises';
for (const path of ['package.json', 'tsconfig.json', 'zero.config.ts', 'prepare-source-state.ts', 'app', 'server']) {
  await cp('/fixture/' + path, './' + path, { recursive: true });
}
const installed = Bun.spawn([process.execPath, '--no-env-file', 'install'], { stdout: 'inherit', stderr: 'inherit' });
if (await installed.exited !== 0) process.exit(1);
await Bun.write('./.env', 'ZERO_SYNTHETIC_DOTENV_SECRET=fixture-only\n');
if (!await Bun.file('./state/application.db').exists()) {
  const prepared = Bun.spawn([process.execPath, '--no-env-file', 'prepare-source-state.ts'], { stdout: 'inherit', stderr: 'inherit' });
  if (await prepared.exited !== 0) process.exit(1);
}
const built = Bun.spawn([process.execPath, '--no-env-file', 'node_modules/@zero/framework/src/cli/run.ts', 'build'], { stdout: 'inherit', stderr: 'inherit' });
if (await built.exited !== 0) process.exit(1);
const child = Bun.spawn([process.execPath, '--no-env-file', 'dist/server.js'], { stdout: 'inherit', stderr: 'inherit' });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
process.exitCode = await child.exited;
