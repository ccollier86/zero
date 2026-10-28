/** Diagnostic-only repeated fresh source setup/stop. Never retries a failed setup or changes an assertion/deadline. */
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareMessagingAuditFixture } from './fixture-files';
const root = '/qualification', evidence = '/evidence';
await mkdir(root, { recursive: true }); await mkdir(evidence, { recursive: true });
await cp(import.meta.dir, root, { recursive: true });
const env = { PATH: process.env.PATH ?? '', TMPDIR: '/tmp', BUN_INSTALL_CACHE_DIR: '/tmp/zero-messaging-install-cache' };
const install = Bun.spawn([process.execPath, '--no-env-file', 'install', '--ignore-scripts'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
const [installOut, installErr, installCode] = await Promise.all([new Response(install.stdout).text(), new Response(install.stderr).text(), install.exited]);
await Bun.write(join(evidence, 'install.log'), installOut + '\n' + installErr);
if (installCode !== 0) throw new Error('Lifecycle probe install failed.');
for (let attempt = 1; attempt <= 8; attempt++) {
  const cwd = join(root, 'fresh-' + attempt), destination = join(evidence, 'fresh-' + attempt);
  await cp(import.meta.dir, cwd, { recursive: true }); await mkdir(destination);
  await prepareMessagingAuditFixture(cwd);
  const child = Bun.spawn([process.execPath, '--no-env-file', './probe-executor-wrapper.ts'], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); clearTimeout(timer);
  await Bun.write(join(destination, 'source-state.log'), out + '\n' + err);
  for (const name of ['safe-observations.ndjson', 'executor-failures.ndjson', 'actor-probes.ndjson']) if (await Bun.file(join(cwd, name)).exists()) await Bun.write(join(destination, name), await Bun.file(join(cwd, name)).text());
  console.log(JSON.stringify({ attempt, code }));
  if (code !== 0) throw new Error('Fresh source lifecycle failed. See safe retained diagnostics.');
}
