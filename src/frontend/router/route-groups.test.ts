/**
 * route-groups.test.ts
 *
 * Verifies file-router route group semantics. These tests cover scanner,
 * route-tree, and matcher behavior only; server rendering and browser
 * hydration are tested in their owning modules.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { scanRoutes } from './scanner';
import { buildRouteTree } from './route-tree';
import { matchRoute } from './matcher';

describe('file-router route groups', () => {
  test('keeps sibling group layouts separate while omitting groups from URLs', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-route-groups-'));
    const appDir = join(rootDir, 'app');

    try {
      await mkdir(join(appDir, '(public)'), { recursive: true });
      await mkdir(join(appDir, '(dashboard)', 'dashboard'), { recursive: true });

      await writeFile(join(appDir, 'layout.tsx'), 'export default function Root() { return null; }\n');
      await writeFile(join(appDir, '(public)', 'layout.tsx'), 'export default function Public() { return null; }\n');
      await writeFile(join(appDir, '(public)', 'page.tsx'), 'export default function Home() { return null; }\n');
      await writeFile(join(appDir, '(dashboard)', 'layout.tsx'), 'export default function Dashboard() { return null; }\n');
      await writeFile(join(appDir, '(dashboard)', 'dashboard', 'page.tsx'), 'export default function DashboardPage() { return null; }\n');

      const tree = buildRouteTree(scanRoutes(appDir));
      const home = matchRoute(tree, '/');
      const dashboard = matchRoute(tree, '/dashboard');

      expect(home.pattern).toBe('/');
      expect(home.pagePath).toBe(join(appDir, '(public)', 'page.tsx'));
      expect(home.layouts).toEqual([
        join(appDir, 'layout.tsx'),
        join(appDir, '(public)', 'layout.tsx'),
      ]);

      expect(dashboard.pattern).toBe('/dashboard');
      expect(dashboard.pagePath).toBe(join(appDir, '(dashboard)', 'dashboard', 'page.tsx'));
      expect(dashboard.layouts).toEqual([
        join(appDir, 'layout.tsx'),
        join(appDir, '(dashboard)', 'layout.tsx'),
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
