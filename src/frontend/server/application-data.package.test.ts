/** Fresh installed-package proof of the same public app-data API in all four modes. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('packed app-data facade works through public imports, managed Guardian and real Fabric actors', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'application-data-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  const repo = process.cwd();
  try {
    await mkdir(join(consumer, 'endpoints'), { recursive: true });
    // Release qualification can supply the exact Git-object-built candidate.
    // Ordinary source tests pack this checkout, still outside the repository.
    const suppliedArchive = process.env.ZERO_DATA_QUALIFICATION_ARCHIVE;
    if (suppliedArchive) await Bun.write(archive, Bun.file(suppliedArchive));
    else await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], repo);
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-application-data-public-proof', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    const fixture = join(repo, 'src/frontend/server/test-fixtures/application-data');
    for (const path of ['realm.ts', 'actor.ts', 'endpoints/proof.ts']) {
      const source = (await Bun.file(join(fixture, path)).text())
        .replaceAll("'../../../../databases/database-realm'", "'@zero/framework/server'")
        .replaceAll("'../../../../databases/database-actor-bootstrap'", "'@zero/framework/server'")
        .replaceAll("'../../../../server'", "'@zero/framework/server'");
      await Bun.write(join(consumer, path), source);
    }
    const proof = (await Bun.file(join(repo, 'src/frontend/server/application-data.integration.test.ts')).text())
      .replaceAll("'../../resources'", "'@zero/framework/server'")
      .replaceAll("'./app-factory'", "'@zero/framework/server'")
      .replaceAll('./test-fixtures/application-data/', './');
    await Bun.write(join(consumer, 'public-data.test.ts'), proof);
    await checked(['install', '--ignore-scripts'], consumer);
    const output = await checked(['test', 'public-data.test.ts'], consumer);
    expect(output).toContain('4 pass');
    expect(output).toContain('0 fail');
    const docs = await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/backend/fabric/application-client.md')).text();
    expect(docs).toContain('dataRealm');
    expect(docs).toContain('Shared-row multi-tenant');
  } finally {
    // Only this test's newly allocated consumer, archive and synthetic data.
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);

async function checked(args: string[], cwd: string): Promise<string> {
  const process_ = Bun.spawn([process.execPath, '--no-env-file', ...args], {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, PROJECT_SCRATCH_DIR: SCRATCH,
      BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' },
  });
  let expired = false;
  const timer = setTimeout(() => { expired = true; process_.kill(); }, 120_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(process_.stdout).text(), new Response(process_.stderr).text(), process_.exited,
    ]);
    if (expired || code !== 0) throw new Error(`Public data package proof failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout + stderr;
  } finally { clearTimeout(timer); }
}
