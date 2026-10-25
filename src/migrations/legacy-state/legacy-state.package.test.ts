/** Verify real packed public exports, preservation/runtime behavior and packaged docs. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('installed legacy-state archive preserves the admitted profile using public migration and managed service imports', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'legacy-state-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz'), repo = process.cwd();
  try {
    await mkdir(consumer);
    const supplied = process.env.ZERO_LEGACY_QUALIFICATION_ARCHIVE;
    if (supplied) await Bun.write(archive, Bun.file(supplied));
    else await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], repo);
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-legacy-state-public-proof', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    for (const file of ['test-support.ts', 'legacy-state.test.ts', 'legacy-state-runtime.integration.test.ts']) {
      const source = (await Bun.file(join(repo, 'src/migrations/legacy-state', file)).text())
        .replaceAll("'../index'", "'@zero/framework/migrations'")
        .replaceAll("'../../frontend/server'", "'@zero/framework/server'")
        .replaceAll("'./files'", "'./test-support'");
      await Bun.write(join(consumer, file), source);
    }
    await checked(['install', '--ignore-scripts'], consumer);
    const output = await checked(['test', 'legacy-state.test.ts', 'legacy-state-runtime.integration.test.ts'], consumer);
    expect(output).toContain('8 pass'); expect(output).toContain('0 fail');
    const docs = await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/backend/migrations/legacy-state.md')).text();
    expect(docs).toContain('@zero/framework/migrations');
    expect(docs).toContain('WORKFLOW_LEGACY_MIGRATION_REQUIRED');
    expect(docs).toContain('requiresApplicationAcceptance: true');
    const handoff = await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/guides/practiceiq-upgrade/agent-handoff.md')).text();
    expect(handoff).toContain('verifyStagedLegacyStateMigration');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 240_000);

async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], {
    cwd, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH,
      TMPDIR: SCRATCH, PROJECT_SCRATCH_DIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' },
  });
  let expired = false;
  const timer = setTimeout(() => { expired = true; child.kill(); }, 150_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (expired || code !== 0) throw new Error(`Synthetic public migration proof failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout + stderr;
  } finally { clearTimeout(timer); }
}
