/** Native browser authoring against real isolated managed APIs and file/WAL actors, not mocked save handlers. */
import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../../frontend/server/app-factory';
import { defineZeroPlugin } from '../../frontend/server/server-extensions';
import { createClient } from '../../frontend/client/sdk';
import { createPublicBlogClient } from '../../frontend/client/blog-client';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';
import sharp from 'sharp';
import { buildBrowserFixture } from '../../test-support/build-browser-fixture';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
/** Observe accepted read state only; never replay an uncertain mutation. */
async function waitForAccepted<T>(read: () => Promise<T>, accepted: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const value = await read();
    if (accepted(value)) return value;
    if (Date.now() >= deadline) throw new Error('Synthetic publishing projection did not reach its accepted state.');
    await Bun.sleep(50);
  }
}
browserTest('writers manage taxonomy/media/bylines, compose, publish, inspect live observations and preserve dirty drafts through the real workspace', async () => {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-authoring-'); await mkdir(join(root, 'app'));
  await symlink(join(import.meta.dir, '../../../node_modules'), join(root, 'node_modules'), 'dir');
  const { script, css } = await buildBrowserFixture(join(import.meta.dir, 'blog-workspace.browser-fixture.tsx'));
  const app = await createApp({ projectRoot: root, db: { mode: 'file', path: join(root, 'app.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') }, tables: {},
    auth: { bootstrap: 'public' }, blog: { authors: { requireAvatar: false }, siteName: 'The editorial desk', content: { metrics: { enabled: true } } }, appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
    workflows: false, email: false, ai: false, vector: false, pdf: false, kv: false, stateSync: false, observability: { console: false, endpoint: false }, logging: false,
    serverExtensions: [defineZeroPlugin({ name: 'blog-test-editor', setup(context) {
      return context.app.get('/proof/editor', () => new Response(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${context.frontend.cssPath}"><link rel="stylesheet" href="/proof/editor.css"></head><body><div id="root"></div><script src="/proof/editor.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
        .get('/proof/editor.js', () => new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } })).get('/proof/editor.css', () => new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } }));
    } })],
  }).catch(error => {
    // Preserve the native failure and its compiler diagnostics in this isolated fixture.
    if (error instanceof Error && error.cause instanceof AggregateError) for (const diagnostic of error.cause.errors) console.error(diagnostic);
    throw error;
  });
  app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = 'http://127.0.0.1:' + app.server!.port;
  const client = createClient({ url: origin, auth: true, autoConnect: false });
  const lease = await acquirePlaywrightTestBrowser(), page = await lease.browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await client.register({ username: 'workspace-writer', email: 'workspace-writer@example.test', password: 'Synthetic-workspace-password-123' });
    const me = client.user!.userId;
    const response = await page.goto(origin + '/proof/editor'); expect(response?.status()).toBe(200);
    try { await page.waitForFunction(() => Boolean(document.getElementById('root')?.childElementCount), undefined, { timeout: 10000 }); }
    catch { throw new Error(JSON.stringify({ stage: 'synthetic-workspace-mount', errors, url: page.url(), rootCount: await page.locator('#root').count() })); }
    let failCapabilities = true;
    await page.route('**/api/blog/posts/config', route => failCapabilities ? route.fulfill({ status: 503, body: 'PRIVATE_CAPABILITY_DETAIL' }) : route.continue());
    await page.getByRole('button', { name: 'Open synthetic author workspace', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Publishing access could not be confirmed' }).waitFor();
    expect(await page.getByRole('button', { name: 'New article', exact: true }).count()).toBe(0);
    expect(await page.locator('body').textContent()).not.toContain('PRIVATE_CAPABILITY_DETAIL');
    failCapabilities = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText('No active author is in the loaded directory.', { exact: false }).waitFor();
    expect(await page.getByRole('button', { name: 'New article', exact: true }).isDisabled()).toBe(true);
    const assigned = await client.blog.authors.assign({ userId: me, expectedRevision: 0 });
    const profile = await client.blog.authors.updateProfile(me, { expectedRevision: assigned.revision, changes: { displayName: 'Editorial Writer', slug: 'editorial-writer', avatar: null } });
    await client.blog.authors.publishProfile(me, profile.revision);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('button')].some(button => button.textContent === 'New article' && !button.disabled));
    await page.getByText('Start your first article', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Categories and tags', exact: true }).click();
    await page.getByRole('button', { name: 'Add category or tag', exact: true }).click();
    const taxonomy = page.getByRole('dialog', { name: 'New taxonomy', exact: true });
    await taxonomy.getByLabel('Name', { exact: true }).fill('Garden notes');
    await taxonomy.getByLabel('Slug', { exact: true }).fill('garden-notes');
    await taxonomy.getByRole('button', { name: 'Save taxonomy', exact: true }).click();
    await taxonomy.waitFor({ state: 'detached' });
    const terms = await client.blog.taxonomies.list();
    expect(terms.items.map(term => term.slug)).toContain('garden-notes');
    await page.getByRole('button', { name: 'Articles', exact: true }).click();
    await page.getByRole('button', { name: 'New article', exact: true }).click();
    await page.getByLabel('Article title', { exact: true }).fill('An article from the editorial desk');
    await page.getByLabel('Permanent slug', { exact: true }).fill('editorial-desk');
    await page.getByRole('checkbox', { name: 'Garden notes', exact: true }).check();
    await page.locator('summary').filter({ hasText: /^Heading image$/ }).click();
    await page.getByRole('button', { name: 'Add heading image', exact: true }).click();
    let failMedia = true;
    await page.route('**/api/blog/media?*', route => failMedia ? route.fulfill({ status: 503, body: 'PRIVATE_MEDIA_DETAIL' }) : route.continue());
    await page.getByRole('button', { name: 'Choose image', exact: true }).click();
    const media = page.getByRole('dialog', { name: 'Image library', exact: true });
    await media.getByRole('alert').waitFor(); expect(await media.textContent()).not.toContain('PRIVATE_MEDIA_DETAIL');
    failMedia = false; await media.getByRole('button', { name: 'Retry', exact: true }).click(); await media.getByText('No media yet. Upload the first image.', { exact: true }).waitFor();
    expect(await media.getByRole('navigation', { name: 'Media pages', exact: true }).count()).toBe(0);
    const image = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#596d55' } }).png().toBuffer();
    await media.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'synthetic-garden.png', mimeType: 'image/png', buffer: image });
    await media.waitFor({ state: 'detached' });
    await page.getByLabel('Alternative text', { exact: true }).fill('A synthetic green garden image');
    await page.getByRole('button', { name: 'Edit paragraph 1', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Edit paragraph 1', exact: true }); await input.fill('A considered story with orchids and thoughtful details.');
    await input.press('ControlOrMeta+a');
    const bubble = page.locator('.zero-blog-selection-menu'); await bubble.waitFor(); await bubble.getByRole('button', { name: 'Bold', exact: true }).click();
    await bubble.getByRole('button', { name: 'Italic', exact: true }).click();
    await bubble.getByRole('button', { name: 'Inline code', exact: true }).click();
    await bubble.getByRole('button', { name: 'Add or edit link', exact: true }).click();
    await page.getByLabel('Link URL', { exact: true }).fill('javascript:alert(1)');
    expect(await page.getByRole('button', { name: 'Apply', exact: true }).isDisabled()).toBe(true);
    await page.getByLabel('Link URL', { exact: true }).fill('https://example.test/editorial-reference');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    const toolbar = page.locator('.zero-blog-editor > header');
    await toolbar.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved · revision 1 · draft' }).waitFor();
    const list = await client.blog.posts.list(), post = await client.blog.posts.get(list.items[0]!.id);
    expect(post.content.document.blocks[0]).toMatchObject({ type: 'paragraph', content: [{ text: 'A considered story with orchids and thoughtful details.', bold: true, italic: true, code: true, href: 'https://example.test/editorial-reference' }] });
    expect(post.content.categoryIds).toEqual([terms.items[0]!.id]);
    expect(post.content.featuredImage).toMatchObject({ alt: 'A synthetic green garden image' });
    expect((await client.blog.media.list()).items[0]).toMatchObject({ state: 'ready', mimeType: 'image/webp', width: 120, height: 80 });
    let failHistory = true;
    await page.route('**/api/blog/posts/*/revisions?*', route => failHistory ? route.fulfill({ status: 503, body: 'PRIVATE_HISTORY_DETAIL' }) : route.continue());
    await toolbar.getByRole('button', { name: 'History', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Article revision history', exact: true });
    await history.getByRole('alert').waitFor(); expect(await history.textContent()).not.toContain('PRIVATE_HISTORY_DETAIL');
    failHistory = false; await history.getByRole('button', { name: 'Try again', exact: true }).click(); await history.getByText('Revision 1 · create', { exact: true }).waitFor();
    expect(await history.getByRole('navigation', { name: 'Revision pages', exact: true }).count()).toBe(0);
    await page.keyboard.press('Escape'); await history.waitFor({ state: 'detached' });
    await toolbar.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Publish this article?', exact: true }).getByRole('button', { name: 'Publish article', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Article published.' }).waitFor();
    expect((await fetch(origin + '/blog/editorial-desk')).status).toBe(200);
    const reader = await lease.browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1200, height: 900 } });
    try {
      await reader.goto(origin + '/blog/editorial-desk');
      const publishedImage = reader.getByRole('img', { name: 'A synthetic green garden image', exact: true }).first();
      await publishedImage.waitFor();
      await publishedImage.evaluate(image => new Promise<void>((resolve, reject) => {
        const element = image as HTMLImageElement;
        if (element.complete) return element.naturalWidth > 0 ? resolve() : reject(new Error('Synthetic published image did not decode.'));
        element.onload = () => resolve(); element.onerror = () => reject(new Error('Synthetic published image failed.'));
      }));
      expect(await waitForAccepted(async () => (await client.blog.metrics.page({ postId: post.id })).items[0]?.views ?? 0, views => views === 1)).toBe(1);
    } finally { await reader.close(); }
    await page.getByLabel('Article title', { exact: true }).fill('Unsaved local title');
    await page.getByRole('button', { name: 'Interrupt synthetic publishing stream', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Publishing access could not be confirmed' }).waitFor();
    expect(await page.getByLabel('Article title', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Save draft', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Restore synthetic publishing transport', exact: true }).click();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByLabel('Article title', { exact: true }).waitFor();
    expect(await page.getByLabel('Article title', { exact: true }).inputValue()).toBe('Unsaved local title');
    expect((await client.blog.posts.get(post.id)).content.title).toBe('An article from the editorial desk');
    await page.getByRole('button', { name: 'All articles', exact: true }).click();
    const leave = page.getByRole('alertdialog', { name: 'Save your changes?', exact: true }); await leave.waitFor();
    await leave.getByRole('button', { name: 'Stay', exact: true }).click(); await leave.waitFor({ state: 'detached' });
    expect(await page.getByLabel('Article title', { exact: true }).inputValue()).toBe('Unsaved local title');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByLabel('Article title', { exact: true }).focus();
    expect(await page.getByLabel('Article title', { exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1050 });
    const current = await client.blog.posts.get(post.id);
    await client.blog.posts.update(post.id, current.revision, { ...current.content, excerpt: 'A competing accepted revision.' }, { requestId: 'other-session-edit' });
    await page.getByText('A newer stored revision is available. Your local text has not been overwritten.', { exact: true }).waitFor();
    expect(await page.getByLabel('Article title', { exact: true }).inputValue()).toBe('Unsaved local title');
    const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing'; await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'editor-conflict-awareness.png'), fullPage: true });
    await page.getByRole('button', { name: 'All articles', exact: true }).click(); await leave.waitFor(); await leave.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.getByRole('heading', { name: 'The editorial desk', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Authors and profiles', exact: true }).click();
    await page.getByText('Editorial Writer', { exact: true }).click();
    const byline = page.getByRole('dialog', { name: 'Public author profile', exact: true });
    await byline.getByLabel('Byline', { exact: true }).fill('Editor of garden stories');
    await byline.getByRole('button', { name: 'Save profile draft', exact: true }).click();
    await byline.getByRole('button', { name: 'Publish public byline', exact: true }).waitFor({ state: 'visible' });
    await byline.getByRole('button', { name: 'Publish public byline', exact: true }).click();
    expect(await waitForAccepted(async () => (await createPublicBlogClient(origin).author('blog', 'editorial-writer')).byline,
      value => value === 'Editor of garden stories')).toBe('Editor of garden stories');
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .some(button => button.textContent === 'Inspect stored profile' && !button.disabled));
    await page.keyboard.press('Escape'); await byline.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Observations', exact: true }).click();
    const observations = page.getByRole('region', { name: 'Article observations', exact: true });
    await observations.getByRole('columnheader', { name: 'View observations', exact: false }).waitFor();
    await observations.getByText(post.id, { exact: true }).waitFor();
    expect(errors).toEqual([]);
  } catch (cause) {
    const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing';
    await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'editor-acceptance-failure.png'), fullPage: true });
    throw cause;
  } finally { client.disconnect(); await page.close(); lease.release(); await app.stop(true); }
}, 180000);
