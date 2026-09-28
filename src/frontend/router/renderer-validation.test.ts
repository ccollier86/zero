import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { invalidateAll, renderRoute } from './renderer';
import type { MatchResult } from './types';

const tempRoots: string[] = [];

afterEach(async () => {
  invalidateAll();
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('route parameter validation', () => {
  test('rejects invalid params before the loader and renders the nearest not-found route', async () => {
    const root = await createRouteFixture();
    const pagePath = join(root, 'app', 'blog', '[slug]', 'page.tsx');
    const notFoundPath = join(root, 'app', 'blog', 'not-found.tsx');
    const match: MatchResult = {
      pattern: '/blog/[slug]',
      params: { slug: 'NOT VALID' },
      layouts: [],
      pagePath,
      notFoundPath,
      apiRoutePath: null,
    };

    const response = await renderRoute({
      match,
      request: new Request('http://localhost/blog/NOT%20VALID'),
      appDir: join(root, 'app'),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('not-found-marker');
    expect(globalThis.__zeroValidationLoaderRan).toBeUndefined();
  });

  test('runs the loader after valid params pass validation', async () => {
    const root = await createRouteFixture();
    const pagePath = join(root, 'app', 'blog', '[slug]', 'page.tsx');
    const match: MatchResult = {
      pattern: '/blog/[slug]',
      params: { slug: 'valid-slug' },
      layouts: [],
      pagePath,
      apiRoutePath: null,
    };

    const response = await renderRoute({
      match,
      request: new Request('http://localhost/blog/valid-slug'),
      appDir: join(root, 'app'),
    });

    expect(response.status).toBe(200);
    expect(globalThis.__zeroValidationLoaderRan).toBe(true);
  });
});

declare global {
  // Test-only signal set by the dynamically loaded route module.
  var __zeroValidationLoaderRan: boolean | undefined;
}

async function createRouteFixture(): Promise<string> {
  globalThis.__zeroValidationLoaderRan = undefined;
  await mkdir(join(process.cwd(), '.zero'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.zero', 'renderer-validation-'));
  tempRoots.push(root);
  const routeDir = join(root, 'app', 'blog', '[slug]');
  await mkdir(routeDir, { recursive: true });
  await writeFile(join(routeDir, 'page.tsx'), [
    "'use client';",
    "import * as v from 'valibot';",
    'export const validate = {',
    "  params: v.object({ slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)) }),",
    '};',
    'export function loader() {',
    '  globalThis.__zeroValidationLoaderRan = true;',
    "  return { ok: true };",
    '}',
    "export default function Page() { return 'page-marker'; }",
    '',
  ].join('\n'));
  await writeFile(join(root, 'app', 'blog', 'not-found.tsx'), [
    "export default function NotFound() { return 'not-found-marker'; }",
    '',
  ].join('\n'));
  return root;
}
