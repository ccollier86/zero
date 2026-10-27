/** Frozen installed-package publishing acceptance. Only fresh synthetic files; normal official build and retained matching-package actors. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PUBLISHING_FIXTURE_FILES } from './test-fixtures/publishing/fixture-files';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
test('installed publishing survives source setup, official bundle and restart with strict audit and native media', async () => {
  const root = await mkdtemp(join(scratch, 'blog-publishing-package-')), consumer = join(root, 'consumer');
  const archive = process.env.ZERO_BLOG_PUBLISHING_ARCHIVE ?? join(root, 'framework.tgz');
  try {
    await mkdir(join(consumer, 'app'), { recursive: true }); await mkdir(join(consumer, 'server'));
    if (!process.env.ZERO_BLOG_PUBLISHING_ARCHIVE) await run(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-blog-publishing-consumer', private: true, type: 'module', dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' } }));
    const fixtures = join(import.meta.dir, 'test-fixtures/publishing');
    for (const [source, target] of PUBLISHING_FIXTURE_FILES) {
      await Bun.write(join(consumer, target!), Bun.file(join(fixtures, source!)));
    }
    await Bun.write(join(consumer, '.env'), 'ZERO_SYNTHETIC_DOTENV_SECRET=fixture-only\n');
    await run(['install', '--ignore-scripts', '--backend=hardlink'], consumer);
    const output = await run(['qualify.ts'], consumer);
    expect(output).toContain('"publishingQualified":true'); expect(output).toContain('"generations":2');
    await Bun.write(join(consumer, 'editor.ts'), "export { BlogWorkspace, BlogDocumentEditor } from '@zero/framework/blog';");
    const bundle = await run(['build', 'editor.ts', '--target=browser', '--outdir', join(root, 'editor-build')], consumer);
    expect(bundle).not.toContain('error:');
    const editor = await Bun.file(join(root, 'editor-build/editor.js')).text(); expect(editor).not.toContain('bun:sqlite');
    expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/backend/blog/publishing-api.md')).exists()).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 420000);

async function run(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH, TMPDIR: scratch, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  const timer = setTimeout(() => child.kill(), 240000);
  try { const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Installed publishing qualification failed (${code}):\n${stdout}\n${stderr}`); return stdout + '\n' + stderr;
  } finally { clearTimeout(timer); }
}
