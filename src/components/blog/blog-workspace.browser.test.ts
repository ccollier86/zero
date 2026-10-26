/** Native browser authoring against real isolated managed APIs and file/WAL actors, not mocked save handlers. */
import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../../frontend/server/app-factory';
import { defineZeroPlugin } from '../../frontend/server/server-extensions';
import { createClient } from '../../frontend/client/sdk';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
browserTest('writers compose, format, save, publish and protect dirty drafts through the real workspace', async () => {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-authoring-'); await mkdir(join(root, 'app'));
  await symlink(join(import.meta.dir, '../../../node_modules'), join(root, 'node_modules'), 'dir');
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'blog-workspace.browser-fixture.tsx')], target: 'browser', format: 'iife' });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  const script = await build.outputs.find(file => file.path.endsWith('.js'))!.text();
  const css = (await Promise.all(build.outputs.filter(file => file.path.endsWith('.css')).map(file => file.text()))).join('\n');
  const app = await createApp({ projectRoot: root, db: { mode: 'file', path: join(root, 'app.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') }, tables: {},
    auth: { bootstrap: 'public' }, blog: { authors: { requireAvatar: false }, siteName: 'The editorial desk' }, appDir: 'app', outDir: 'out', generatedDir: 'generated', storageDir: 'storage',
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
    workflows: false, email: false, ai: false, vector: false, pdf: false, kv: false, stateSync: false, observability: { console: false, endpoint: false }, logging: false,
    serverExtensions: [defineZeroPlugin({ name: 'blog-test-editor', setup(context) {
      return context.app.get('/proof/editor', () => new Response(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${context.frontend.cssPath}"><link rel="stylesheet" href="/proof/editor.css"></head><body><div id="root"></div><script src="/proof/editor.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
        .get('/proof/editor.js', () => new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } })).get('/proof/editor.css', () => new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } }));
    } })],
  });
  app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = 'http://127.0.0.1:' + app.server!.port;
  const client = createClient({ url: origin, auth: true, autoConnect: false });
  const lease = await acquirePlaywrightTestBrowser(), page = await lease.browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1050 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await client.register({ username: 'workspace-writer', email: 'workspace-writer@example.test', password: 'Synthetic-workspace-password-123' });
    const me = client.user!.userId, assigned = await client.blog.authors.assign({ userId: me, expectedRevision: 0 });
    const profile = await client.blog.authors.updateProfile(me, { expectedRevision: assigned.revision, changes: { displayName: 'Editorial Writer', slug: 'editorial-writer', avatar: null } });
    await client.blog.authors.publishProfile(me, profile.revision);
    const response = await page.goto(origin + '/proof/editor'); expect(response?.status()).toBe(200);
    try { await page.waitForFunction(() => Boolean(document.getElementById('root')?.childElementCount), undefined, { timeout: 10000 }); }
    catch { throw new Error(JSON.stringify({ stage: 'synthetic-workspace-mount', errors, url: page.url(), rootCount: await page.locator('#root').count() })); }
    await page.getByRole('button', { name: 'Open synthetic author workspace', exact: true }).click();
    await page.getByRole('button', { name: 'New article', exact: true }).click();
    await page.getByLabel('Article title', { exact: true }).fill('An article from the editorial desk');
    await page.getByLabel('Permanent slug', { exact: true }).fill('editorial-desk');
    await page.getByRole('button', { name: 'Edit paragraph 1', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Edit paragraph 1', exact: true }); await input.fill('A considered story with orchids and thoughtful details.');
    await input.press('ControlOrMeta+a');
    const bubble = page.locator('.zero-blog-selection-menu'); await bubble.waitFor(); await bubble.getByRole('button', { name: 'Bold', exact: true }).click();
    await bubble.getByRole('button', { name: 'Italic', exact: true }).click();
    await bubble.getByRole('button', { name: 'Inline code', exact: true }).click();
    const toolbar = page.locator('.zero-blog-editor > header');
    await toolbar.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved · revision 1 · draft' }).waitFor();
    const list = await client.blog.posts.list(), post = await client.blog.posts.get(list.items[0]!.id);
    expect(post.content.document.blocks[0]).toMatchObject({ type: 'paragraph', content: [{ text: 'A considered story with orchids and thoughtful details.', bold: true, italic: true, code: true }] });
    await toolbar.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Publish this article?', exact: true }).getByRole('button', { name: 'Publish article', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Article published.' }).waitFor();
    expect((await fetch(origin + '/blog/editorial-desk')).status).toBe(200);
    await page.getByLabel('Article title', { exact: true }).fill('Unsaved local title');
    await page.getByRole('button', { name: 'All articles', exact: true }).click();
    const leave = page.getByRole('alertdialog', { name: 'Save your changes?', exact: true }); await leave.waitFor();
    await leave.getByRole('button', { name: 'Stay', exact: true }).click(); await leave.waitFor({ state: 'detached' });
    expect(await page.getByLabel('Article title', { exact: true }).inputValue()).toBe('Unsaved local title');
    const current = await client.blog.posts.get(post.id);
    await client.blog.posts.update(post.id, current.revision, { ...current.content, excerpt: 'A competing accepted revision.' }, { requestId: 'other-session-edit' });
    await page.getByText('A newer stored revision is available. Your local text has not been overwritten.', { exact: true }).waitFor();
    expect(await page.getByLabel('Article title', { exact: true }).inputValue()).toBe('Unsaved local title');
    const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing'; await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'editor-conflict-awareness.png'), fullPage: true });
    await page.getByRole('button', { name: 'All articles', exact: true }).click(); await leave.waitFor(); await leave.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.getByRole('heading', { name: 'The editorial desk', exact: true }).waitFor();
    expect(errors).toEqual([]);
  } finally { client.disconnect(); await page.close(); lease.release(); await app.stop(true); }
}, 180000);
