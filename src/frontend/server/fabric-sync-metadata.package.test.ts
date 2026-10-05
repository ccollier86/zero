/**
 * Release regression for public schema projections crossing the packed package,
 * gateway configuration, composed realm, and real writer/reader actor boundary.
 * It owns only fresh disposable consumer data, never any application's state.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const REPOSITORY_ROOT = process.cwd();
const SCRATCH_ROOT = '/Volumes/code-bank/tmp/scratch/zero-platform';
const FIXTURE_ROOT = join(REPOSITORY_ROOT, 'src/frontend/server/test-fixtures');

test('packed multi-tenant gateway and Fabric actors preserve all declared schema loading modes', async () => {
  await mkdir(SCRATCH_ROOT, { recursive: true });
  const root = await mkdtemp(join(SCRATCH_ROOT, 'fabric-sync-metadata-package-'));
  const consumer = join(root, 'consumer');
  const archive = join(root, 'framework.tgz');
  try {
    await mkdir(join(consumer, 'app'), { recursive: true });
    await mkdir(join(consumer, 'routes'), { recursive: true });
    await checked([process.execPath, '--no-env-file', 'pm', 'pack', '--filename', archive], REPOSITORY_ROOT);
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-public-fabric-sync-metadata-proof', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    for (const [source, target] of [
      ['fabric-sync-metadata-realm.fixture.ts', 'fabric-sync-metadata-realm.fixture.ts'],
      ['fabric-sync-metadata-gateway.fixture.ts', 'gateway.ts'],
      ['fabric-sync-metadata-endpoint.fixture.ts', 'routes/proof.ts'],
      ['fabric-sync-metadata-page.fixture.tsx', 'app/page.tsx'],
    ]) {
      await Bun.write(join(consumer, target!), Bun.file(join(FIXTURE_ROOT, source!)));
    }
    await checked([process.execPath, '--no-env-file', 'install', '--ignore-scripts'], consumer);
    const installed = await Bun.file(join(consumer, 'node_modules/@zero/framework/package.json')).json();
    expect(installed.name).toBe('@zero/framework');
    const output = await checked([process.execPath, '--no-env-file', 'gateway.ts'], consumer);
    expect(output).toContain('[zero-public-fabric-sync-metadata] complete');
  } finally {
    // Only this test's validated fresh mkdtemp directory is disposable.
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);

/** Run bounded isolated package commands without carrying application secrets. */
async function checked(command: string[], cwd: string): Promise<string> {
  const subprocess = Bun.spawn(command, {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: {
      PATH: process.env.PATH,
      BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache',
      TMPDIR: SCRATCH_ROOT,
    },
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    subprocess.kill();
  }, 120_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    if (timedOut || code !== 0) throw new Error(
      `Public package proof failed (${timedOut ? 'timeout' : code}):\n${stdout}\n${stderr}`,
    );
    return stdout;
  } finally {
    clearTimeout(timeout);
  }
}
