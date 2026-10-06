/** Isolated installed-public-package proof; no live app or existing DB is opened. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('installed package durably starts one Torrent run per captured trigger effect', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'automation-torrent-package-'));
  const consumer = join(root, 'consumer');
  try {
    await mkdir(join(consumer, 'app'), { recursive: true });
    await mkdir(join(consumer, 'routes'), { recursive: true });
    const archive = join(root, 'framework.tgz');
    await checked([process.execPath, '--no-env-file', 'pm', 'pack', '--filename', archive, '--ignore-scripts', '--quiet'], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-trigger-torrent-public-proof', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    const fixtures = join(import.meta.dir, 'test-fixtures');
    for (const [source, destination] of [
      ['automation-torrent-gateway.fixture.ts', 'gateway.ts'],
      ['automation-torrent-endpoint.fixture.ts', 'routes/orders.ts'],
      ['fabric-sync-metadata-page.fixture.tsx', 'app/page.tsx'],
    ]) await Bun.write(join(consumer, destination!), Bun.file(join(fixtures, source!)));
    await checked([process.execPath, '--no-env-file', 'install', '--ignore-scripts'], consumer);
    const installed = join(consumer, 'node_modules/@zero/framework');
    expect(await Bun.file(join(installed, 'docs-next/backend/database-automations/app-functions.md')).exists()).toBe(true);
    expect(await Bun.file(join(installed, 'docs-next/backend/database-automations/torrent.md')).text()).toContain('torrent.start');
    const output = await checked([process.execPath, '--no-env-file', 'gateway.ts'], consumer);
    expect(output).toContain('[zero-public-automation-torrent] complete');
  } finally {
    // The exact freshly created test directory is disposable, never runtime data.
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);

async function checked(argv: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(argv, {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache', TMPDIR: SCRATCH },
  });
  const timeout = setTimeout(() => child.kill(), 120_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`Package automation proof failed (${code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}
