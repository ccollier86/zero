/**
 * page-session-app.integration.test.ts
 *
 * Reproduces the browser-refresh boundary through the real createApp wiring:
 * auth issuance -> HttpOnly cookie -> protected file-router SSR.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearPlatformSQLiteService,
  getPlatformSQLiteService,
} from '../../persistence';
import { PAGE_SESSION_COOKIE_NAME } from '../../auth/page-session';
import { createApp } from './app-factory';

let activeApp: Awaited<ReturnType<typeof createApp>> | null = null;
let activeRoot: string | null = null;

afterEach(async () => {
  if (activeApp) await activeApp.stop();
  activeApp = null;

  const sqlite = getPlatformSQLiteService();
  sqlite?.close();
  clearPlatformSQLiteService(sqlite);

  if (activeRoot) await rm(activeRoot, { recursive: true, force: true });
  activeRoot = null;
});

describe('createApp page-session SSR integration', () => {
  test('login survives a direct protected document request without Bearer auth', async () => {
    const zeroTempDir = join(process.cwd(), '.zero');
    await mkdir(zeroTempDir, { recursive: true });
    activeRoot = await mkdtemp(join(zeroTempDir, 'page-session-app-'));
    const appDir = join(activeRoot, 'app');
    await mkdir(join(appDir, 'app'), { recursive: true });
    await writeFile(
      join(appDir, 'app', 'page.tsx'),
      [
        "'use client';",
        "export const config = { auth: 'required' };",
        'export function loader({ auth }: any) {',
        "  return { userId: auth?.userId ?? null, source: 'protected-page' };",
        '}',
        'export default function ProtectedPage() { return null; }',
        '',
      ].join('\n')
    );

    activeApp = await createApp({
      db: { mode: 'memory' },
      tables: {},
      auth: true,
      routeAuth: 'protected-by-default',
      publicPaths: ['/login'],
      appDir,
      outDir: join(activeRoot, 'out'),
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      resourceRoutes: false,
      observability: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
      email: false,
      migrate: false,
    });
    activeApp.listen(0);
    const baseUrl = `http://localhost:${activeApp.server!.port}`;

    const anonymous = await fetch(`${baseUrl}/app`, { redirect: 'manual' });
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get('location')).toBe('/login');

    const registrationResponse = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'direct-page-user',
        email: 'direct-page-user@example.test',
        password: 'password123',
      }),
    });
    const registration = await registrationResponse.json();
    const setCookie = registrationResponse.headers.get('set-cookie');
    expect(registrationResponse.status).toBe(200);
    expect(setCookie).toContain(`${PAGE_SESSION_COOKIE_NAME}=`);
    const pageCookie = setCookie!.split(';', 1)[0]!;
    const pageToken = decodeURIComponent(pageCookie.slice(pageCookie.indexOf('=') + 1));
    expect(JSON.stringify(registration)).not.toContain(pageToken);

    const directPage = await fetch(`${baseUrl}/app`, {
      headers: { Cookie: pageCookie },
      redirect: 'manual',
    });
    const html = await directPage.text();
    expect(directPage.status).toBe(200);
    expect(html).toContain(registration.user.userId);
    expect(html).toContain('protected-page');
    expect(html).not.toContain(pageToken);
    expect(directPage.headers.get('cache-control')).toBe('private, no-store');

    const cookieOnlyApi = await fetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: pageCookie },
    });
    expect(cookieOnlyApi.status).toBe(401);

    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pageCookie,
      },
      body: JSON.stringify({ refreshToken: registration.refreshToken }),
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

    const afterLogout = await fetch(`${baseUrl}/app`, {
      headers: { Cookie: pageCookie },
      redirect: 'manual',
    });
    expect(afterLogout.status).toBe(302);
    expect(afterLogout.headers.get('location')).toBe('/login');
    expect(afterLogout.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
