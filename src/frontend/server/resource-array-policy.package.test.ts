/** Fresh package consumer qualification; never opens or edits a live application's data. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('installed public resource array policies survive gateway and reader/writer actor boundaries', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'resource-array-package-'));
  const consumer = join(root, 'consumer');
  try {
    await mkdir(join(consumer, 'app'), { recursive: true });
    await mkdir(join(consumer, 'routes'), { recursive: true });
    const archive = join(root, 'framework.tgz');
    await checked([process.execPath, '--no-env-file', 'pm', 'pack', '--filename', archive, '--ignore-scripts', '--quiet'], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-resource-array-public-proof', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    const fixtures = join(import.meta.dir, 'test-fixtures');
    for (const [source, destination] of [
      ['resource-array-realm.fixture.ts', 'resource-array-realm.fixture.ts'],
      ['resource-array-gateway.fixture.ts', 'gateway.ts'],
      ['resource-array-endpoint.fixture.ts', 'routes/arrays.ts'],
      ['fabric-sync-metadata-page.fixture.tsx', 'app/page.tsx'],
    ]) await Bun.write(join(consumer, destination!), Bun.file(join(fixtures, source!)));
    await checked([process.execPath, '--no-env-file', 'install', '--ignore-scripts'], consumer);
    const installed = join(consumer, 'node_modules/@zero/framework');
    expect(await Bun.file(join(installed, 'docs/start-here.md')).text()).toContain('../docs-next/start-here.md');
    expect(await Bun.file(join(installed, 'llms.txt')).text()).toContain('docs-next/start-here.md');
    expect(await Bun.file(join(installed, 'docs-next/backend/resources/array-overlap.md')).exists()).toBe(true);
    const output = await checked([process.execPath, '--no-env-file', 'gateway.ts'], consumer);
    expect(output).toContain('[zero-public-resource-array] complete');
  } finally {
    // Only this test's fresh, exact mkdtemp path is disposable.
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
    if (code !== 0) throw new Error(`Package array proof failed (${code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally {
    clearTimeout(timeout);
  }
}
