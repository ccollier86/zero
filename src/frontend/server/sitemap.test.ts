/**
 * sitemap.test.ts
 *
 * Verifies automatic sitemap generation from the file router. These tests own
 * sitemap discovery and HTTP mounting; route matching/rendering tests live
 * with the router.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import { buildRouteTree } from '../router/route-tree';
import { scanRoutes } from '../router/scanner';
import { createRouterPlugin } from './router-plugin';
import { collectSitemapEntries, generateSitemapXml } from './sitemap';
import type { ResolvedSitemapConfig } from './types';

const sitemapConfig: ResolvedSitemapConfig = {
  path: '/sitemap.xml',
  entries: [],
  exclude: [],
};

describe('sitemap generation', () => {
  test('includes static public pages and omits route groups and API routes', async () => {
    await withTempApp(async (appDir) => {
      await writeRoute(appDir, '(public)/page.ts', 'export default function Page() { return null; }');
      await writeRoute(appDir, 'about/page.ts', 'export default function Page() { return null; }');
      await writeRoute(appDir, 'api/health/route.ts', 'export const GET = () => new Response("ok");');

      const xml = await generateSitemapXml({
        routeTree: buildRouteTree(scanRoutes(appDir)),
        config: sitemapConfig,
        requestUrl: 'http://localhost/sitemap.xml',
        publicUrl: 'https://zero.example',
        routeAuth: 'explicit',
        publicPaths: [],
      });

      expect(getLocs(xml)).toEqual([
        'https://zero.example/',
        'https://zero.example/about',
      ]);
      expect(xml).not.toContain('/api/health');
      expect(xml).not.toContain('(public)');
    });
  });

  test('omits dynamic routes and routes protected by page or layout config', async () => {
    await withTempApp(async (appDir) => {
      await writeRoute(appDir, 'page.ts', 'export default function Page() { return null; }');
      await writeRoute(appDir, 'admin/page.ts', [
        'export const config = { auth: "admin" };',
        'export default function Page() { return null; }',
      ].join('\n'));
      await writeRoute(appDir, '(dashboard)/layout.ts', [
        'export const config = { auth: true };',
        'export default function Layout({ children }: any) { return children; }',
      ].join('\n'));
      await writeRoute(appDir, '(dashboard)/reports/page.ts', 'export default function Page() { return null; }');
      await writeRoute(appDir, 'blog/[slug]/page.ts', 'export default function Page() { return null; }');

      const entries = await collectSitemapEntries({
        routeTree: buildRouteTree(scanRoutes(appDir)),
        config: sitemapConfig,
        requestUrl: 'https://fallback.test/sitemap.xml',
        routeAuth: 'explicit',
        publicPaths: [],
      });

      expect(entries.map((entry) => entry.href)).toEqual(['/']);
    });
  });

  test('omits routes when config import fails', async () => {
    await withTempApp(async (appDir) => {
      await writeRoute(appDir, 'page.ts', 'export default function Page() { return null; }');
      await writeRoute(appDir, 'broken/page.ts', [
        'throw new Error("route module failed during import");',
        'export default function Page() { return null; }',
      ].join('\n'));

      const entries = await collectSitemapEntries({
        routeTree: buildRouteTree(scanRoutes(appDir)),
        config: sitemapConfig,
        requestUrl: 'https://fallback.test/sitemap.xml',
        routeAuth: 'explicit',
        publicPaths: [],
      });

      expect(entries.map((entry) => entry.href)).toEqual(['/']);
    });
  });

  test('respects protected-by-default public path configuration', async () => {
    await withTempApp(async (appDir) => {
      await writeRoute(appDir, 'page.ts', 'export default function Page() { return null; }');
      await writeRoute(appDir, 'login/page.ts', 'export default function Page() { return null; }');
      await writeRoute(appDir, 'settings/page.ts', 'export default function Page() { return null; }');

      const entries = await collectSitemapEntries({
        routeTree: buildRouteTree(scanRoutes(appDir)),
        config: sitemapConfig,
        requestUrl: 'https://fallback.test/sitemap.xml',
        routeAuth: 'protected-by-default',
        publicPaths: ['/', '/login'],
      });

      expect(entries.map((entry) => entry.href)).toEqual(['/', '/login']);
    });
  });

  test('merges manual entries and excludes configured public paths', async () => {
    await withTempApp(async (appDir) => {
      await writeRoute(appDir, 'page.ts', 'export default function Page() { return null; }');
      await writeRoute(appDir, 'about/page.ts', 'export default function Page() { return null; }');

      const xml = await generateSitemapXml({
        routeTree: buildRouteTree(scanRoutes(appDir)),
        config: {
          path: '/site-map.xml',
          changefreq: 'weekly',
          priority: 0.7,
          entries: [
            {
              href: '/blog/first-post',
              lastmod: new Date('2026-06-30T00:00:00.000Z'),
              changefreq: 'monthly',
              priority: 0.9,
            },
          ],
          exclude: ['/about'],
        },
        requestUrl: 'https://request-origin.test/site-map.xml',
        routeAuth: 'explicit',
        publicPaths: [],
      });

      expect(getLocs(xml)).toEqual([
        'https://request-origin.test/',
        'https://request-origin.test/blog/first-post',
      ]);
      expect(xml).toContain('<changefreq>weekly</changefreq>');
      expect(xml).toContain('<changefreq>monthly</changefreq>');
      expect(xml).toContain('<priority>0.7</priority>');
      expect(xml).toContain('<priority>0.9</priority>');
      expect(xml).toContain('<lastmod>2026-06-30T00:00:00.000Z</lastmod>');
    });
  });

  test('mounts a sitemap HTTP route before the file-router catch-all', async () => {
    await withTempApp(async (appDir) => {
      await writeRoute(appDir, 'page.ts', 'export default function Page() { return null; }');

      const app = createRouterPlugin({
        routeTree: buildRouteTree(scanRoutes(appDir)),
        sitemap: {
          config: sitemapConfig,
          publicUrl: 'https://zero.example',
          routeAuth: 'explicit',
          publicPaths: [],
        },
      });

      const response = await app.handle(new Request('http://localhost/sitemap.xml'));
      expect(response.headers.get('content-type')).toContain('application/xml');
      expect(await response.text()).toContain('<loc>https://zero.example/</loc>');
    });
  });
});

async function withTempApp(run: (appDir: string) => Promise<void>): Promise<void> {
  const appDir = await mkdtemp(join(tmpdir(), 'zero-sitemap-test-'));
  try {
    await run(appDir);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
}

async function writeRoute(appDir: string, relativePath: string, source: string): Promise<void> {
  const filePath = join(appDir, relativePath);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, source);
}

function getLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}
