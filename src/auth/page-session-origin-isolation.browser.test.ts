/** Real Guardian/browser regression: app-owned cookies must isolate hostname ports. */
import { expect, test } from 'bun:test';
import { contactFixture } from './auth-user-contact.test-fixture';
import { PAGE_SESSION_COOKIE_NAME, resolvePageSessionAuth } from './page-session';
import { getBrowserAuthStorageKeys } from '../frontend/client/auth-browser-coordination';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
browserTest('two real Guardian apps on different localhost ports remain authenticated and logout preserves the other app', async () => {
  const a = contactFixture({ profile: {} }), b = contactFixture({ profile: {} });
  await a.getRuntime().start(); await b.getRuntime().start();
  const nameA = a.getRuntime().getTokenService()!.pageSessionCookieName;
  const nameB = b.getRuntime().getTokenService()!.pageSessionCookieName;
  const serve = (fixture: typeof a) => Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/') return new Response('<!doctype html><meta charset="utf-8"><title>Synthetic cookie evidence</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (path === '/who') { const auth = await resolvePageSessionAuth(request, fixture.getRuntime().getTokenService());
      return Response.json({ authenticated: Boolean(auth), userId: auth?.userId ?? null }); }
    return fixture.app.handle(request);
  } });
  const serverA = serve(a), serverB = serve(b), originA = `http://localhost:${serverA.port}`, originB = `http://localhost:${serverB.port}`;
  const lease = await acquirePlaywrightTestBrowser(), context = await lease.browser.newContext(), page = await context.newPage();
  try {
    expect(getBrowserAuthStorageKeys(originA).namespace === getBrowserAuthStorageKeys(originB).namespace).toBe(false);
    expect(nameA).not.toBe(nameB);
    await page.goto(originA);
    expect(await page.evaluate(async () => (await fetch('/auth/register', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cookie-app-a', email: 'cookie-a@example.test', password: 'password123' }) })).status)).toBe(200);
    expect(await page.evaluate(async () => (await (await fetch('/who')).json()).authenticated)).toBe(true);
    const userA = await page.evaluate(async () => (await (await fetch('/who')).json()).userId);
    const before = (await context.cookies(originA)).find(cookie => cookie.name === nameA);
    expect(Boolean(before?.httpOnly)).toBe(true);
    await page.goto(originB);
    expect(await page.evaluate(async () => (await fetch('/auth/register', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cookie-app-b', email: 'cookie-b@example.test', password: 'password123' }) })).status)).toBe(200);
    const after = (await context.cookies(originA)).find(cookie => cookie.name === nameA);
    expect(after?.value).toBe(before?.value);
    expect((await context.cookies(originB)).some(cookie => cookie.name === nameB && cookie.httpOnly)).toBe(true);
    expect((await context.cookies()).some(cookie => cookie.name === PAGE_SESSION_COOKIE_NAME)).toBe(false);
    expect(await page.evaluate(async () => (await (await fetch('/who')).json()).authenticated)).toBe(true);
    await page.goto(originA);
    expect(await page.evaluate(async () => (await (await fetch('/who')).json()).userId)).toBe(userA);
    await page.goto(originB);
    expect(await page.evaluate(async () => (await fetch('/auth/logout', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status)).toBe(200);
    expect((await context.cookies(originB)).some(cookie => cookie.name === nameB)).toBe(false);
    expect((await context.cookies(originA)).find(cookie => cookie.name === nameA)?.value).toBe(before?.value);
    expect(await page.evaluate(async () => (await (await fetch('/who')).json()).authenticated)).toBe(false);
    await page.goto(originA);
    expect(await page.evaluate(async () => (await (await fetch('/who')).json()).userId)).toBe(userA);
  } finally {
    try { await context.close(); } finally { lease.release();
      try { await serverA.stop(true); await serverB.stop(true); } finally { await a.close(); await b.close(); } }
  }
}, 30_000);
