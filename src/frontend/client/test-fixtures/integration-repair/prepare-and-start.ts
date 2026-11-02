/** Prepare synthetic source state once, then qualify actual prepared-bundle restarts. */
import { cp } from 'node:fs/promises';
const marker = Bun.file('./prepared-bundle.json');
const digest = async (path: string) => new Bun.CryptoHasher('sha256').update(await Bun.file(path).bytes()).digest('hex');
const archiveSha256 = await digest('/input/framework.tgz');
if (await marker.exists()) {
  const prepared = await marker.json();
  if (prepared.version !== 1 || prepared.archiveSha256 !== archiveSha256
    || !await Bun.file('./state/application.db').exists()
    || !await Bun.file('./state/system.db').exists()
    || prepared.bundleSha256 !== await digest('./dist/server.js')) {
    throw new Error('Synthetic prepared bundle identity/state mismatch.');
  }
  // A deployed restart launches the retained bundle; it does not run install,
  // source preparation or a second compiler inside the restart readiness bound.
  console.log(JSON.stringify({ preparedBundleRestart: true }));
} else {
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
  await Bun.write(marker, JSON.stringify({ version: 1, archiveSha256, bundleSha256: await digest('./dist/server.js') }));
}
const child = Bun.spawn([process.execPath, '--no-env-file', 'dist/server.js'], { stdout: 'inherit', stderr: 'inherit' });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
process.exitCode = await child.exited;
