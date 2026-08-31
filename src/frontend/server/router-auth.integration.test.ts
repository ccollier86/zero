/**
 * router-auth.integration.test.ts
 *
 * Verifies the file router's split authentication boundary: Bearer identity is
 * available everywhere, while ambient page-session identity is resolved only
 * after API dispatch has been ruled out and only for safe page requests.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  PAGE_SESSION_COOKIE_NAME,
  rejectedPageSessionCookieHeader,
} from '../../auth/page-session';
import { buildRouteTree } from '../router/route-tree';
import { scanRoutes } from '../router/scanner';
import { createRouterPlugin } from './router-plugin';

const TEST_PAGE_COOKIE = PAGE_SESSION_COOKIE_NAME;

interface TestApp {
  handle(request: Request): Response | Promise<Response>;
}

let appDir: string;
let app: TestApp;
let cacheCounterKey: string;
let pageResolverAttempts = 0;
let pageResolverAccepts = 0;

describe('router page-session authentication boundary', () => {
  beforeAll(async () => {
    appDir = await mkdtemp(join(tmpdir(), 'zero-router-auth-'));
    cacheCounterKey = `__zero_router_auth_${crypto.randomUUID().replaceAll('-', '')}`;

    await writeRoute(
      'protected/page.ts',
      [
        "'use client';",
        'export const config = { auth: "required" };',
        'export function loader({ auth }: any) {',
        '  return { userId: auth?.userId ?? null };',
        '}',
        'export default function Page() { return null; }',
      ].join('\n')
    );

    await writeRoute(
      'api-only/route.ts',
      [
        'export const config = { auth: "required" };',
        'export function GET({ auth }: any) {',
        '  return Response.json({ userId: auth?.userId ?? null });',
        '}',
      ].join('\n')
    );

    await writeRoute(
      'colocated/page.ts',
      [
        "'use client';",
        'export const config = { auth: "required" };',
        'export function loader({ auth }: any) {',
        '  return { userId: auth?.userId ?? null, route: "page" };',
        '}',
        'export default function Page() { return null; }',
      ].join('\n')
    );
    await writeRoute(
      'colocated/route.ts',
      [
        'export const config = { auth: "required" };',
        'export function POST({ auth }: any) {',
        '  return Response.json({ userId: auth?.userId ?? null, route: "api" });',
        '}',
      ].join('\n')
    );

    await writeRoute(
      'cached/page.ts',
      [
        "'use client';",
        'export const config = { auth: "required", revalidate: 3600 };',
        `const counterKey = ${JSON.stringify(cacheCounterKey)};`,
        'export function loader({ auth }: any) {',
        '  const state = globalThis as Record<string, number | undefined>;',
        '  const requestNumber = (state[counterKey] ?? 0) + 1;',
        '  state[counterKey] = requestNumber;',
        '  return { userId: auth?.userId ?? null, requestNumber };',
        '}',
        'export default function Page() { return null; }',
      ].join('\n')
    );

    const routeTree = buildRouteTree(scanRoutes(appDir));
    app = new Elysia({ name: 'router-auth-integration' })
      .resolve({ as: 'global' }, ({ request }) => ({
        authContext:
          request.headers.get('authorization') === 'Bearer valid-access-token'
            ? {
                userId: 'bearer-user',
                email: 'bearer@example.test',
                role: 'user',
              }
            : null,
      }))
      .use(
        createRouterPlugin({
          appDir,
          routeTree,
          authGuard: {
            routeAuth: 'protected-by-default',
            publicPaths: ['/login'],
            loginPath: '/login',
            resolvePageAuth: resolveTestPageAuth,
            clearRejectedPageSession: rejectedPageSessionCookieHeader,
          },
        })
      );
  });

  afterAll(async () => {
    delete (globalThis as Record<string, unknown>)[cacheCounterKey];
    await rm(appDir, { recursive: true, force: true });
  });

  test('permits a protected GET through the page resolver and redirects anonymous requests', async () => {
    const authenticated = await request('/protected', {
      cookieSession: 'alice',
    });
    const authenticatedBody = await authenticated.text();

    expect(authenticated.status).toBe(200);
    expect(authenticatedBody).toContain('"userId":"cookie-alice"');

    const anonymous = await request('/protected');
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get('location')).toBe('/login');
  });

  test('does not fall back to the page cookie when an explicit Authorization header is invalid', async () => {
    const acceptedBefore = pageResolverAccepts;
    const response = await request('/protected', {
      authorization: 'Bearer invalid-access-token',
      cookieSession: 'alice',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(pageResolverAccepts).toBe(acceptedBefore);
  });

  test('clears a rejected page credential on the raw redirect response', async () => {
    const response = await request('/protected', {
      cookieSession: 'revoked',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.get('set-cookie')).toContain(
      `${PAGE_SESSION_COOKIE_NAME}=`
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test('keeps actual route.ts APIs cookie-unaware and Bearer-only', async () => {
    const attemptsBefore = pageResolverAttempts;
    const cookieOnly = await request('/api-only', {
      cookieSession: 'alice',
    });

    expect(cookieOnly.status).toBe(302);
    expect(cookieOnly.headers.get('location')).toBe('/login');
    expect(pageResolverAttempts).toBe(attemptsBefore);

    const bearer = await request('/api-only', {
      authorization: 'Bearer valid-access-token',
      cookieSession: 'alice',
    });

    expect(bearer.status).toBe(200);
    expect(await bearer.json()).toEqual({ userId: 'bearer-user' });
    expect(pageResolverAttempts).toBe(attemptsBefore);
  });

  test('falls through to a colocated page when route.ts has no GET handler', async () => {
    const response = await request('/colocated', {
      cookieSession: 'alice',
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"userId":"cookie-alice"');
    expect(body).toContain('"route":"page"');
  });

  test('marks authenticated SSR private/no-store and bypasses ISR across users', async () => {
    (globalThis as Record<string, unknown>)[cacheCounterKey] = 0;

    const alice = await request('/cached', { cookieSession: 'alice' });
    const aliceBody = await alice.text();
    const bob = await request('/cached', { cookieSession: 'bob' });
    const bobBody = await bob.text();

    expect(alice.status).toBe(200);
    expect(bob.status).toBe(200);
    expect(alice.headers.get('cache-control')).toBe('private, no-store');
    expect(bob.headers.get('cache-control')).toBe('private, no-store');
    expect(alice.headers.get('vary')).toContain('Cookie');
    expect(alice.headers.get('vary')).toContain('Authorization');
    expect(alice.headers.get('x-cache')).toBeNull();
    expect(bob.headers.get('x-cache')).toBeNull();
    expect(aliceBody).toContain('"userId":"cookie-alice"');
    expect(aliceBody).toContain('"requestNumber":1');
    expect(bobBody).toContain('"userId":"cookie-bob"');
    expect(bobBody).toContain('"requestNumber":2');
    expect((globalThis as Record<string, unknown>)[cacheCounterKey]).toBe(2);
  });
});

async function writeRoute(relativePath: string, source: string): Promise<void> {
  const filePath = join(appDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${source}\n`);
}

async function resolveTestPageAuth(request: Request) {
  pageResolverAttempts += 1;

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (request.headers.has('authorization')) return null;

  const session = readCookie(request.headers.get('cookie'), TEST_PAGE_COOKIE);
  if (!session || session === 'revoked') return null;

  pageResolverAccepts += 1;
  return {
    userId: `cookie-${session}`,
    email: `${session}@example.test`,
    role: 'user',
  };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [candidate, ...value] = part.trim().split('=');
    if (candidate === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

async function request(
  pathname: string,
  options: {
    method?: string;
    authorization?: string;
    cookieSession?: string;
  } = {}
): Promise<Response> {
  const headers = new Headers();
  if (options.authorization) headers.set('Authorization', options.authorization);
  if (options.cookieSession) {
    headers.set(
      'Cookie',
      `${TEST_PAGE_COOKIE}=${encodeURIComponent(options.cookieSession)}`
    );
  }

  return app.handle(
    new Request(`http://localhost${pathname}`, {
      method: options.method ?? 'GET',
      headers,
    })
  );
}
