/** Installs the packed public API without this repository's TypeScript aliases or backend services. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
test('packed blog and general command palette expose defaults, CSS and portable SSR/browser imports', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'blog-package-'));
  const consumer = join(root, 'consumer'), archive = process.env.ZERO_BLOG_PACKAGE_ARCHIVE ?? join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    if (process.env.ZERO_BLOG_PACKAGE_ARCHIVE) {
      if (!await Bun.file(archive).exists()) throw new Error('The supplied blog qualification archive does not exist.');
    } else await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-blog-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await checked(['install', '--ignore-scripts', '--backend=hardlink'], consumer, 180_000);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as {
      exported: number; browserBytes: number; css: string; html: string; docs: boolean;
    };
    expect(result.exported).toBe(12); expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.css).toContain('--zero-blog-type-prose'); expect(result.css).toContain('--zero-command-palette-width');
    expect(result.css).toContain('[data-variant="editorial"]');
    expect(result.html).toContain('data-variant="magazine"'); expect(result.html).toContain('data-variant="with-sidebar"');
    expect(result.html).toContain('href="/journal/welcome"'); expect(result.html).toContain('Readable without JavaScript.');
    expect(result.html).toContain('href="#introduction-1"'); expect(result.html).not.toContain('Share this article');
    expect(result.docs).toBe(true);
  } finally {
    // Only the disposable consumer and archive allocated by this test are removed.
    await rm(root, { recursive: true, force: true });
  }
}, 300_000);

async function checked(arguments_: string[], cwd: string, timeoutMs = 90_000): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...arguments_], {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' },
  });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (expired || code !== 0) throw new Error(`Blog package consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as Blog from '@zero/framework/blog';
import * as Alias from '@zero/framework/components/blog';
import * as Commands from '@zero/framework/components/command-palette';
import type { BlogPost } from '@zero/framework/blog';
const exported = ['BlogProvider', 'BlogListPage', 'BlogPostPage', 'BlogHero',
  'BlogCard', 'BlogCardGrid', 'BlogSearchPalette', 'BlogPagination', 'BlogImageLightbox'] as const;
for (const name of exported) {
  if (typeof Blog[name] !== 'function' || Blog[name] !== Root[name] || Blog[name] !== Alias[name]) throw new Error('Missing Blog export: ' + name);
}
for (const name of ['CommandPalette', 'CommandPaletteTrigger', 'filterCommandPaletteItems'] as const) {
  if (typeof Commands[name] !== 'function' || Commands[name] !== Root[name]) throw new Error('Missing command export: ' + name);
}
export const exportedCount = exported.length + 3;
const post: BlogPost = { id: 'welcome', slug: 'welcome', title: 'Welcome', blocks: [
  { type: 'heading', text: 'Introduction', level: 2 }, { type: 'paragraph', text: 'Readable without JavaScript.' },
] };
export function Consumer() {
  return <Blog.BlogProvider baseUrl="/journal"><Blog.BlogListPage posts={[post]} />
    <Blog.BlogPostPage post={post} /><Blog.BlogPagination currentPage={1} totalPages={4} />
    <Commands.CommandPalette title="Commands" items={[]} />
  </Blog.BlogProvider>;
}
`;
const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Consumer, exportedCount } from './consumer';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
const css = (await Promise.all(build.outputs.filter(item => item.path.endsWith('.css')).map(item => item.text()))).join('\\n');
const docsRoot = './node_modules/@zero/framework/docs-next/';
const docs = await Bun.file(docsRoot + 'frontend/components/public-pages/blog/index.md').exists()
  && await Bun.file(docsRoot + 'frontend/components/controls/command-palette.md').exists();
console.log(JSON.stringify({ exported: exportedCount, browserBytes: build.outputs.reduce((sum, item) => sum + item.size, 0), css, docs, html: renderToString(React.createElement(Consumer)) }));
`;
