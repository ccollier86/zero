/** Proves native OIDC is wired through the public createApp configuration. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { clearPlatformSQLiteService, getPlatformSQLiteService } from '../../persistence';
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

describe('createApp native authentication integration', () => {
  test('publishes the configured app as a native OpenID provider', async () => {
    const zeroTempDir = join(process.cwd(), '.zero');
    await mkdir(zeroTempDir, { recursive: true });
    activeRoot = await mkdtemp(join(zeroTempDir, 'native-auth-app-'));
    const appDir = join(activeRoot, 'app');
    await mkdir(appDir, { recursive: true });
    for (const route of [
      'signin', 'join', 'confirm-email', 'recover-account', 'activate-account',
    ]) {
      const routeDir = join(appDir, route);
      await mkdir(routeDir, { recursive: true });
      await writeFile(join(routeDir, 'page.ts'), 'export default function Page() { return null; }');
    }

    activeApp = await createApp({
      app: { name: 'Native Test', publicUrl: 'https://zero.example' },
      db: { mode: 'memory' }, tables: {}, appDir,
      auth: {
        account: {
          requireEmailVerification: true,
          emailVerificationPath: '/confirm-email?source=registration',
        },
        accountEmails: {
          resetPath: 'recover-account?source=email',
          setupPath: '/activate-account#setup',
        },
        nativeApps: { issuer: 'https://zero.example', clients: [{
          clientId: 'com.example.desktop', name: 'Example Desktop',
          redirectUris: ['com.example.desktop:/oauth/callback'],
        }] },
      },
      serverResourcesDir: false, serverPluginsDir: false,
      serverMiddlewareDir: false, serverEndpointsDir: false,
      serverRoutesDir: false, resourceRoutes: false,
      observability: false, ai: false, vector: false, pdf: false,
      kv: false, email: false, migrate: false,
      loginPath: '/signin', registrationPath: '/join',
    });
    activeApp.listen(0);
    const local = `http://localhost:${activeApp.server!.port}`;
    const response = await fetch(`${local}/auth/.well-known/openid-configuration`);
    const metadata = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(metadata.issuer).toBe('https://zero.example/auth');
    expect(metadata.authorization_endpoint)
      .toBe('https://zero.example/auth/oauth/authorize');
    expect(metadata.token_endpoint).toBe('https://zero.example/auth/oauth/token');
    expect(metadata.jwks_uri).toBe('https://zero.example/auth/jwks');

    expect((await fetch(`${local}/signin`, { redirect: 'manual' })).status).toBe(200);
    expect((await fetch(`${local}/join`, { redirect: 'manual' })).status).toBe(200);
    expect((await fetch(`${local}/confirm-email`, { redirect: 'manual' })).status).toBe(200);
    expect((await fetch(`${local}/recover-account`, { redirect: 'manual' })).status).toBe(200);
    expect((await fetch(`${local}/activate-account`, { redirect: 'manual' })).status).toBe(200);
    const authorize = new URL(`${local}/auth/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code', client_id: 'com.example.desktop',
      redirect_uri: 'com.example.desktop:/oauth/callback', scope: 'openid',
      state: 's'.repeat(43), nonce: 'n'.repeat(43),
      code_challenge: 'c'.repeat(43), code_challenge_method: 'S256',
    }).toString();
    const signIn = await fetch(authorize, { redirect: 'manual' });
    expect(signIn.headers.get('location')).toStartWith('/signin?redirect=');
    authorize.searchParams.set('prompt', 'create');
    const signUp = await fetch(authorize, { redirect: 'manual' });
    expect(signUp.headers.get('location')).toStartWith('/join?redirect=');
  });
});
