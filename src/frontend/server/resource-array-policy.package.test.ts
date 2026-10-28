/** Fresh package consumer qualification; never opens or edits a live application's data. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const consumers = new Map<string, (name: string) => void>();
// An awaited, independently bounded retirement phase does not extend the
// unchanged 180s functional/120s gateway budgets. Failure still fails this file.
afterAll(async () => {
  for (const [root, stage] of consumers) {
    stage('cleanup');
    await rm(root, { recursive: true, force: true });
    consumers.delete(root);
    stage('retired');
  }
}, 120_000);

test('installed public resource array policies survive gateway and reader/writer actor boundaries', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'resource-array-package-'));
  const consumer = join(root, 'consumer');
  const started = performance.now();
  const stage = (name: string) => console.info('Resource array package stage', { stage: name, elapsedMs: Math.round(performance.now() - started) });
  consumers.set(root, stage);
  try {
    await mkdir(join(consumer, 'app'), { recursive: true });
    await mkdir(join(consumer, 'routes'), { recursive: true });
    const archive = join(root, 'framework.tgz');
    stage('pack');
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
    stage('install');
    await checked([process.execPath, '--no-env-file', 'install', '--ignore-scripts'], consumer);
    const installed = join(consumer, 'node_modules/@zero/framework');
    expect(await Bun.file(join(installed, 'docs/start-here.md')).text()).toContain('../docs-next/start-here.md');
    expect(await Bun.file(join(installed, 'llms.txt')).text()).toContain('docs-next/start-here.md');
    expect(await Bun.file(join(installed, 'docs-next/backend/resources/array-overlap.md')).exists()).toBe(true);
    stage('gateway');
    const output = await checked([process.execPath, '--no-env-file', 'gateway.ts'], consumer);
    expect(output).toContain('[zero-public-resource-array] complete');
    stage('assertions-complete');
  } finally {
    stage('functional-phase-ended');
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
