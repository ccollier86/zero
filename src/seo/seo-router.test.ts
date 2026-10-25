/** Real HTTP rendering without an app database, provider calls or user content. */
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouterPlugin } from '../frontend/server/router-plugin';
import { resolveConfig } from '../frontend/server/types';
import { createSeoRuntime, resolveSeoConfig } from './runtime';

async function fixture(files: Record<string, string>, preview = false) {
  const root = await mkdtemp(join(process.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'seo-router-'));
  for (const [path, contents] of Object.entries(files)) { const file = join(root, path); await mkdir(join(file, '..'), { recursive: true }); await Bun.write(file, contents); }
  const seo = createSeoRuntime(resolveSeoConfig({ title: 'Site', titleTemplate: '%s · Site', description: 'Site description', indexing: !preview }, 'https://public.example'), 'https://public.example');
  const app = createRouterPlugin({ appDir: root, seo, clientEntry: '/_build/client.js', sitemap: {
    config: { path: '/sitemap.xml', entries: [{ href: '/private' }, { href: '/hidden' }, { href: '/posts/public' }], exclude: [] }, publicUrl: 'https://public.example', routeAuth: 'explicit', publicPaths: [],
  } });
  return { app, seo, close: () => rm(root, { recursive: true, force: true }) };
}

test('SSR and client shells share inherited metadata, with correct robots on an ISR hit', async () => {
  const f = await fixture({ 'layout.ts': "export const meta={openGraph:{siteName:'Site'}};export default function Layout({children}){return children}",
    'page.ts': "export const config={revalidate:60};export const meta=async()=>({title:'Home',robots:{noarchive:true},jsonLd:{'@context':'https://schema.org','@type':'WebPage',name:'Home'}});export default function Page(){return 'Useful SSR'}",
    'client/page.ts': "'use client';export const meta={title:'Client',canonical:'/client'};export default function Page(){return null}" });
  try {
    const first = await f.app.handle(new Request('https://spoofed.example/?tracking=discarded'));
    const firstHtml = await first.text(); expect(first.status).toBe(200);
    expect(firstHtml).toContain('Useful SSR'); expect(firstHtml).toContain('<title>Home · Site</title>');
    expect(firstHtml).toContain('rel="canonical" href="https://public.example/"');
    expect(firstHtml).toContain('property="og:site_name" content="Site"'); expect(firstHtml).toContain('application/ld+json');
    expect(firstHtml).not.toContain('spoofed.example'); expect(firstHtml).not.toContain('tracking=');
    const cached = await f.app.handle(new Request('https://spoofed.example/?tracking=discarded'));
    expect(cached.headers.get('X-Cache')).toBe('HIT'); expect(cached.headers.get('X-Robots-Tag')).toBe('index, follow, noarchive');
    expect(await cached.text()).toBe(firstHtml);
    const client = await f.app.handle(new Request('https://spoofed.example/client'));
    const clientHtml = await client.text(); expect(client.status).toBe(200);
    expect(clientHtml).toContain('<title>Client · Site</title>'); expect(clientHtml).toContain('property="og:site_name"');
    expect(clientHtml).toContain('https://public.example/client'); expect(clientHtml).toContain('__ROUTE_DATA__');
    const robots = await f.app.handle(new Request('https://spoofed.example/robots.txt'));
    expect(robots.headers.get('Content-Type')).toContain('text/plain'); expect(await robots.text()).toContain('Sitemap: https://public.example/sitemap.xml');
  } finally { await f.close(); }
});

test('sitemap manual entries cannot reintroduce protected/noindex pages and dynamic canonicals are honored', async () => {
  const f = await fixture({ 'page.ts': "export default function Page(){return 'Home'}",
    'private/page.ts': "export const config={auth:'required'};export default function Page(){return 'PRIVATE'}",
    'hidden/page.ts': "export const meta={robots:{index:false}};export default function Page(){return 'HIDDEN'}",
    'posts/[slug]/page.ts': "export const meta=params=>({canonical:'/articles/'+params.slug});export default function Page(){return 'Post'}" });
  try {
    f.seo.registerSitemap('docs', () => [{ href: '/docs' }, { href: '/docs/guide' }]);
    const response = await f.app.handle(new Request('https://request.example/sitemap.xml')), xml = await response.text();
    expect(response.status).toBe(200); expect(xml).toContain('https://public.example/articles/public');
    expect(xml).toContain('https://public.example/docs/guide'); expect(xml).not.toContain('/private'); expect(xml).not.toContain('/hidden');
    f.seo.registerSitemap('broken', () => { throw new Error('PRIVATE_PROVIDER_ERROR'); });
    const broken = await f.app.handle(new Request('https://request.example/sitemap.xml'));
    expect(broken.status).toBe(503); expect(await broken.text()).toBe('Sitemap unavailable.');
  } finally { await f.close(); }
});

test('preview indexing policy reaches HTML and discovery, and normal config keeps SEO opt-in', async () => {
  const f = await fixture({ 'page.ts': "export const meta={robots:{index:true}};export default function Page(){return 'Preview'}" }, true);
  try {
    const response = await f.app.handle(new Request('https://request.example/'));
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow'); expect(await response.text()).toContain('content="noindex, nofollow"');
    expect(await (await f.app.handle(new Request('https://request.example/sitemap.xml'))).text()).not.toContain('<loc>');
    const base = { db: { mode: 'ephemeral' as const }, tables: {}, auth: false as const, ai: false as const, vector: false as const, pdf: false as const };
    expect(resolveConfig(base).seo).toBe(false);
    expect(resolveConfig(base).sitemap).toBe(false);
    const enabled = resolveConfig({ ...base, app: { publicUrl: 'https://public.example' }, seo: { title: 'Site' } });
    expect(enabled.sitemap && enabled.sitemap.path).toBe('/sitemap.xml');
    expect(resolveConfig({ ...base, seo: {}, sitemap: false }).sitemap).toBe(false);
    expect(resolveConfig({ ...base, seo: {} }).sitemap).toBe(false);
  } finally { await f.close(); }
});
