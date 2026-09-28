import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { buildRouteTree } from '../router/route-tree';
import { scanRoutes } from '../router/scanner';
import { createRouterPlugin } from './router-plugin';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('router ISR cache isolation', () => {
  test('does not reuse a cached pathname across router plugin instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-router-isr-isolation-'));
    temporaryRoots.push(root);
    const appDirA = await createRouteApp(root, 'a', 'router-a');
    const appDirB = await createRouteApp(root, 'b', 'router-b');

    const routerA = createTestRouter(appDirA, 'router-isr-a');
    const routerB = createTestRouter(appDirB, 'router-isr-b');

    const firstA = await routerA.handle(new Request('http://a.test/cached'));
    expect(firstA.headers.get('x-cache')).toBeNull();
    expect(await firstA.text()).toContain('"marker":"router-a"');

    const cachedA = await routerA.handle(new Request('http://a.test/cached'));
    expect(cachedA.headers.get('x-cache')).toBe('HIT');
    expect(await cachedA.text()).toContain('"marker":"router-a"');

    const postA = await routerA.handle(new Request('http://a.test/cached', {
      method: 'POST',
    }));
    expect(postA.headers.get('x-cache')).toBeNull();

    const cookieA = await routerA.handle(new Request('http://a.test/cached', {
      headers: { Cookie: 'preview=private' },
    }));
    expect(cookieA.headers.get('x-cache')).toBeNull();

    const firstVariantA = await routerA.handle(
      new Request('http://a.test/cached?variant=one'),
    );
    expect(firstVariantA.headers.get('x-cache')).toBeNull();
    expect(await firstVariantA.text()).toContain('"query":"?variant=one"');

    const cachedVariantA = await routerA.handle(
      new Request('http://a.test/cached?variant=one'),
    );
    expect(cachedVariantA.headers.get('x-cache')).toBe('HIT');

    const otherHostA = await routerA.handle(
      new Request('http://other-a.test/cached?variant=one'),
    );
    expect(otherHostA.headers.get('x-cache')).toBeNull();
    const otherHostABody = await otherHostA.text();
    expect(otherHostABody).toContain('"origin":"http://other-a.test"');
    expect(otherHostABody).not.toContain('"origin":"http://a.test"');

    const firstB = await routerB.handle(new Request('http://b.test/cached'));
    expect(firstB.headers.get('x-cache')).toBeNull();
    const firstBBody = await firstB.text();
    expect(firstBBody).toContain('"marker":"router-b"');
    expect(firstBBody).not.toContain('"marker":"router-a"');

    const cachedB = await routerB.handle(new Request('http://b.test/cached'));
    expect(cachedB.headers.get('x-cache')).toBe('HIT');
    expect(await cachedB.text()).toContain('"marker":"router-b"');
  });
});

function createTestRouter(
  appDir: string,
  name: string,
): { handle(request: Request): Response | Promise<Response> } {
  return new Elysia({ name }).use(createRouterPlugin({
    appDir,
    routeTree: buildRouteTree(scanRoutes(appDir)),
  }));
}

async function createRouteApp(
  root: string,
  directory: string,
  marker: string,
): Promise<string> {
  const appDir = join(root, directory, 'app');
  const routeDir = join(appDir, 'cached');
  await mkdir(routeDir, { recursive: true });
  await writeFile(join(routeDir, 'page.ts'), [
    "'use client';",
    'export const config = { revalidate: 3600 };',
    'export function loader({ request }) {',
    '  const url = new URL(request.url);',
    `  return { marker: ${JSON.stringify(marker)}, origin: url.origin, query: url.search };`,
    '}',
    'export default function Page() { return null; }',
    '',
  ].join('\n'));
  return appDir;
}
