/** Real Chromium forms must retain issuer Origin without leaking code redirects. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { decodeJwt } from 'jose';
import type { BrowserContext, Page } from 'playwright';
import { derivePkceS256Challenge } from '../../auth/native';
import {
  acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';
import { createApp } from './app-factory';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const CLIENT_ID = 'com.example.browser-native';
const VERIFIER = 'v'.repeat(64), STATE = 's'.repeat(43), NONCE = 'n'.repeat(43);
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let root: string | undefined;
let origin: string, redirectUri: string, userId: string;
let cookie: { name: string; value: string };
let lease: PlaywrightTestBrowserLease | undefined;
const callbackReferrers: Array<string | null> = [];

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = Bun.env.PROJECT_SCRATCH_DIR ?? join(tmpdir(), 'zero-platform-tests');
  await mkdir(scratch, { recursive: true });
  root = await mkdtemp(join(scratch, 'native-consent-browser-'));
  await mkdir(join(root, 'app'));
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop(true);
  origin = `http://127.0.0.1:${port}`;
  redirectUri = `${origin}/native-callback`;
  app = await createApp({
    app: { name: 'Browser Native Test', publicUrl: origin },
    db: { mode: 'memory' }, tables: {},
    auth: { tenancy: 'single', bootstrap: 'public', registration: { mode: 'public' },
      accountEmails: { passwordReset: false },
      nativeApps: { clients: [{ clientId: CLIENT_ID, name: 'Browser Native', redirectUris: [redirectUri] }] },
    },
    appDir: join(root, 'app'), outDir: join(root, 'out'),
    generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
    serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
    observability: false, ai: false, vector: false, pdf: false, kv: false,
    email: false, workflows: false, migrate: false,
  });
  // Preserve the managed body-inference regression while exercising browser headers.
  app.onBeforeHandle(({ body }) => { void body; });
  app.get('/native-callback', ({ request }) => {
    callbackReferrers.push(request.headers.get('referer'));
    // Never echo the code-bearing callback URL into the page or test logs.
    return new Response('<!doctype html><title>Native callback received</title>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  });
  app.get('/api/native-consent-context', ({ authContext }: any) => authContext ?? { anonymous: true });
  app.listen({ hostname: '127.0.0.1', port });
  const registered = await fetch(`${origin}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'native-browser-owner', email: 'native-browser@example.test', password: 'password123' }),
  });
  expect(registered.status).toBe(200);
  userId = ((await registered.json()) as { user: { userId: string } }).user.userId;
  const rawCookie = registered.headers.get('set-cookie')!.split(';', 1)[0]!;
  const equals = rawCookie.indexOf('=');
  cookie = { name: rawCookie.slice(0, equals), value: rawCookie.slice(equals + 1) };
  lease = await acquirePlaywrightTestBrowser();
}, 30_000);

afterAll(async () => {
  lease?.release();
  try { await app?.stop(true); }
  finally { if (root) await rm(root, { recursive: true, force: true }); }
});

browserTest('Continue submits a browser-generated issuer Origin, exchanges its code and suppresses callback referrers', async () => {
  const context = await lease!.browser.newContext();
  const page = await context.newPage();
  try {
    const consent = await openConsent(page, context, true);
    const callbacksBefore = callbackReferrers.length;
    const response = page.waitForResponse(isConsentPost);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const approved = await response;
    expect(approved.request().headers().origin).toBe(origin);
    expect(approved.status()).toBe(302);
    expect(await consent!.headerValue('referrer-policy')).toBe('same-origin');
    expect(await approved.headerValue('referrer-policy')).toBe('no-referrer');
    const target = new URL((await approved.headerValue('location'))!);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe('/native-callback');
    expect(target.searchParams.get('state')).toBe(STATE);
    expect(target.searchParams.get('iss')).toBe(`${origin}/auth`);
    expect(target.searchParams.has('code')).toBe(true);
    await page.waitForURL(url => url.pathname === '/native-callback');
    expect(callbackReferrers.slice(callbacksBefore)).toEqual([null]);
    const exchanged = await fetch(`${origin}/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID,
        redirect_uri: redirectUri, code_verifier: VERIFIER, code: target.searchParams.get('code')! }),
    });
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json() as { access_token: string; id_token: string };
    expect(decodeJwt(tokens.id_token)).toMatchObject({ sub: userId, nonce: NONCE });
    const principal = await fetch(`${origin}/api/native-consent-context`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(await principal.json()).toMatchObject({ userId, clientId: CLIENT_ID, sessionKind: 'native' });
  } finally { await context.close(); }
}, 30_000);

browserTest('Cancel submits a browser-generated issuer Origin and returns denial without a code or referrer', async () => {
  const context = await lease!.browser.newContext();
  const page = await context.newPage();
  try {
    const consent = await openConsent(page, context);
    const callbacksBefore = callbackReferrers.length;
    const response = page.waitForResponse(isConsentPost);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const denied = await response;
    expect(denied.request().headers().origin).toBe(origin);
    expect(denied.status()).toBe(302);
    expect(await consent!.headerValue('referrer-policy')).toBe('same-origin');
    expect(await denied.headerValue('referrer-policy')).toBe('no-referrer');
    const target = new URL((await denied.headerValue('location'))!);
    expect(target.searchParams.get('error')).toBe('access_denied');
    expect(target.searchParams.get('state')).toBe(STATE);
    expect(target.searchParams.get('iss')).toBe(`${origin}/auth`);
    expect(target.searchParams.has('code')).toBe(false);
    await page.waitForURL(url => url.pathname === '/native-callback');
    expect(callbackReferrers.slice(callbacksBefore)).toEqual([null]);
  } finally { await context.close(); }
}, 30_000);

async function openConsent(page: Page, context: BrowserContext, signedOut = false) {
  const query = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID,
    redirect_uri: redirectUri, scope: 'openid profile email', state: STATE, nonce: NONCE,
    code_challenge: await derivePkceS256Challenge(VERIFIER), code_challenge_method: 'S256' });
  let url = `${origin}/auth/oauth/authorize?${query}`;
  if (signedOut) {
    await page.goto(url);
    const login = new URL(page.url());
    expect(login.pathname).toBe('/login');
    const continuation = login.searchParams.get('redirect');
    expect(continuation).toStartWith('/auth/oauth/authorize?request_id=');
    url = `${origin}${continuation}`;
  }
  // Use an actual Guardian-issued browser cookie, never a spoofed Origin.
  await context.addCookies([{ ...cookie, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  const response = await page.goto(url);
  expect(response!.status()).toBe(200);
  expect(await page.getByRole('heading', { name: 'Continue to Browser Native?', exact: true }).isVisible()).toBe(true);
  expect(await response!.headerValue('content-security-policy')).toContain("form-action 'self'");
  return response;
}

function isConsentPost(response: import('playwright').Response) {
  return response.request().method() === 'POST'
    && response.url() === `${origin}/auth/oauth/authorize`;
}
