/** Real managed build, SSR, browser hydration and native publishing. Only isolated synthetic files and identities. */
import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../frontend/server/app-factory';
import { createClient } from '../frontend/client/sdk';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../test-support/playwright-test-browser';
import type { BlogPostContent } from './content-types';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
browserTest('published SSR, real remote search, private drafts, noindex, old slugs and withdrawal work in the actual reader', async () => {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-reader-');
  await mkdir(join(root, 'app'));
  await symlink(join(import.meta.dir, '../../node_modules'), join(root, 'node_modules'), 'dir');
  const app = await createApp({ projectRoot: root, db: { mode: 'file', path: join(root, 'app.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') }, tables: {},
    auth: { bootstrap: 'public' }, blog: { authors: { requireAvatar: false }, siteName: 'A considered journal' },
    app: { name: 'Synthetic journal', publicUrl: 'https://journal.example.test' }, seo: { indexing: true }, sitemap: true,
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
    workflows: false, email: false, ai: false, vector: false, pdf: false, kv: false, stateSync: false,
    observability: { console: false, endpoint: false }, logging: false });
  app.listen({ hostname: '127.0.0.1', port: 0 });
  const origin = 'http://127.0.0.1:' + app.server!.port;
  const client = createClient({ url: origin, auth: true, autoConnect: false });
  const lease = await acquirePlaywrightTestBrowser(), page = await lease.browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1440, height: 960 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await client.register({ username: 'public-writer', email: 'public-writer@example.test', password: 'Synthetic-reader-password-123' });
    const me = client.user!.userId, assigned = await client.blog.authors.assign({ userId: me, expectedRevision: 0 });
    const profile = await client.blog.authors.updateProfile(me, { expectedRevision: assigned.revision, changes: { displayName: 'Approved Writer', slug: 'public-writer', avatar: null } });
    await client.blog.authors.publishProfile(me, profile.revision);
    const content: BlogPostContent = { title: 'A beautiful publishing experience', slug: 'beautiful-publishing', authorId: assigned.id, excerpt: 'Purposeful words and thoughtful details.', featuredImage: null, categoryIds: [], tagIds: [],
      seo: { title: 'Thoughtful publishing', description: 'An approved public description.', noIndex: false, socialImage: null }, document: { version: 1, blocks: [
        { id: 'introduction', type: 'heading', level: 2, content: [{ text: 'An enduring introduction' }] },
        { id: 'p1', type: 'paragraph', content: [{ text: 'Distinctive orchids ', bold: true }, { text: 'connect', href: 'https://example.test/flowers' }, { text: ' useful ideas.' }] },
      ] } };
    const draft = await client.blog.posts.create(content, { requestId: 'browser-create' });
    expect((await fetch(origin + '/blog/' + content.slug)).status).toBe(404);
    let published = await client.blog.posts.publish(draft.id, draft.revision, { requestId: 'browser-publish' });
    const ssr = await fetch(origin + '/blog/' + content.slug), html = await ssr.text();
    expect(ssr.status).toBe(200); expect(html).toContain('<strong>Distinctive orchids </strong>'); expect(html).toContain('zero-blog-toc-sidebar');
    expect(html).toContain('https://journal.example.test/blog/beautiful-publishing'); expect(html).toContain('BlogPosting'); expect(html).toContain('Thoughtful publishing');
    await page.goto(origin + '/blog');
    await page.getByRole('heading', { name: 'A considered journal', exact: true }).waitFor();
    expect(await page.locator('.zero-blog-list').getAttribute('data-variant')).toBe('magazine');
    await page.getByRole('button', { name: 'Search articles', exact: true }).click();
    const palette = page.getByRole('dialog', { name: 'Search articles', exact: true }); await palette.waitFor();
    await palette.getByRole('combobox').fill('orchid');
    await palette.getByRole('option', { name: 'A beautiful publishing experience Purposeful words and thoughtful details.', exact: true }).waitFor();
    await palette.getByRole('combobox').press('Enter'); await page.waitForURL(origin + '/blog/beautiful-publishing');
    await page.getByRole('heading', { name: 'An enduring introduction', exact: true }).waitFor();
    expect(await page.locator('.zero-blog-post').getAttribute('data-variant')).toBe('with-sidebar');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing'; await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'published-reader.png'), fullPage: true });
    published = await client.blog.posts.update(draft.id, published.revision, { ...content, title: 'PRIVATE DRAFT MUST NOT APPEAR' }, { requestId: 'browser-private' });
    await page.reload(); expect(await page.getByRole('heading', { name: 'A beautiful publishing experience', exact: true }).count()).toBe(1);
    const search = await fetch(origin + '/blog?search=orchid'); expect(search.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(await search.text()).toContain('A beautiful publishing experience');
    expect(await (await fetch(origin + '/sitemap.xml')).text()).toContain('/blog/beautiful-publishing');
    const renamed = await client.blog.posts.update(draft.id, published.revision, { ...content, slug: 'renamed-article', seo: { ...content.seo, noIndex: true } }, { requestId: 'browser-rename' });
    published = await client.blog.posts.publish(draft.id, renamed.revision, { requestId: 'browser-republish' });
    expect((await fetch(origin + '/blog/beautiful-publishing', { redirect: 'manual' })).headers.get('Location')).toBe('/blog/renamed-article');
    expect(await (await fetch(origin + '/sitemap.xml')).text()).not.toContain('/blog/renamed-article');
    await client.blog.posts.withdraw(draft.id, published.revision, { requestId: 'browser-withdraw' });
    expect((await fetch(origin + '/blog/renamed-article')).status).toBe(404);
    expect(errors).toEqual([]);
  } finally { client.disconnect(); await page.close(); lease.release(); await app.stop(true); }
}, 180000);
