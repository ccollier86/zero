/** Canonical publishing projection must preserve formatting, privacy and script-data safety. */
import { test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { presentBlogDocument, presentBlogAuthor } from './presentation';
import { BlockRenderer } from '../components/blog/blog-blocks';
import { serializeBlogPage, type BlogPublicPageModel } from './public-page-model';
import { resolveConfig } from '../frontend/server/types';
import { discoverAppServerExtensions } from '../frontend/server/app-build';
import { assertPluginBuildRouteOwnership } from '../frontend/server/server-plugin-build-route-ownership';
import { mkdtemp, mkdir } from 'node:fs/promises';

test('public projection preserves safe formatting, image alternatives and stable heading anchors without HTML injection', () => {
  const blocks = presentBlogDocument({ version: 1, blocks: [
    { id: 'heading-identity', type: 'heading', level: 2, content: [{ text: '<script>escaped</script>', bold: true, href: '/safe' }] },
    { id: 'body', type: 'paragraph', content: [{ text: ' thoughtful ', italic: true }, { text: 'link', href: 'javascript:alert(1)' }] },
    { id: 'art', type: 'image', image: { mediaId: 'm1', alt: 'Sunlight over the field' } },
  ] }, id => '/accepted/' + id);
  const html = renderToStaticMarkup(<BlockRenderer blocks={blocks} />);
  expect(html).toContain('id="heading-identity"'); expect(html).toContain('<strong>&lt;script&gt;escaped&lt;/script&gt;</strong>');
  expect(html).toContain(' thoughtful '); expect(html).toContain('href="/safe"'); expect(html).not.toContain('href="javascript:');
  expect(html).toContain('alt="Sunlight over the field"');
  expect(presentBlogAuthor({ id: 'writer', name: 'Approved name' })).toEqual({ id: 'writer', name: 'Approved name' });
});
test('public JSON data cannot terminate its non-executable script element', () => {
  const encoded = serializeBlogPage({ siteName: '</script><script>alert(1)</script>\u2028' } as BlogPublicPageModel);
  expect(encoded).not.toContain('<'); expect(encoded).not.toContain('\u2028'); expect(JSON.parse(encoded).siteName).toBe('</script><script>alert(1)</script>\u2028');
});
test('managed page discovery is additive, headless is explicit, and app route collisions fail before a database opens', async () => {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-mount-');
  const config = resolveConfig({ projectRoot: root, db: { mode: 'memory' }, tables: {}, blog: true,
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false });
  const plugins = await discoverAppServerExtensions(config);
  expect(plugins).toHaveLength(1); expect((plugins[0] as { name: string }).name).toBe('zero-blog-pages');
  expect(resolveConfig({ db: { mode: 'memory' }, blog: { pages: false }, tables: {} }).blog.pages).toBe(false);
  expect(resolveConfig({ db: { mode: 'memory' }, blog: { content: false }, tables: {} }).blog.pages).toBe(false);
  await mkdir(config.appDir + '/blog', { recursive: true });
  await Bun.write(config.appDir + '/blog/page.tsx', 'export default function Page(){return null;}');
  expect(() => assertPluginBuildRouteOwnership(config.appDir, plugins as never)).toThrow('conflicts with an application page');
});
