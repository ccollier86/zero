/** Real Chromium forms must retain issuer Origin without leaking code redirects. */

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { decodeJwt } from 'jose';
import type { BrowserContext, Page } from 'playwright';
import { derivePkceS256Challenge } from '../../auth/native';
import { nativeAuthorizationPage } from '../../auth/oidc/native-authorization-page';
import {
  acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';
import { createApp } from './app-factory';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const CLIENT_ID = 'com.example.browser-native';
const PRIVATE_CALLBACK = 'tv.stupify.provisioner:/oauth/callback';
const HTTPS_CALLBACK = 'https://native-callback.example.test/oauth/callback?channel=app';
const VERIFIER = 'v'.repeat(64), STATE = 's'.repeat(43), NONCE = 'n'.repeat(43);
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let root: string | undefined;
let origin: string, redirectUri: string, userId: string;
let cookie: { name: string; value: string };
let lease: PlaywrightTestBrowserLease | undefined;
let fixtureIdentity: Awaited<ReturnType<typeof lstat>>;
const ownership = JSON.stringify({ schema: 1, kind: 'synthetic-test-fixture', project: 'zero-platform',
  allocator: 'src/frontend/server/native-auth-consent.browser.test.ts', run_id: randomUUID() });
const callbackReferrers: Array<string | null> = [];

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = Bun.env.PROJECT_SCRATCH_DIR ?? join(tmpdir(), 'zero-platform-tests');
  await mkdir(scratch, { recursive: true });
  root = await mkdtemp(join(scratch, 'native-consent-browser-'));
  fixtureIdentity = await lstat(root);
  await writeFile(join(root, '.storage-synthetic-fixture.json'), ownership, { flag: 'wx', mode: 0o600 });
  await mkdir(join(root, 'app'));
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop(true);
  origin = `http://127.0.0.1:${port}`;
  redirectUri = `${origin}/native-callback`;
  app = await createApp({
    app: { name: 'Browser Native Test', publicUrl: origin },
    themeFoundation: 'legacy',
    frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
    db: { mode: 'memory' }, tables: {},
    auth: { tenancy: 'single', bootstrap: 'public', registration: { mode: 'public' },
      accountEmails: { passwordReset: false },
      nativeApps: { clients: [{ clientId: CLIENT_ID, name: 'Browser Native',
        redirectUris: [redirectUri, PRIVATE_CALLBACK, HTTPS_CALLBACK] }] },
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
  // Synthetic negative control only: the same native form with the old
  // self-only default. Its POST still uses the actual managed native endpoint.
  app.get('/fixture/legacy-consent', ({ query }) => nativeAuthorizationPage({
    clientName: 'Browser Native', rawRequestId: String(query.request_id ?? ''),
    scopes: ['openid', 'profile', 'email'], userEmail: 'native-browser@example.test',
  }));
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
  await app?.stop(true);
  if (root) {
    const current = await lstat(root);
    if (current.isSymbolicLink() || current.dev !== fixtureIdentity.dev || current.ino !== fixtureIdentity.ino
      || await readFile(join(root, '.storage-synthetic-fixture.json'), 'utf8') !== ownership) {
      throw new Error('Native consent fixture ownership changed; preserving its exact root.');
    }
    await rm(root, { recursive: true, force: false });
  }
});

browserTest('Continue submits a browser-generated issuer Origin, exchanges its code and suppresses callback referrers', async () => {
  const context = await lease!.browser.newContext();
  try {
    const page = await context.newPage();
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
  try {
    const page = await context.newPage();
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

for (const callback of [PRIVATE_CALLBACK, HTTPS_CALLBACK]) {
  for (const decision of ['approve', 'deny'] as const) {
    browserTest(`${decision} attempts the registered ${callback === PRIVATE_CALLBACK ? 'private-scheme' : 'cross-origin HTTPS'} return without a CSP violation`, async () => {
      const context = await lease!.browser.newContext();
      let observation: Awaited<ReturnType<typeof observeCallback>> | undefined;
      try {
        const page = await context.newPage();
        observation = await observeCallback(page, context, callback);
        const consent = await openConsent(page, context, false, callback);
        const policy = (await consent!.headerValue('content-security-policy'))!;
        const selected = callback === PRIVATE_CALLBACK ? 'tv.stupify.provisioner:' : new URL(HTTPS_CALLBACK).origin;
        expect(policy).toContain(`form-action 'self' ${selected};`);
        expect(policy).not.toContain(callback === PRIVATE_CALLBACK ? 'native-callback.example.test' : 'tv.stupify.provisioner:');
        const post = page.waitForResponse(isConsentPost);
        await page.getByRole('button', { name: decision === 'approve' ? 'Continue' : 'Cancel', exact: true }).click({ noWaitAfter: true });
        const response = await post;
        expect(response.status()).toBe(302);
        expect(response.request().headers().origin).toBe(origin);
        expect(await response.headerValue('referrer-policy')).toBe('no-referrer');
        const target = new URL((await response.headerValue('location'))!);
        expect(target.searchParams.get('state') === STATE).toBe(true);
        expect(target.searchParams.has('code')).toBe(decision === 'approve');
        expect(target.searchParams.get('error')).toBe(decision === 'deny' ? 'access_denied' : null);
        expect(await observation.attempted).toBe(true);
        // Chromium reports policy failures asynchronously after processing a 302.
        await page.waitForTimeout(100);
        expect(observation.violations).toHaveLength(0);
        if (callback === HTTPS_CALLBACK) {
          await page.waitForURL(url => url.origin === new URL(HTTPS_CALLBACK).origin);
          expect(observation.referrerPresent).toEqual([false]);
        }
        if (decision === 'approve') {
          const exchange = await fetch(`${origin}/auth/oauth/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID,
              redirect_uri: callback, code_verifier: VERIFIER, code: target.searchParams.get('code')! }),
          });
          expect(exchange.status).toBe(200);
          const result = await exchange.json() as { id_token: string };
          expect(decodeJwt(result.id_token).sub === userId).toBe(true);
        }
      } finally { try { await observation?.dispose(); } finally { await context.close(); } }
    }, 30_000);
  }
}

browserTest('the legacy self-only negative control blocks a private return after its real consent POST', async () => {
  const context = await lease!.browser.newContext();
  let observation: Awaited<ReturnType<typeof observeCallback>> | undefined;
  try {
    const page = await context.newPage();
    observation = await observeCallback(page, context, PRIVATE_CALLBACK);
    await openConsent(page, context, false, PRIVATE_CALLBACK);
    const requestId = await page.locator('input[name="request_id"]').getAttribute('value');
    if (!requestId) throw new Error('Synthetic native request was not created.');
    const consent = await page.goto(origin + '/fixture/legacy-consent?request_id=' + encodeURIComponent(requestId));
    expect(await consent!.headerValue('content-security-policy')).not.toContain('tv.stupify.provisioner:');
    // A CSP-blocked redirect can suppress Playwright's response event for the
    // initiating POST. Observe its request, then confirm server consumption.
    const post = page.waitForRequest(request => request.method() === 'POST'
      && request.url() === `${origin}/auth/oauth/authorize`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true });
    expect((await post).headers().origin).toBe(origin);
    expect(await observation.blocked).toBe(true);
    expect(observation.violations.length > 0).toBe(true);
    const consumed = await fetch(origin + '/auth/oauth/authorize?request_id=' + encodeURIComponent(requestId),
      { headers: { Cookie: cookie.name + '=' + cookie.value }, redirect: 'manual' });
    expect(consumed.status).toBe(400);
    expect(await consumed.text()).toContain('expired or was already used');
  } finally { try { await observation?.dispose(); } finally { await context.close(); } }
}, 30_000);

/** Observe navigation, never print code-bearing URLs or browser error strings. */
async function observeCallback(page: Page, context: BrowserContext, callback: string) {
  const violations: string[] = [], referrerPresent: boolean[] = [];
  let complete!: (value: boolean) => void;
  let reportBlocked!: (value: boolean) => void;
  const attempted = new Promise<boolean>(resolve => { complete = resolve; });
  const blocked = new Promise<boolean>(resolve => { reportBlocked = resolve; });
  const timer = setTimeout(() => { complete(false); reportBlocked(false); }, 5000);
  const inspectPolicyMessage = (text: string) => {
    if (/form-action/.test(text) && /violat|refused/i.test(text)) {
      if (violations.length < 8) violations.push('form-action');
      complete(false); reportBlocked(true);
    }
  };
  page.on('console', message => inspectPolicyMessage(message.text()));
  const session = await context.newCDPSession(page);
  await session.send('Page.enable');
  await session.send('Log.enable');
  await session.send('Network.enable');
  session.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url.startsWith(callback + (callback.includes('?') ? '&' : '?'))) complete(true);
  });
  session.on('Log.entryAdded', ({ entry }) => inspectPolicyMessage(entry.text));
  // Intercept the callback at Chromium's protocol boundary, including redirects;
  // ordinary Playwright route handlers only intercept the initial URL in a chain.
  // This reserved synthetic HTTPS hostname never reaches DNS or a real service.
  if (callback === HTTPS_CALLBACK) {
    session.on('Fetch.requestPaused', async event => {
      try {
        if (event.request.url.startsWith(HTTPS_CALLBACK)) {
          referrerPresent.push(Object.keys(event.request.headers).some(key => key.toLowerCase() === 'referer'));
          complete(true);
          await session.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
            body: Buffer.from('<!doctype html><title>Synthetic HTTPS callback received</title>').toString('base64') });
        } else {
          await session.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 404, body: '' });
        }
      } catch {
        complete(false); reportBlocked(false);
      }
    });
    await session.send('Fetch.enable', { patterns: [{ urlPattern: 'https://native-callback.example.test/*', requestStage: 'Request' }] });
  }
  return { attempted, blocked, violations, referrerPresent, async dispose() { clearTimeout(timer); await session.detach(); } };
}

async function openConsent(page: Page, context: BrowserContext, signedOut = false, callback = redirectUri) {
  const query = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID,
    redirect_uri: callback, scope: 'openid profile email', state: STATE, nonce: NONCE,
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
