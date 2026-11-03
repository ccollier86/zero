/** Real Chromium native form/SDK interactions with controlled HTTP failures; the managed-server journey is separate. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page, Route } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const result = await Bun.build({ entrypoints: [import.meta.dir + '/password-action-form.browser-fixture.tsx'],
    target: 'browser', format: 'esm', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!result.success) throw new Error('Password form fixture build failed.');
  bundle = await result.outputs[0]!.text(); lease = await acquirePlaywrightTestBrowser();
}, 60000);
afterAll(() => lease?.release());

const user = { userId: 'password-fixture', username: 'password-fixture', email: 'password@example.test', firstName: 'Synthetic', lastName: null,
  role: 'user', status: 'active', passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false,
  mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null };
const info = (type = 'password_reset') => ({ valid: true, type, expiresAt: Date.now() + 3600000, user });
const complete = () => ({ user, passwordUpdated: true, signInRequired: true });
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
type Options = { token?: string; mode?: 'reset' | 'setup'; inspect?: (route: Route, index: number) => Promise<void>;
  write?: (route: Route, index: number) => Promise<void>; clock?: boolean };
async function open(options: Options = {}) {
  const page = await lease!.browser.newPage(); const errors: string[] = [];
  if (options.clock) await page.clock.install();
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(5000);
  const inspections: string[] = [], writes: { path: string; token: string }[] = [];
  await page.route('http://password.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/auth/action-token/')) {
      expect(route.request().headers().referer).toBeUndefined();
      inspections.push(url.pathname.slice('/auth/action-token/'.length));
      return options.inspect ? options.inspect(route, inspections.length) : json(route, info(options.mode === 'setup' ? 'account_setup' : 'password_reset'));
    }
    if (route.request().method() === 'POST' && ['/auth/reset-password', '/auth/setup-password'].includes(url.pathname)) {
      expect(route.request().headers().referer).toBeUndefined();
      const body = route.request().postDataJSON(); writes.push({ path: url.pathname, token: body.token });
      return options.write ? options.write(route, writes.length) : json(route, complete());
    }
    if (url.pathname.startsWith('/auth/')) return json(route, {});
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Password fixture</title><div id="root"></div>' });
  });
  const url = new URL('/' + (options.mode === 'setup' ? 'setup-password' : 'reset-password'), 'http://password.test');
  if (options.token !== '') url.searchParams.set('token', options.token ?? 'synthetic-original-proof');
  await page.goto(url.href); await page.addScriptTag({ content: bundle, type: 'module' });
  return { page, inspections, writes, async close() { await page.close(); expect(errors).toEqual([]); } };
}
const form = (page: Page) => page.locator('[data-slot="password-action-form"]');
async function fill(page: Page) {
  await page.getByLabel('New password', { exact: true }).fill('Replacement-password-123!');
  await page.getByLabel('Confirm password', { exact: true }).fill('Replacement-password-123!');
}
async function noTokenEntry(page: Page) {
  expect(await page.getByLabel('Email token', { exact: true }).count()).toBe(0);
  expect(await page.getByPlaceholder('Paste token').count()).toBe(0);
}
async function waitCount(page: Page, count: () => number, expected: number) {
  const deadline = Date.now() + 5000;
  while (count() !== expected) {
    if (Date.now() >= deadline) throw new Error('Synthetic password request count did not settle.');
    await page.waitForTimeout(10);
  }
}

browserTest('missing proof explains the emailed link and offers recovery without inspection, password writes or token entry', async () => {
  const h = await open({ token: '' });
  try {
    await h.page.getByRole('heading', { name: 'Open the link in your email', exact: true }).waitFor();
    await noTokenEntry(h.page); expect(h.inspections).toHaveLength(0); expect(h.writes).toHaveLength(0);
    expect(await h.page.getByRole('link', { name: 'Request a new reset link' }).getAttribute('href')).toBe('/forgot-password');
  } finally { await h.close(); }
});

for (const [code, title] of [['ACTION_TOKEN_CONSUMED', 'This password link has already been used'],
  ['ACTION_TOKEN_EXPIRED', 'This password link has expired'], ['ACTION_TOKEN_INVALID', 'This password link is no longer valid']] as const) {
  browserTest(`${code} has readable recovery instead of an unusable technical token fallback`, async () => {
    const h = await open({ inspect: route => json(route, { code, error: 'PRIVATE_BEARER_FROM_SERVICE' }, 400) });
    try {
      await h.page.getByRole('heading', { name: title, exact: true }).waitFor(); await noTokenEntry(h.page);
      expect(await form(h.page).count()).toBe(0); expect(h.writes).toHaveLength(0);
      expect(await h.page.getByText('PRIVATE_BEARER_FROM_SERVICE').count()).toBe(0);
      expect(JSON.stringify(await h.page.evaluate(() => window.__passwordForm.observations))).not.toContain('PRIVATE_BEARER_FROM_SERVICE');
    } finally { await h.close(); }
  });
}

for (const kind of ['network', 'server', 'null'] as const) browserTest(`${kind} link-check failure supports explicit read-only Retry and retains the email proof`, async () => {
  const h = await open({ inspect: (route, index) => index > 1 ? json(route, info())
    : kind === 'network' ? route.abort('failed') : kind === 'null' ? json(route, null) : json(route, { code: 'AUTH_NOT_READY', error: 'PRIVATE_SERVICE_DETAIL' }, 503) });
  try {
    await h.page.getByRole('button', { name: 'Retry link check', exact: true }).waitFor(); await noTokenEntry(h.page);
    expect(h.inspections).toHaveLength(1); expect(h.writes).toHaveLength(0);
    await h.page.getByRole('button', { name: 'Retry link check', exact: true }).click(); await form(h.page).waitFor();
    expect(h.inspections).toEqual(['synthetic-original-proof', 'synthetic-original-proof']); expect(h.writes).toHaveLength(0);
  } finally { await h.close(); }
});

browserTest('a stalled link check is bounded and caller-cancelled; manual Retry checks the same proof without mutation', async () => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const h = await open({ clock: true, inspect: async (route, index) => {
    if (index === 1) await held;
    await json(route, info());
  } });
  try {
    await waitCount(h.page, () => h.inspections.length, 1); await h.page.clock.fastForward(15001);
    await h.page.getByRole('button', { name: 'Retry link check', exact: true }).waitFor(); await noTokenEntry(h.page);
    await h.page.getByRole('button', { name: 'Retry link check', exact: true }).click(); await form(h.page).waitFor();
    release(); expect(h.inspections).toHaveLength(2); expect(h.writes).toHaveLength(0);
  } finally { release(); await h.close(); }
});

browserTest('malformed inspection fails safely and a definitive invalid flag never renders a password form', async () => {
  const malformed = await open({ inspect: route => json(route, { valid: true, type: 'password_reset' }) });
  try { await malformed.page.getByRole('button', { name: 'Retry link check', exact: true }).waitFor();
    expect(await form(malformed.page).count()).toBe(0); await noTokenEntry(malformed.page);
  } finally { await malformed.close(); }
  const invalid = await open({ inspect: route => json(route, { ...info(), valid: false }) });
  try { await invalid.page.getByRole('heading', { name: 'This password link is no longer valid', exact: true }).waitFor();
    expect(await form(invalid.page).count()).toBe(0); expect(invalid.writes).toHaveLength(0);
  } finally { await invalid.close(); }
});

browserTest('local password mismatch and minimum length do not send any credential writes', async () => {
  const h = await open();
  try {
    await form(h.page).waitFor();
    await h.page.getByLabel('New password', { exact: true }).fill('short');
    await h.page.getByLabel('Confirm password', { exact: true }).fill('short');
    await form(h.page).evaluate(node => (node as HTMLFormElement).requestSubmit()); expect(h.writes).toHaveLength(0);
    await h.page.getByLabel('New password', { exact: true }).fill('Replacement-password-123!');
    await h.page.getByLabel('Confirm password', { exact: true }).fill('Different-password-123!');
    await form(h.page).evaluate(node => (node as HTMLFormElement).requestSubmit());
    await h.page.getByText('Passwords do not match.', { exact: true }).waitFor(); expect(h.writes).toHaveLength(0);
  } finally { await h.close(); }
});

browserTest('a token rejected at final submission is explained without treating it as a connection failure or replaying the write', async () => {
  const h = await open({ write: route => json(route, { code: 'ACTION_TOKEN_EXPIRED', error: 'Expired' }, 400) });
  try {
    await form(h.page).waitFor(); await fill(h.page); await h.page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await h.page.getByRole('heading', { name: 'This password link has expired', exact: true }).waitFor();
    await noTokenEntry(h.page); expect(h.writes).toHaveLength(1); expect(await h.page.evaluate(() => window.__passwordForm.successes)).toBe(0);
  } finally { await h.close(); }
});

browserTest('a verified native rollback allows manual read-check recovery, never automatic password resubmission', async () => {
  const h = await open({ write: (route, index) => index === 1
    ? json(route, { code: 'AUTH_COMMIT_CONFLICT', error: 'Not committed', retryable: true }, 409) : json(route, complete()) });
  try {
    await form(h.page).waitFor(); await fill(h.page); await h.page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await h.page.getByRole('heading', { name: 'The password update was not applied', exact: true }).waitFor();
    expect(h.writes).toHaveLength(1);
    await h.page.getByRole('button', { name: 'Retry link check', exact: true }).click(); await form(h.page).waitFor();
    expect(h.writes).toHaveLength(1); expect(await h.page.getByLabel('New password', { exact: true }).inputValue()).toBe('');
    await fill(h.page); await h.page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await h.page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor(); expect(h.writes).toHaveLength(2);
  } finally { await h.close(); }
});

browserTest('valid form supplies password-manager account/new-password semantics and prevents duplicate submission', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const h = await open({ write: async route => { await held; await json(route, complete()); } });
  try {
    await form(h.page).waitFor(); await noTokenEntry(h.page);
    expect(await form(h.page).getAttribute('method')).toBe('post');
    expect(await h.page.locator('input[autocomplete="username"]').inputValue()).toBe(user.username);
    expect(await h.page.locator('input[autocomplete="new-password"]').count()).toBe(2);
    expect(await h.page.getByLabel('New password', { exact: true }).getAttribute('name')).toBe('newPassword');
    await fill(h.page);
    await form(h.page).evaluate(node => { (node as HTMLFormElement).requestSubmit(); (node as HTMLFormElement).requestSubmit(); });
    await waitCount(h.page, () => h.writes.length, 1); release();
    await h.page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor();
    expect(h.writes).toEqual([{ path: '/auth/reset-password', token: 'synthetic-original-proof' }]);
    expect(await h.page.evaluate(() => window.__passwordForm.successes)).toBe(1);
    expect(await h.page.locator('input[type="password"]').count()).toBe(0);
  } finally { release(); await h.close(); }
});

browserTest('wrong-kind links fail closed; setup uses its own endpoint and administrator-specific recovery', async () => {
  const wrong = await open({ inspect: route => json(route, info('account_setup')) });
  try { await wrong.page.getByRole('heading', { name: 'This is a different kind of link', exact: true }).waitFor();
    expect(await form(wrong.page).count()).toBe(0); expect(wrong.writes).toHaveLength(0); await noTokenEntry(wrong.page);
  } finally { await wrong.close(); }
  const setup = await open({ mode: 'setup' });
  try { await form(setup.page).waitFor(); await fill(setup.page); await setup.page.getByRole('button', { name: 'Set password', exact: true }).click();
    await setup.page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor(); expect(setup.writes[0]!.path).toBe('/auth/setup-password');
  } finally { await setup.close(); }
  const missing = await open({ mode: 'setup', token: '' });
  try { await missing.page.getByText('If you need a new account setup link, ask your administrator to resend the setup email.', { exact: true }).waitFor();
    expect(await missing.page.getByRole('link', { name: 'Request a new reset link' }).count()).toBe(0); await noTokenEntry(missing.page);
  } finally { await missing.close(); }
});

browserTest('a newly opened link retires old inspection replies and drafts without a manual token prompt', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const h = await open({ inspect: async (route, index) => {
    if (index === 1) { await held; await json(route, { code: 'ACTION_TOKEN_CONSUMED', error: 'Consumed' }, 400); }
    else await json(route, info());
  } });
  try {
    await waitCount(h.page, () => h.inspections.length, 1);
    await h.page.evaluate(() => window.__passwordForm.replaceToken('synthetic-fresh-proof'));
    await form(h.page).waitFor(); release(); await h.page.waitForTimeout(50);
    await fill(h.page); await h.page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await h.page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor();
    expect(h.writes[0]!.token).toBe('synthetic-fresh-proof'); await noTokenEntry(h.page);
    await h.page.evaluate(() => window.__passwordForm.replaceToken('synthetic-third-proof'));
    await form(h.page).waitFor(); expect(await h.page.getByLabel('New password', { exact: true }).inputValue()).toBe('');
    expect(await h.page.getByRole('heading', { name: 'Password updated', exact: true }).count()).toBe(0);
  } finally { release(); await h.close(); }
});

for (const kind of ['network', 'unknown', 'malformed'] as const) browserTest(`${kind} password response remains unresolved without success or automatic replay`, async () => {
  const h = await open({ write: route => kind === 'network' ? route.abort('failed') : kind === 'malformed' ? json(route, {})
    : json(route, { code: 'LOGGING_OUTCOME_UNKNOWN', error: 'PRIVATE_PROVIDER_DETAIL', retryable: true }, 503) });
  try {
    await form(h.page).waitFor(); await fill(h.page); await h.page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await h.page.getByRole('heading', { name: 'We couldn’t confirm the password update', exact: true }).waitFor();
    await noTokenEntry(h.page); expect(await form(h.page).count()).toBe(0);
    expect(await h.page.getByRole('button', { name: 'Retry link check' }).count()).toBe(0);
    expect(await h.page.evaluate(() => window.__passwordForm.successes)).toBe(0); expect(h.writes).toHaveLength(1);
    expect(JSON.stringify(await h.page.evaluate(() => window.__passwordForm.observations))).not.toContain('PRIVATE_PROVIDER_DETAIL');
  } finally { await h.close(); }
});

for (const replacement of ['token', 'client', 'unmount'] as const) browserTest(`late password completion cannot notify a ${replacement} replacement`, async () => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const h = await open({ write: async route => { await held; await json(route, complete()); } });
  try {
    await form(h.page).waitFor(); await fill(h.page); await h.page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await waitCount(h.page, () => h.writes.length, 1);
    await h.page.evaluate(replacement => {
      if (replacement === 'token') window.__passwordForm.replaceToken('synthetic-replacement-proof');
      if (replacement === 'client') window.__passwordForm.replaceClient();
      if (replacement === 'unmount') window.__passwordForm.hide();
    }, replacement);
    release(); await h.page.waitForTimeout(100);
    expect(await h.page.evaluate(() => window.__passwordForm.successes)).toBe(0); expect(h.writes).toHaveLength(1);
    expect(await h.page.getByRole('heading', { name: 'Password updated', exact: true }).count()).toBe(0);
  } finally { release(); await h.close(); }
});

browserTest('a host callback exception does not turn confirmed success into a failed save', async () => {
  const h = await open();
  try { await form(h.page).waitFor(); await h.page.evaluate(() => window.__passwordForm.throwOnSuccess()); await fill(h.page);
    await h.page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await h.page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor(); expect(h.writes).toHaveLength(1);
    expect(await h.page.getByRole('alert').count()).toBe(0);
    expect(JSON.stringify(await h.page.evaluate(() => window.__passwordForm.observations))).not.toContain('PRIVATE_NOTIFICATION_ERROR');
  } finally { await h.close(); }
});
