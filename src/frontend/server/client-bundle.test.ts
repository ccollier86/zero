/**
 * client-bundle.test.ts
 *
 * Verifies Zero's app-owned client generation contracts. These tests cover
 * generated route manifest and client entry output only; they do not exercise
 * browser hydration or static asset serving.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { generateClientEntry, generateRouteManifest } from './client-bundle';

describe('client bundle generated artifacts', () => {
  test('writes route manifest and client entry into the app generated directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-client-bundle-'));
    const appDir = join(rootDir, 'app');
    const generatedDir = join(rootDir, '.zero', 'generated');

    try {
      await mkdir(join(appDir, 'about'), { recursive: true });
      await writeFile(
        join(appDir, 'layout.tsx'),
        "export default function Layout({ children }: any) { return children; }\n"
      );
      await writeFile(
        join(appDir, 'page.tsx'),
        "'use client';\nexport default function Home() { return null; }\n"
      );
      await writeFile(
        join(appDir, 'about', 'page.tsx'),
        "export default function About() { return null; }\n"
      );

      const manifestPath = generateRouteManifest({ appDir, generatedDir });
      const entryPath = generateClientEntry({ generatedDir });

      const manifest = await readFile(manifestPath, 'utf8');
      const entry = await readFile(entryPath, 'utf8');

      expect(manifestPath).toBe(join(generatedDir, 'route-manifest.ts'));
      expect(entryPath).toBe(join(generatedDir, 'client-entry.tsx'));
      expect(manifest).toContain("pattern: '/'");
      expect(manifest).toContain("load: () => import('@app/page')");
      expect(manifest).toContain("() => import('@app/layout')");
      expect(manifest).toContain('export const serverRoutes: string[] = ["/about"];');
      expect(entry).toContain("import { startHydration } from '@zero/framework/react/hydrate-runtime';");
      expect(entry).toContain("import { routes, serverRoutes } from './route-manifest';");
      expect(entry).toContain('startHydration({ routes, serverRoutes });');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('marks routes under a client layout as client routes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-client-layout-'));
    const appDir = join(rootDir, 'app');
    const generatedDir = join(rootDir, '.zero', 'generated');

    try {
      await mkdir(appDir, { recursive: true });
      await writeFile(
        join(appDir, 'layout.tsx'),
        "'use client';\nexport default function Layout({ children }: any) { return children; }\n"
      );
      await writeFile(
        join(appDir, 'page.tsx'),
        "export default function Home() { return null; }\n"
      );

      const manifestPath = generateRouteManifest({ appDir, generatedDir });
      const manifest = await readFile(manifestPath, 'utf8');

      expect(manifest).toContain('export const serverRoutes: string[] = [];');
      expect(manifest).toContain("pattern: '/'");
      expect(manifest).toContain("load: () => import('@app/page')");
      expect(manifest).toContain("() => import('@app/layout')");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('omits route group folders from generated client route patterns', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-client-route-groups-'));
    const appDir = join(rootDir, 'app');
    const generatedDir = join(rootDir, '.zero', 'generated');

    try {
      await mkdir(join(appDir, '(public)'), { recursive: true });
      await mkdir(join(appDir, '(dashboard)', 'dashboard'), { recursive: true });
      await writeFile(
        join(appDir, 'layout.tsx'),
        "'use client';\nexport default function Root({ children }: any) { return children; }\n"
      );
      await writeFile(
        join(appDir, '(public)', 'layout.tsx'),
        "'use client';\nexport default function Public({ children }: any) { return children; }\n"
      );
      await writeFile(
        join(appDir, '(public)', 'page.tsx'),
        "'use client';\nexport default function Home() { return null; }\n"
      );
      await writeFile(
        join(appDir, '(dashboard)', 'layout.tsx'),
        "'use client';\nexport const config = { auth: 'required' };\nexport default function Dashboard({ children }: any) { return children; }\n"
      );
      await writeFile(
        join(appDir, '(dashboard)', 'dashboard', 'page.tsx'),
        "'use client';\nexport default function DashboardPage() { return null; }\n"
      );

      const manifestPath = generateRouteManifest({ appDir, generatedDir });
      const manifest = await readFile(manifestPath, 'utf8');

      expect(manifest).toContain("pattern: '/'");
      expect(manifest).toContain("pattern: '/dashboard'");
      expect(manifest).not.toContain("pattern: '/(public)'");
      expect(manifest).not.toContain("pattern: '/(dashboard)/dashboard'");
      expect(manifest).toContain("() => import('@app/(public)/layout')");
      expect(manifest).toContain("() => import('@app/(dashboard)/layout')");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
