/** Real browser + AuthClient + Guardian HTTP/cookie qualification on synthetic isolated accounts. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { contactFixture } from '../../auth/auth-user-contact.test-fixture';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform/profile-completion-browser';
  const styles = await buildPlatformStyles(root, `${root}/absent-app`); css = await Bun.file(styles.cssPath).text();
  const script = `const result=await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/profile-completion.browser-fixture.tsx`)}],target:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('test')}});if(!result.success){for(const log of result.logs)await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', script], cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' });
  const [output, diagnostics, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (code !== 0) throw new Error(diagnostics || 'Isolated completion browser build failed.');
  bundle = output; lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());
async function open(dark = false) {
  const f = contactFixture({ profile: { completion: { enabled: true }, fields: { firstName: { required: true } } } });
  await f.getRuntime().start();
  const commands: any[] = [], proofs: string[] = [], errors: string[] = [];
  let inspectCount = 0, hold: { started(): void; wait: Promise<void> } | null = null;
  const server = Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(bundle, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
    if (path === '/complete-profile') return new Response(`<html><head><meta charset="utf-8"><style>${css}</style></head><body><main style="max-width:640px;margin:auto;padding:16px"><div id="root"></div></main><script src="/fixture.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (path === '/auth/profile/completion') {
      commands.push(await request.clone().json());
      if (hold) { const gate = hold; hold = null; gate.started(); await gate.wait;
        return Response.json({ code: 'SYNTHETIC_PRIVATE_FAILURE', error: 'NEVER_RENDER_OR_LOG' }, { status: 500 }); }
    }
    if (path.endsWith('/profile/completion/inspect')) inspectCount++;
    const response = await f.app.handle(request);
    if (path === '/auth/register') { const body = await response.clone().json() as any; if (body.profileCompletion?.continuation) proofs.push(body.profileCompletion.continuation); }
    return response;
  } });
  const page = await browser.newPage({ viewport: { width: 640, height: 720 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  const close = async () => { try { await page.close(); } finally { try { await server.stop(true); } finally { await f.close(); } } expect(errors).toEqual([]); };
  try {
    await page.goto(`http://localhost:${server.port}/complete-profile`);
    await page.waitForFunction(() => Boolean(window.__profileCompletionBrowser));
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    await page.evaluate(() => window.__profileCompletionBrowser.start());
    await page.getByRole('textbox', { name: 'First name', exact: false }).waitFor();
  } catch (cause) { await close(); throw cause; }
  return { page, commands, proofs, f, inspectCount: () => inspectCount,
    block() { let release!: () => void, start!: () => void; const wait = new Promise<void>(done => { release = done; }), started = new Promise<void>(done => { start = done; }); hold = { wait, started: start }; return { release, started }; },
    close };
}
browserTest('real required validation stays anonymous; accepted profile installs one full session and HttpOnly page cookie', async () => {
  const h = await open();
  try {
    expect(await h.page.evaluate(() => window.__profileCompletionBrowser.snapshot())).toMatchObject({ authenticated: false, recoverable: false, successes: 0 });
    expect(await h.page.getByRole('textbox', { name: 'Last name', exact: false }).count()).toBe(0);
    await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await h.page.locator('input[aria-invalid="true"]').waitFor(); expect(h.commands).toHaveLength(0);
    await h.page.getByRole('textbox', { name: 'First name', exact: false }).fill('Accepted profile');
    await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await h.page.getByTestId('completed-session').waitFor();
    expect(h.commands).toHaveLength(1); expect(h.commands[0]).toMatchObject({ expectedRevision: 1, changes: { firstName: 'Accepted profile' } });
    expect(Object.keys(h.commands[0].changes)).toEqual(['firstName']);
    expect(await h.page.evaluate(() => window.__profileCompletionBrowser.snapshot())).toMatchObject({ authenticated: true, recoverable: true, successes: 1 });
    const cookie = (await h.page.context().cookies()).find(cookie => cookie.name === h.f.getRuntime().getTokenService()!.pageSessionCookieName);
    expect(cookie?.httpOnly).toBe(true); expect(cookie?.value.length).toBeGreaterThan(40);
    expect(h.page.url()).not.toContain(h.proofs[0]!);
    expect(await h.page.evaluate(proof => Object.values(localStorage).some(value => String(value).includes(proof)), h.proofs[0]!)).toBe(false);
  } finally { await h.close(); }
}, 30_000);
browserTest('real revision conflict preserves the draft; explicit discard/review fetches the latest profile before retry', async () => {
  const h = await open();
  try {
    const user = h.f.getRuntime().getStore()!.getUserByUsername('completion-a')!;
    h.f.getRuntime().getStore()!.updateUser(user.userId, { lastName: 'Administrator edit' });
    const first = h.page.getByRole('textbox', { name: 'First name', exact: false });
    await first.fill('Conflicting draft'); await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
    const review = h.page.getByRole('button', { name: 'Review latest profile', exact: true }); await review.waitFor();
    expect(await first.inputValue()).toBe('Conflicting draft'); expect(h.commands).toHaveLength(1);
    await review.click(); const dialog = h.page.getByRole('alertdialog'); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
    expect(h.inspectCount()).toBe(0); expect(await first.inputValue()).toBe('Conflicting draft');
    await review.click(); await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await h.page.waitForFunction(() => { const input = document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]');
      return input?.value === '' && !input.disabled && !document.querySelector('form[aria-busy="true"]'); });
    expect(h.inspectCount()).toBe(1);
    expect(await h.page.getByRole('textbox', { name: 'Last name', exact: false }).count()).toBe(0);
    await first.fill('Reviewed profile'); await h.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await h.page.getByTestId('completed-session').waitFor(); expect(h.commands[1].expectedRevision).toBe(2);
    expect(h.f.getRuntime().getStore()!.getUserById(user.userId)!.lastName).toBe('Administrator edit');
  } finally { await h.close(); }
}, 30_000);
browserTest('replacement anonymous identity retires a held completion, duplicate submission and late errors', async () => {
  const h = await open(), gate = h.block();
  try {
    await h.page.getByRole('textbox', { name: 'First name', exact: false }).fill('Old identity draft');
    await h.page.getByRole('button', { name: 'Continue', exact: true }).click(); await gate.started;
    expect(await h.page.getByRole('button', { name: 'Completing profile…', exact: true }).isDisabled()).toBe(true);
    expect(h.commands).toHaveLength(1);
    await h.page.evaluate(() => window.__profileCompletionBrowser.start('completion-b')); gate.release();
    await h.page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.value === '');
    expect(await h.page.evaluate(() => window.__profileCompletionBrowser.snapshot())).toMatchObject({ authenticated: false, recoverable: false, successes: 0, error: null });
    expect(await h.page.locator('body').innerText()).not.toContain('NEVER_RENDER_OR_LOG'); expect(await h.page.getByRole('alert').count()).toBe(0);
  } finally { gate.release(); await h.close(); }
}, 30_000);
for (const dark of [false, true]) browserTest(`first-use controls stay labeled/reachable at 320px with ${dark ? 'dark' : 'light'} tokens`, async () => {
  const h = await open(dark);
  try {
    await h.page.setViewportSize({ width: 320, height: 640 });
    expect(await h.page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const first = h.page.getByRole('textbox', { name: 'First name', exact: false }); await first.focus();
    expect(await first.evaluate(input => input === document.activeElement)).toBe(true);
    const box = await h.page.getByRole('button', { name: 'Continue', exact: true }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  } finally { await h.close(); }
}, 30_000);
