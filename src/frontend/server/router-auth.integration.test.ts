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
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import { buildRouteTree } from '../router/route-tree';
import { scanRoutes } from '../router/scanner';
import { createRouterPlugin } from './router-plugin';

const TEST_PAGE_COOKIE = `${PAGE_SESSION_COOKIE_NAME}_synthetic_router`;

interface TestApp {
  handle(request: Request): Response | Promise<Response>;
}

let appDir: string;
let app: TestApp;
let cacheCounterKey: string;
let apiHandlerCounterKey: string;
let structuredHandlerCounterKey: string;
let pageResolverAttempts = 0;
let pageResolverAccepts = 0;

describe('router page-session authentication boundary', () => {
  beforeAll(async () => {
    appDir = await mkdtemp(join(tmpdir(), 'zero-router-auth-'));
    cacheCounterKey = `__zero_router_auth_${crypto.randomUUID().replaceAll('-', '')}`;
    apiHandlerCounterKey = `__zero_router_api_${crypto.randomUUID().replaceAll('-', '')}`;
    structuredHandlerCounterKey = `__zero_router_structured_${crypto.randomUUID().replaceAll('-', '')}`;

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

    await writeRoute(
      'policy-error/layout.ts',
      [
        'export const config = {',
        '  auth: "required",',
        '  middleware() { throw new Error("policy dependency failed"); },',
        '};',
        'export default function Layout({ children }: any) { return children; }',
      ].join('\n')
    );
    await writeRoute(
      'policy-error/page.ts',
      [
        "'use client';",
        'export default function Page() { return null; }',
      ].join('\n')
    );

    await writeRoute(
      'layout-api/layout.ts',
      [
        'export const config = { auth: "admin" };',
        'export default function Layout({ children }: any) { return children; }',
      ].join('\n')
    );
    await writeRoute(
      'layout-api/route.ts',
      [
        'export function GET({ auth }: any) {',
        '  return Response.json({ userId: auth?.userId ?? null });',
        '}',
      ].join('\n')
    );
    await writeRoute(
      'api-policy-error/layout.ts',
      [
        'export const config = {',
        '  auth: "required",',
        '  middleware() { throw new Error("api policy dependency failed"); },',
        '};',
        'export default function Layout({ children }: any) { return children; }',
      ].join('\n')
    );
    await writeRoute(
      'api-policy-error/route.ts',
      'export function GET() { return Response.json({ exposed: true }); }'
    );
    await writeRoute(
      'api-import-error/layout.ts',
      [
        'throw new Error("layout import failed");',
        'export const config = { auth: "required" };',
        'export default function Layout({ children }: any) { return children; }',
      ].join('\n')
    );
    await writeRoute(
      'api-import-error/route.ts',
      'export function GET() { return Response.json({ exposed: true }); }'
    );
    await writeRoute(
      'nested-api/layout.ts',
      [
        'export const config = { auth: "required" };',
        'export default function Layout({ children }: any) { return children; }',
      ].join('\n')
    );
    await writeRoute(
      'nested-api/secure/layout.ts',
      [
        'export const config = { auth: "admin" };',
        'export default function Layout({ children }: any) { return children; }',
      ].join('\n')
    );
    await writeRoute(
      'nested-api/secure/route.ts',
      [
        `const counterKey = ${JSON.stringify(apiHandlerCounterKey)};`,
        'export function GET() {',
        '  const state = globalThis as Record<string, number | undefined>;',
        '  state[counterKey] = (state[counterKey] ?? 0) + 1;',
        '  return Response.json({ handled: true });',
        '}',
      ].join('\n')
    );

    await writeRoute(
      'structured/route.ts',
      [
        'export const config = { auth: { tenant: "required", permission: "files:read" } };',
        'export function GET({ auth, access }: any) {',
        '  return Response.json({',
        '    userId: auth?.userId ?? null,',
        '    scopeId: access.authorization?.scopeId ?? null,',
        '  });',
        '}',
      ].join('\n'),
    );
    await writeRoute(
      'structured-parent/layout.ts',
      [
        'export const config = { auth: { tenant: "required", permission: "files:read" } };',
        'export default function Layout({ children }: any) { return children; }',
      ].join('\n'),
    );
    await writeRoute(
      'structured-parent/route.ts',
      [
        'export const config = { auth: false };',
        `const counterKey = ${JSON.stringify(structuredHandlerCounterKey)};`,
        'export function GET() {',
        '  const state = globalThis as Record<string, number | undefined>;',
        '  state[counterKey] = (state[counterKey] ?? 0) + 1;',
        '  return Response.json({ handled: true });',
        '}',
      ].join('\n'),
    );
    await writeRoute(
      'structured-page/page.ts',
      [
        "'use client';",
        'export const config = { auth: { tenant: "required", permission: "files:read" } };',
        'export function loader({ auth, access }: any) {',
        '  return { userId: auth?.userId ?? null, scopeId: access.authorization?.scopeId };',
        '}',
        'export default function Page() { return null; }',
      ].join('\n'),
    );

    const routeTree = buildRouteTree(scanRoutes(appDir));
    const authorizationKernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'simple',
        permissions: {
          'files:read': { label: 'Read files' },
        },
        roles: {
          user: { permissions: ['files:read'] },
          admin: { allPermissions: true },
          guest: { permissions: [] },
        },
      },
    }));
    app = new Elysia({ name: 'router-auth-integration' })
      .resolve({ as: 'global' }, ({ request }) => ({
        authContext:
          request.headers.get('authorization') === 'Bearer valid-access-token'
            ? testTenantAuth('bearer-user', 'bearer@example.test', 'user')
            : request.headers.get('authorization') === 'Bearer guest-access-token'
              ? testTenantAuth('bearer-guest', 'guest@example.test', 'guest')
            : request.headers.get('authorization') === 'Bearer unbound-access-token'
              ? {
                  userId: 'bearer-unbound',
                  email: 'unbound@example.test',
                  role: 'user',
                }
            : request.headers.get('authorization') === 'Bearer admin-access-token'
              ? testTenantAuth('bearer-admin', 'admin@example.test', 'admin')
            : null,
      }))
      .use(
        createRouterPlugin({
          appDir,
          routeTree,
          authorization: {
            getKernel: () => authorizationKernel,
          },
          authGuard: {
            routeAuth: 'protected-by-default',
            publicPaths: ['/sign-in'],
            loginPath: '/sign-in',
            postLoginPath: '/dashboard',
            resolvePageAuth: resolveTestPageAuth,
            clearRejectedPageSession: request => rejectedPageSessionCookieHeader(request, { pageSessionCookieName: TEST_PAGE_COOKIE }),
          },
        })
      );
  });

  afterAll(async () => {
    delete (globalThis as Record<string, unknown>)[cacheCounterKey];
    delete (globalThis as Record<string, unknown>)[apiHandlerCounterKey];
    delete (globalThis as Record<string, unknown>)[structuredHandlerCounterKey];
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
    expect(anonymous.headers.get('location')).toBe(
      '/sign-in?redirect=%2Fprotected',
    );
  });

  test('does not fall back to the page cookie when an explicit Authorization header is invalid', async () => {
    const acceptedBefore = pageResolverAccepts;
    const response = await request('/protected', {
      authorization: 'Bearer invalid-access-token',
      cookieSession: 'alice',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      '/sign-in?redirect=%2Fprotected',
    );
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(pageResolverAccepts).toBe(acceptedBefore);
  });

  test('clears a rejected page credential on the raw redirect response', async () => {
    const response = await request('/protected', {
      cookieSession: 'revoked',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      '/sign-in?redirect=%2Fprotected',
    );
    expect(response.headers.get('set-cookie')).toContain(
      `${TEST_PAGE_COOKIE}=`
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test('keeps actual route.ts APIs cookie-unaware and Bearer-only', async () => {
    const attemptsBefore = pageResolverAttempts;
    const cookieOnly = await request('/api-only', {
      cookieSession: 'alice',
    });

    expect(cookieOnly.status).toBe(401);
    expect(cookieOnly.headers.get('location')).toBeNull();
    expect(cookieOnly.headers.get('cache-control')).toBe('private, no-store');
    expect(cookieOnly.headers.get('vary')).toContain('Authorization');
    expect(await cookieOnly.json()).toEqual({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
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

  test('applies parent layout authorization to colocated route.ts handlers', async () => {
    const anonymous = await request('/layout-api');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('location')).toBeNull();
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');

    const user = await request('/layout-api', {
      authorization: 'Bearer valid-access-token',
    });
    expect(user.status).toBe(403);
    expect(user.headers.get('cache-control')).toBe('private, no-store');

    const admin = await request('/layout-api', {
      authorization: 'Bearer admin-access-token',
    });
    expect(admin.status).toBe(200);
    expect(await admin.json()).toEqual({ userId: 'bearer-admin' });
    expect(admin.headers.get('cache-control')).toBe('private, no-store');
    expect(admin.headers.get('vary')).toContain('Authorization');
  });

  test('keeps page-oriented layout middleware out of route.ts APIs', async () => {
    const response = await request('/api-policy-error', {
      authorization: 'Bearer valid-access-token',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exposed: true });
  });

  test('fails closed when an inherited route.ts layout cannot be imported', async () => {
    const response = await request('/api-import-error', {
      authorization: 'Bearer valid-access-token',
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Route policy unavailable');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  test('evaluates nested API auth root-to-leaf and never runs a denied handler', async () => {
    (globalThis as Record<string, unknown>)[apiHandlerCounterKey] = 0;

    const anonymous = await request('/nested-api/secure');
    expect(anonymous.status).toBe(401);
    expect((globalThis as Record<string, unknown>)[apiHandlerCounterKey]).toBe(0);

    const user = await request('/nested-api/secure', {
      authorization: 'Bearer valid-access-token',
    });
    expect(user.status).toBe(403);
    expect((globalThis as Record<string, unknown>)[apiHandlerCounterKey]).toBe(0);

    const admin = await request('/nested-api/secure', {
      authorization: 'Bearer admin-access-token',
    });
    expect(admin.status).toBe(200);
    expect(await admin.json()).toEqual({ handled: true });
    expect((globalThis as Record<string, unknown>)[apiHandlerCounterKey]).toBe(1);
  });

  test('uses the shared authorization kernel for structured route.ts policy', async () => {
    const anonymous = await request('/structured');
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });

    const denied = await request('/structured', {
      authorization: 'Bearer guest-access-token',
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: 'Forbidden',
      code: 'FORBIDDEN',
    });

    const unbound = await request('/structured', {
      authorization: 'Bearer unbound-access-token',
    });
    expect(unbound.status).toBe(403);
    expect(await unbound.json()).toEqual({
      error: 'Forbidden',
      code: 'FORBIDDEN',
    });

    const allowed = await request('/structured', {
      authorization: 'Bearer valid-access-token',
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({
      userId: 'bearer-user',
      scopeId: 'ten_test',
    });
  });

  test('does not let child auth false weaken a structured layout policy', async () => {
    (globalThis as Record<string, unknown>)[structuredHandlerCounterKey] = 0;

    const denied = await request('/structured-parent', {
      authorization: 'Bearer guest-access-token',
    });
    expect(denied.status).toBe(403);
    expect((globalThis as Record<string, unknown>)[structuredHandlerCounterKey]).toBe(0);

    const allowed = await request('/structured-parent', {
      authorization: 'Bearer valid-access-token',
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ handled: true });
    expect((globalThis as Record<string, unknown>)[structuredHandlerCounterKey]).toBe(1);
  });

  test('rehydrates page-cookie identity into the same structured access facade', async () => {
    const allowed = await request('/structured-page', { cookieSession: 'alice' });
    const allowedBody = await allowed.text();
    expect(allowed.status).toBe(200);
    expect(allowedBody).toContain('"userId":"cookie-alice"');
    expect(allowedBody).toContain('"scopeId":"ten_test"');

    const denied = await request('/structured-page', { cookieSession: 'guest' });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe('Forbidden');
  });

  test('preserves protected queries and redirects authenticated login visits', async () => {
    const anonymous = await request('/protected?tab=notes&page=2');
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get('location')).toBe(
      '/sign-in?redirect=%2Fprotected%3Ftab%3Dnotes%26page%3D2',
    );

    const returned = await request(
      '/sign-in?redirect=%2Fprotected%3Ftab%3Dnotes%26page%3D2',
      { cookieSession: 'alice' },
    );
    expect(returned.status).toBe(302);
    expect(returned.headers.get('location')).toBe('/protected?tab=notes&page=2');
    expect(returned.headers.get('cache-control')).toBe('private, no-store');

    const fallback = await request('/sign-in', { cookieSession: 'alice' });
    expect(fallback.status).toBe(302);
    expect(fallback.headers.get('location')).toBe('/dashboard');

    const hostile = await request(
      '/sign-in?redirect=https%3A%2F%2Fattacker.example',
      { cookieSession: 'alice' },
    );
    expect(hostile.status).toBe(302);
    expect(hostile.headers.get('location')).toBe('/dashboard');
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

  test('fails closed when inherited layout policy evaluation throws', async () => {
    const response = await request('/policy-error', {
      authorization: 'Bearer valid-access-token',
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Route policy unavailable');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
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
  return testTenantAuth(
    `cookie-${session}`,
    `${session}@example.test`,
    session === 'guest' ? 'guest' : 'user',
  );
}

function testTenantAuth(userId: string, email: string, role: string) {
  return {
    userId,
    email,
    role,
    sessionKind: 'web' as const,
    sessionId: `ses-${userId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant' as const,
    sessionScopeId: 'ten_test',
    tenantId: 'ten_test',
    membershipId: `mem-${userId}`,
    tenantRole: role,
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
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
