/** Container entry: reuse the checked-in fixture, install the exact mounted archive, build normally and retain only safe diagnostics. */
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const root = '/qualification', evidence = '/evidence';
await mkdir(root, { recursive: true }); await mkdir(evidence, { recursive: true });
await cp(import.meta.dir, root, { recursive: true });
const env = { PATH: process.env.PATH ?? '', TMPDIR: '/tmp', BUN_INSTALL_CACHE_DIR: '/tmp/zero-messaging-install-cache' };
try {
  for (const [name, args] of [
    ['install', ['install', '--ignore-scripts']],
    ['source-state', ['prepare-source-state.ts']],
    ['official-build', ['node_modules/@zero/framework/src/cli/run.ts', 'build', '--config', './zero.config.ts']],
    ['qualification', ['qualify.ts']],
  ] as const) {
    console.log('Messaging installed Linux proof: ' + name);
    const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill('SIGKILL'), name === 'install' ? 300000 : 240000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      await Bun.write(join(evidence, name + '.log'), stdout + '\n' + stderr);
      if (code !== 0) throw new Error('Messaging installed Linux stage failed: ' + name + ' (' + code + '). See the retained stage log.');
    } finally { clearTimeout(timer); }
  }
  const report = await Bun.file(join(root, 'qualification-report.json')).json();
  report.archiveSha256 = new Bun.CryptoHasher('sha256').update(new Uint8Array(await Bun.file('/input/framework.tgz').arrayBuffer())).digest('hex');
  await Bun.write(join(evidence, 'qualification-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  for (const name of ['server-output.log', 'safe-observations.ndjson']) {
    const path = join(root, name); if (await Bun.file(path).exists()) await Bun.write(join(evidence, name), await Bun.file(path).text());
  }
}
