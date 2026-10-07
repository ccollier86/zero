/** Styled, actual adaptive profile composition with synthetic acknowledged receipts and current public hooks. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const failures = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform/profile-settings-browser';
  const styles = await buildPlatformStyles(root, `${root}/absent-app`); css = await Bun.file(styles.cssPath).text();
  const script = `const result=await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/profile-settings.browser-fixture.tsx`)}],target:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('test')}});if(!result.success){for(const log of result.logs)await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', script], cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' });
  const [output, diagnostics, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (code !== 0) throw new Error(diagnostics || 'Isolated profile build failed.');
  bundle = output; lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());
async function open(dark = false) {
  const page = await browser.newPage({ viewport: { width: 760, height: 680 } });
  const errors: string[] = []; failures.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  await page.route('http://profile-settings.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('http://profile-settings.test/settings'); await page.addStyleTag({ content: css });
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
  await page.addScriptTag({ content: bundle }); await page.getByRole('textbox', { name: 'First name', exact: false }).waitFor(); return page;
}
async function close(page: Page) { expect(failures.get(page)).toEqual([]); await page.close(); }
async function chooseAvatar(page: Page) {
  await page.locator('[data-slot="avatar-editor"] button.zero-avatar-editor-trigger').click();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120;
    const context = canvas.getContext('2d')!; context.fillStyle = '#2563eb'; context.fillRect(0, 0, 240, 120);
    context.fillStyle = '#f59e0b'; context.fillRect(100, 0, 40, 120); return canvas.toDataURL('image/png').split(',')[1]!;
  });
  // Playwright's in-memory file fixture requires its Buffer bridge; no Node filesystem APIs or persistent user files.
  await page.getByLabel('Profile picture file', { exact: true }).setInputFiles({ name: 'synthetic-picture.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.reactEasyCrop_Image')?.naturalWidth === 240);
  await dialog.getByRole('button', { name: 'Save picture', exact: true }).waitFor();
  return dialog;
}

browserTest('profile page submits only dirty fields and adopts the acknowledged canonical revision', async () => {
  const page = await open();
  try {
    expect(await page.getByText('Current default: English (United States)', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Current default: 24-hour · 15:30', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Current default: Monday', { exact: true }).count()).toBe(1);
    await page.getByRole('textbox', { name: 'First name' }).fill('Submitted');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 1);
    expect(await page.evaluate(() => window.__profileSettings.calls[0]!.input)).toEqual({ expectedRevision: 1, changes: { firstName: 'Submitted' } });
    await page.evaluate(() => window.__profileSettings.resolve(0, 'Canonical'));
    await page.waitForFunction(() => !document.querySelector('[data-slot="form-save-bar"]'));
    expect(await page.getByRole('textbox', { name: 'First name' }).inputValue()).toBe('Canonical');
    await page.getByRole('textbox', { name: 'First name' }).fill('Next');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 2);
    expect(await page.evaluate(() => window.__profileSettings.calls[1]!.input.expectedRevision)).toBe(2);
  } finally { await close(page); }
}, 30_000);

browserTest('avatar readiness preserves core drafts and an accepted picture advances only their shared profile revision', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'About you' }).fill('Unsubmitted biography');
    await page.evaluate(() => window.__profileSettings.enableAvatars());
    expect(await page.getByRole('textbox', { name: 'About you' }).inputValue()).toBe('Unsubmitted biography');
    const dialog = await chooseAvatar(page);
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
    expect(await dialog.locator('output').innerText()).toBe('120%');
    await dialog.getByRole('button', { name: 'Save picture', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.avatarCalls.length === 1);
    expect(await page.evaluate(() => ({ revision: window.__profileSettings.avatarCalls[0]!.revision,
      type: window.__profileSettings.avatarCalls[0]!.image!.type, size: window.__profileSettings.avatarCalls[0]!.image!.size > 0 }))).toEqual({ revision: 1, type: 'image/webp', size: true });
    expect(await page.evaluate(async () => {
      const bitmap = await createImageBitmap(window.__profileSettings.avatarCalls[0]!.image!);
      const dimensions = [bitmap.width, bitmap.height]; bitmap.close(); return dimensions;
    })).toEqual([512, 512]);
    // The real modal intentionally aria-hides background profile fields.
    expect(await page.locator('textarea').inputValue()).toBe('Unsubmitted biography');
    await page.evaluate(() => window.__profileSettings.resolveAvatar(0)); await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__profileSettings.avatarDeliveries.length === 1);
    expect(await page.getByRole('textbox', { name: 'About you' }).inputValue()).toBe('Unsubmitted biography');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 1);
    expect(await page.evaluate(() => window.__profileSettings.calls[0]!.input)).toEqual({ expectedRevision: 2, changes: { bio: 'Unsubmitted biography' } });
  } finally { await close(page); }
}, 30_000);

browserTest('async avatar accepted-notification rejection is observed safely without undoing or repeating the accepted image', async () => {
  const page = await open();
  try {
    await page.evaluate(async () => { await window.__profileSettings.enableAvatars(); window.__profileSettings.showAvatarConsumer(); });
    const dialog = await chooseAvatar(page); await dialog.getByRole('button', { name: 'Save picture', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.avatarCalls.length === 1);
    await page.evaluate(() => window.__profileSettings.resolveAvatar(0)); await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__profileSettings.observationEvents.some(event => event.metadata?.action === 'userAvatarAcceptedCallback'), undefined, { timeout: 2500 });
    const event = await page.evaluate(() => window.__profileSettings.observationEvents.find(event => event.metadata?.action === 'userAvatarAcceptedCallback'));
    expect(event?.code).toBe('frontend.auth.action_failed'); expect(event?.error).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('PRIVATE_AVATAR_CALLBACK_FAILURE');
    expect(await page.locator('[data-slot="avatar-editor"] [data-slot="avatar-image"]').count()).toBe(1);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.evaluate(() => window.__profileSettings.avatarCalls.length)).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('late async avatar notification failure is retired with its originating account', async () => {
  const page = await open();
  try {
    await page.evaluate(async () => { await window.__profileSettings.enableAvatars(); window.__profileSettings.showAvatarConsumer(true); });
    const dialog = await chooseAvatar(page); await dialog.getByRole('button', { name: 'Save picture', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.avatarCalls.length === 1);
    await page.evaluate(() => window.__profileSettings.resolveAvatar(0)); await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__profileSettings.avatarAcceptedCallbacks.length === 1);
    await page.locator('[data-slot="avatar-editor"] [data-slot="avatar-image"]').waitFor();
    await page.evaluate(() => { window.__profileSettings.replaceUser(); window.__profileSettings.rejectAvatarAccepted(0); });
    await page.waitForFunction(() => !document.querySelector('[data-slot="avatar-image"]'));
    expect(await page.evaluate(() => window.__profileSettings.observationEvents.filter(event => event.metadata?.action === 'userAvatarAcceptedCallback'))).toEqual([]);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.evaluate(() => window.__profileSettings.avatarCalls.length)).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('avatar shape/presence obeys actual optional fresh observations and read-only prevents file selection', async () => {
  const page = await open();
  try {
    await page.evaluate(async () => { window.__profileSettings.setProps({ presence: false }); await window.__profileSettings.enableAvatars('square'); });
    const avatar = page.locator('[data-slot="avatar-editor"]'); await avatar.waitFor();
    expect(await avatar.locator('[data-slot="avatar-presence-indicator"]').count()).toBe(0);
    await page.evaluate(() => window.__profileSettings.setAvatarPresence(true));
    const ring = avatar.locator('[data-slot="avatar-presence-indicator"]'); await ring.waitFor();
    expect(await ring.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
    expect(await avatar.getByRole('button', { name: /Available/ }).count()).toBe(1);
    await page.evaluate(() => window.__profileSettings.setAvatarPresence(true, true)); await ring.waitFor({ state: 'hidden' });
    expect(await avatar.getByRole('button', { name: /Available/ }).count()).toBe(0);
    await page.evaluate(() => window.__profileSettings.setProps({ mode: 'read-only' }));
    await avatar.getByRole('img', { name: 'Jane Doe', exact: true }).waitFor();
    expect(await avatar.getByRole('button').count()).toBe(0);
    expect(await page.getByLabel('Profile picture file', { exact: true }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('invalid avatar raster presents an actionable decode error without uploading or fabricating a saved picture', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableAvatars());
    await page.locator('[data-slot="avatar-editor"] button.zero-avatar-editor-trigger').click();
    await page.getByLabel('Profile picture file', { exact: true }).setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    const dialog = page.getByRole('dialog'); await dialog.getByRole('alert').waitFor();
    expect(await dialog.getByRole('alert').innerText()).toContain('could not be read');
    expect(await dialog.getByRole('button', { name: 'Save picture', exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.__profileSettings.avatarCalls.length)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('avatar cancel does not save and capability retirement aborts an in-flight crop without late errors', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableAvatars('square'));
    const dialog = await chooseAvatar(page); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); expect(await page.evaluate(() => window.__profileSettings.avatarCalls.length)).toBe(0);
    await page.waitForFunction(() => document.activeElement?.classList.contains('zero-avatar-editor-trigger'));
    const crop = await chooseAvatar(page); await crop.getByRole('button', { name: 'Save picture', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.avatarCalls.length === 1);
    await page.evaluate(() => window.__profileSettings.setAvatarPolicy(false));
    await page.waitForFunction(() => window.__profileSettings.avatarCalls[0]!.signal?.aborted === true);
    await crop.waitFor({ state: 'hidden' }); await page.evaluate(() => window.__profileSettings.rejectAvatar(0));
    expect(await page.locator('[data-slot="avatar-editor"] button.zero-avatar-editor-trigger').count()).toBe(0);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.locator('[data-slot="avatar-editor"]').getAttribute('data-shape')).toBe('square');
  } finally { await close(page); }
}, 30_000);

browserTest('avatar revision conflict retains the crop and honors Stay/Discard before reviewing newer core profile values', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'About you' }).fill('Unsubmitted biography');
    await page.evaluate(() => window.__profileSettings.enableAvatars());
    const dialog = await chooseAvatar(page); await dialog.getByRole('button', { name: 'Save picture', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.avatarCalls.length === 1);
    await page.evaluate(() => { window.__profileSettings.installLatest(); window.__profileSettings.rejectAvatar(0, true); });
    await dialog.getByRole('alert').waitFor(); expect(await dialog.getByRole('alert').innerText()).toContain('changed elsewhere');
    await dialog.getByRole('button', { name: 'Review latest profile', exact: true }).click();
    const decision = page.getByRole('alertdialog'); await decision.waitFor();
    await decision.getByRole('button', { name: 'Stay', exact: true }).click();
    await decision.waitFor({ state: 'hidden' }); expect(await dialog.count()).toBe(1);
    expect(await page.locator('textarea').inputValue()).toBe('Unsubmitted biography');
    await dialog.getByRole('button', { name: 'Review latest profile', exact: true }).click();
    await decision.waitFor(); await decision.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.value === 'Other writer');
    expect(await page.getByRole('textbox', { name: 'About you' }).inputValue()).toBe('Saved biography');
    expect(await page.evaluate(() => window.__profileSettings.avatarCalls.length)).toBe(1);
  } finally { await close(page); }
}, 30_000);

for (const dark of [false, true]) browserTest(`avatar crop has a fade-only stable square surface and reachable actions at320px with ${dark ? 'dark' : 'light'} tokens`, async () => {
  const page = await open(dark);
  try {
    await page.evaluate(() => window.__profileSettings.enableAvatars('rounded')); await page.setViewportSize({ width: 320, height: 600 });
    const dialog = await chooseAvatar(page);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="dialog"]')!).opacity === '1');
    const geometry = await dialog.evaluate(element => {
      const surface = element.querySelector('[data-slot="avatar-crop-surface"]')!.getBoundingClientRect();
      const controls = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect());
      return { width: document.documentElement.scrollWidth, square: Math.abs(surface.width - surface.height) < 1,
        controls: controls.every(box => box.left >= 0 && box.right <= 320 && box.bottom <= 600), transform: getComputedStyle(element).transform };
    });
    expect(geometry.width).toBe(320); expect(geometry.square).toBe(true); expect(geometry.controls).toBe(true);
    expect(geometry.transform).not.toContain('matrix3d');
    expect(await page.evaluate(() => [...document.querySelectorAll('style')].filter(element => element.textContent?.includes('.reactEasyCrop_Container')).length)).toBe(1);
    await page.screenshot({ path: `/Volumes/code-bank/artifacts/zero-platform/diagnostics/avatar-crop-${dark ? 'dark' : 'light'}.png` });
  } finally { await close(page); }
}, 30_000);

browserTest('field Cancel never saves and invalid required field save is blocked with a field error', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.setProps({ saveMode: 'field' }));
    const first = page.getByRole('textbox', { name: 'First name' }); await first.fill('Changed');
    await page.getByRole('button', { name: 'Cancel First name changes', exact: true }).click();
    expect(await first.inputValue()).toBe('Jane'); expect(await page.evaluate(() => window.__profileSettings.calls.length)).toBe(0);
    await first.fill(''); await page.getByRole('button', { name: 'Save First name', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-invalid="true"]'), undefined, { timeout: 2500 });
    expect(await page.evaluate(() => window.__profileSettings.calls.length)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('field acknowledgment changes only its baseline while other dirty fields remain', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.setProps({ saveMode: 'field' }));
    await page.getByRole('textbox', { name: 'First name' }).fill('Submitted');
    await page.getByRole('textbox', { name: 'About you' }).fill('Unsubmitted biography');
    await page.getByRole('button', { name: 'Save First name', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 1);
    expect(await page.evaluate(() => window.__profileSettings.calls[0]!.input)).toEqual({ expectedRevision: 1, changes: { firstName: 'Submitted' } });
    await page.evaluate(() => window.__profileSettings.resolve(0, 'Canonical'));
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.value === 'Canonical');
    expect(await page.getByRole('textbox', { name: 'About you' }).inputValue()).toBe('Unsubmitted biography');
    await page.getByRole('button', { name: 'Cancel About you changes', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'About you' }).inputValue()).toBe('Saved biography');
    expect(await page.locator('[data-slot="form-save-bar"]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('field-mode taken username remains correctable without reload or loss of another dirty field', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableUsername());
    await page.evaluate(() => window.__profileSettings.setProps({ saveMode: 'field' }));
    const gets = await page.evaluate(() => window.__profileSettings.gets());
    const username = page.getByRole('textbox', { name: 'Username', exact: false });
    await page.getByRole('textbox', { name: 'About you' }).fill('Unsubmitted biography');
    await username.fill('taken-name');
    await page.getByRole('button', { name: 'Save Username', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 1);
    await page.evaluate(() => window.__profileSettings.rejectUsername(0));
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').innerText()).toContain('Choose another username');
    expect(await username.inputValue()).toBe('taken-name');
    expect(await page.getByRole('button', { name: 'Save Username', exact: true }).isDisabled()).toBe(false);
    await username.fill('available-name');
    await page.getByRole('button', { name: 'Save Username', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 2);
    expect(await page.evaluate(() => window.__profileSettings.calls[1]!.input))
      .toEqual({ expectedRevision: 1, changes: { username: 'available-name' } });
    await page.evaluate(() => window.__profileSettings.resolve(1));
    await page.getByRole('button', { name: 'Save Username', exact: true }).waitFor({ state: 'hidden' });
    expect(await username.inputValue()).toBe('available-name');
    expect(await page.getByRole('textbox', { name: 'About you' }).inputValue()).toBe('Unsubmitted biography');
    expect(await page.evaluate(() => window.__profileSettings.gets())).toBe(gets);
    expect(await page.locator('body').innerText()).not.toContain('NEVER_RENDER_OR_LOG');
  } finally { await close(page); }
}, 30_000);

browserTest('field revision conflict preserves its draft and cannot retry until explicit latest-profile review', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.setProps({ saveMode: 'field' }));
    await page.getByRole('textbox', { name: 'First name' }).fill('Conflicting draft');
    await page.getByRole('button', { name: 'Save First name', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 1);
    await page.evaluate(() => { window.__profileSettings.installLatest(); window.__profileSettings.reject(0, true); });
    await page.getByRole('button', { name: 'Review latest profile', exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'First name' }).inputValue()).toBe('Conflicting draft');
    expect(await page.getByRole('button', { name: 'Save First name', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect(await page.evaluate(() => window.__profileSettings.calls.length)).toBe(1);
    await page.getByRole('button', { name: 'Review latest profile', exact: true }).click();
    const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.value === 'Other writer');
    await page.getByRole('textbox', { name: 'First name' }).fill('Reviewed change');
    await page.getByRole('button', { name: 'Save First name', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 2);
    expect(await page.evaluate(() => window.__profileSettings.calls[1]!.input.expectedRevision)).toBe(7);
    expect(await page.locator('body').innerText()).not.toContain('NEVER_RENDER_OR_LOG');
  } finally { await close(page); }
}, 30_000);

browserTest('switching to read-only retires an in-flight page save without retaining draft controls or errors', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'First name' }).fill('Pending draft');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 1);
    await page.evaluate(() => window.__profileSettings.setProps({ mode: 'read-only' }));
    await page.waitForFunction(() => window.__profileSettings.calls[0]!.signal?.aborted === true);
    expect(await page.getByRole('textbox', { name: 'First name' }).inputValue()).toBe('Jane');
    await page.evaluate(() => window.__profileSettings.reject(0));
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.disabled, undefined, { timeout: 2500 });
    expect(await page.getByRole('textbox', { name: 'First name' }).isDisabled()).toBe(false);
    expect(await page.locator('[data-slot="form-save-bar"]').count()).toBe(0);
    expect(await page.getByRole('alertdialog').count()).toBe(0); expect(await page.getByRole('alert').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('blocked migration capability has an actionable state and does not query profile data', async () => {
  const page = await open();
  try {
    const gets = await page.evaluate(() => window.__profileSettings.gets());
    await page.evaluate(() => window.__profileSettings.setPolicy('blocked'));
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').innerText()).toContain('database migration');
    expect(await page.locator('[data-slot="user-profile-settings"]').count()).toBe(0);
    expect(await page.evaluate(() => window.__profileSettings.gets())).toBe(gets);
  } finally { await close(page); }
}, 30_000);

browserTest('retained field callback cannot write a replacement account before React is notified', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.setProps({ saveMode: 'field' }));
    await page.getByRole('textbox', { name: 'First name' }).fill('Old account draft');
    await page.evaluate(() => {
      window.__profileSettings.replaceUser(false);
      document.querySelector<HTMLButtonElement>('button[aria-label="Save First name"]')!.click();
      window.__profileSettings.notify();
    });
    expect(await page.evaluate(() => window.__profileSettings.calls.length)).toBe(0);
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.value === 'Other', undefined, { timeout: 2500 });
  } finally { await close(page); }
}, 30_000);

browserTest('avatar/profile account replacement never re-labels a retained old snapshot while the new own-profile read is pending', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableAvatars());
    const dialog = await chooseAvatar(page); await dialog.getByRole('button', { name: 'Save picture', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.avatarCalls.length === 1);
    await page.evaluate(() => window.__profileSettings.resolveAvatar(0)); await dialog.waitFor({ state: 'hidden' });
    await page.locator('[data-slot="avatar-editor"] [data-slot="avatar-image"]').waitFor();
    await page.evaluate(() => { window.__profileSettings.holdNextProfileRead(); window.__profileSettings.replaceUser(); });
    await page.waitForFunction(() => window.__profileSettings.profileReads.length === 1);
    expect(await page.locator('[data-slot="user-profile-settings"]').count()).toBe(0);
    expect(await page.locator('[data-slot="avatar-image"]').count()).toBe(0);
    expect(await page.locator('body').innerText()).not.toContain('jane@example.test');
    await page.evaluate(() => window.__profileSettings.resolveProfileRead(0));
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.value === 'Other', undefined, { timeout: 2500 });
    expect(await page.getByRole('textbox', { name: 'First name' }).inputValue()).toBe('Other');
  } finally { await close(page); }
}, 30_000);

browserTest('valid-shaped wrong-account profile read is rejected before rendering private values', async () => {
  const page = await open();
  try {
    await page.evaluate(() => { window.__profileSettings.holdNextProfileRead(); window.__profileSettings.replaceUser(); });
    await page.waitForFunction(() => window.__profileSettings.profileReads.length === 1);
    await page.evaluate(() => window.__profileSettings.resolveForeignProfileRead(0));
    await page.waitForFunction(() => document.querySelector('[role="alert"]') || document.querySelector('input[autocomplete="given-name"]'), undefined, { timeout: 2500 });
    expect(await page.locator('[data-slot="user-profile-settings"]').count()).toBe(0);
    expect(await page.getByRole('alert').innerText()).toBe('Your profile could not be loaded or saved. Please try again.');
    expect(await page.locator('body').innerText()).not.toContain('FOREIGN_PROFILE');
    const event = await page.evaluate(() => window.__profileSettings.observationEvents.at(-1));
    expect(event?.metadata?.code).toBe('AUTH_PROFILE_RESPONSE_INVALID'); expect(event?.error).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('FOREIGN_PROFILE');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.value === 'Other', undefined, { timeout: 2500 });
    expect(await page.getByRole('textbox', { name: 'First name' }).inputValue()).toBe('Other');
  } finally { await close(page); }
}, 30_000);

browserTest('valid-shaped wrong-account profile acknowledgment cannot advance the draft or accepted revision', async () => {
  const page = await open();
  try {
    const first = page.getByRole('textbox', { name: 'First name' }); await first.fill('Current account draft');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 1);
    await page.evaluate(() => window.__profileSettings.resolveForeignProfile(0));
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.disabled, undefined, { timeout: 2500 });
    expect(await first.inputValue()).toBe('Current account draft');
    expect(await page.locator('body').innerText()).not.toContain('FOREIGN_PROFILE');
    expect(await page.getByRole('alert').innerText()).toBe('These changes could not be saved. Please try again.');
    const event = await page.evaluate(() => window.__profileSettings.observationEvents.find(event => event.metadata?.action === 'userProfile'));
    expect(event?.metadata?.code).toBe('AUTH_PROFILE_RESPONSE_INVALID'); expect(event?.error).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('FOREIGN_PROFILE');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 2);
    expect(await page.evaluate(() => window.__profileSettings.calls[1]!.input.expectedRevision)).toBe(1);
    await page.evaluate(() => window.__profileSettings.resolve(1));
    await page.waitForFunction(() => !document.querySelector('[data-slot="form-save-bar"]'));
    expect(await first.inputValue()).toBe('Current account draft');
  } finally { await close(page); }
}, 30_000);

browserTest('regional selectors have real labels and clicking the label focuses the trigger', async () => {
  const page = await open();
  try {
    for (const label of ['Language', 'Time zone']) {
      const trigger = page.getByRole('combobox', { name: label, exact: true });
      await trigger.waitFor({ timeout: 2500 }); await page.locator('label').filter({ hasText: label }).click();
      // Label activation invokes the actual button, then the existing popover
      // deliberately places focus into its searchable command input.
      expect(await trigger.getAttribute('aria-expanded')).toBe('true');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('placeholder') === 'Search...')).toBe(true);
      await page.keyboard.press('Escape');
    }
  } finally { await close(page); }
}, 30_000);

browserTest('config retirement removes drafts, cancels pending field work and omits disabled profile', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.setProps({ saveMode: 'field' }));
    await page.getByRole('textbox', { name: 'First name' }).fill('Old draft');
    await page.getByRole('button', { name: 'Save First name', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.calls.length === 1);
    await page.evaluate(() => window.__profileSettings.setPolicy('disabled'));
    await page.waitForFunction(() => !document.querySelector('[data-slot="user-profile-settings"]'));
    expect(await page.evaluate(() => window.__profileSettings.calls[0]!.signal?.aborted)).toBe(true);
    await page.evaluate(() => window.__profileSettings.reject(0));
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.getByRole('alertdialog').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('read-only profile remains copyable and has no mutation controls', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.setProps({ mode: 'read-only' }));
    const first = page.getByRole('textbox', { name: 'First name' });
    expect(await first.getAttribute('readonly')).not.toBeNull(); expect(await first.isDisabled()).toBe(false);
    await first.focus(); expect(await first.evaluate(element => document.activeElement === element)).toBe(true);
    expect(await page.getByRole('button', { name: /Save|Cancel|Add a social profile/ }).count()).toBe(0);
    expect(await page.evaluate(() => window.__profileSettings.calls.length)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('native read-only capability and withheld email remain narrow in full presentation', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.nativeReadOnlyProjection());
    await page.getByRole('textbox', { name: 'First name' }).waitFor();
    expect(await page.getByRole('textbox', { name: 'First name' }).getAttribute('readonly')).not.toBeNull();
    expect(await page.getByText('jane@example.test', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('textbox', { name: 'Username', exact: true }).count()).toBe(0);
    expect(await page.getByRole('combobox').count()).toBe(0);
    expect(await page.getByRole('button', { name: /Save|Cancel|Add a social profile/ }).count()).toBe(0);
    expect(await page.evaluate(() => window.__profileSettings.calls.length)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('contact read Retry waits for ready policy before admitting the replacement data request', async () => {
  const page = await open();
  try {
    await page.evaluate(async () => { window.__profileSettings.failNextContactRead(); await window.__profileSettings.enableContacts(); });
    await page.getByRole('button', { name: 'Retry contact settings', exact: true }).waitFor();
    expect(await page.getByRole('alert').count()).toBe(1);
    expect(await page.locator('body').innerText()).not.toContain('PRIVATE_CONTACT_READ_FAILURE');
    await page.getByRole('button', { name: 'Retry contact settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Phone number', exact: true }).waitFor({ timeout: 2500 });
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Retry contact settings', exact: true }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('contact proof badges distinguish administrator attestation from possession and delivery readiness', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableContacts('administratively-attested', false));
    const section = page.locator('[data-slot="user-contact-settings"]'); await section.waitFor();
    expect(await section.getByText('Admin attested', { exact: true }).count()).toBe(1);
    expect(await section.getByText('Ownership verified', { exact: true }).count()).toBe(0);
    expect(await section.getByRole('button', { name: /Verify email|Verify phone number|Change email/ }).count()).toBe(0);
    await page.evaluate(() => window.__profileSettings.enableContacts('possession-verified', false));
    await section.getByText('Ownership verified', { exact: true }).waitFor();
    expect(await section.getByText('Admin attested', { exact: true }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('phone save uses canonical E164, rejects incomplete drafts and requires a real verification acknowledgment', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableContacts());
    const section = page.locator('[data-slot="user-contact-settings"]'), phone = section.getByRole('textbox', { name: 'Phone number' });
    await phone.fill('+'); await section.getByRole('button', { name: 'Save phone number', exact: true }).click();
    expect(await page.evaluate(() => window.__profileSettings.contactCalls.length)).toBe(0);
    expect(await phone.getAttribute('aria-invalid')).toBe('true');
    await phone.fill('+12025550123'); await section.getByRole('button', { name: 'Save phone number', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 1);
    expect(await page.evaluate(() => window.__profileSettings.contactCalls[0]!.input)).toEqual({ expectedRevision: 1, phone: '+12025550123' });
    await page.evaluate(() => window.__profileSettings.resolveContact(0));
    await section.getByRole('button', { name: 'Verify phone number', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 2);
    expect(await page.evaluate(() => window.__profileSettings.contactCalls[1]!.input.expectedRevision)).toBe(2);
    await page.evaluate(() => window.__profileSettings.resolveContact(1));
    const code = section.getByRole('textbox', { name: 'Phone verification code' }); await code.fill('012345');
    expect(await section.getByText('Ownership verified', { exact: true }).count()).toBe(0);
    await section.getByRole('button', { name: 'Verify code', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 3);
    await page.evaluate(() => window.__profileSettings.rejectContact(2));
    await section.getByRole('alert').waitFor();
    expect(await section.getByRole('alert').innerText()).toContain('not accepted');
    expect(await section.getByText('Ownership verified', { exact: true }).count()).toBe(0);
    await code.fill('654321'); await section.getByRole('button', { name: 'Verify code', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 4);
    expect(await page.evaluate(() => window.__profileSettings.contactCalls[3]!.input.expectedRevision)).toBe(3);
    await page.evaluate(() => window.__profileSettings.resolveContact(3));
    await section.getByText('Ownership verified', { exact: true }).waitFor();
    expect(await code.count()).toBe(0); expect(await page.evaluate(() => window.__profileSettings.calls.length)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('email ceremonies advance their own contact revision without discarding an unsaved phone draft', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableContacts());
    const section = page.locator('[data-slot="user-contact-settings"]'), phone = section.getByRole('textbox', { name: 'Phone number' });
    await phone.fill('+12025550123'); await section.getByRole('button', { name: 'Verify email', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 1);
    await page.evaluate(() => window.__profileSettings.resolveContact(0));
    await section.getByRole('button', { name: 'Cancel email verification', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 2);
    await page.evaluate(() => window.__profileSettings.resolveContact(1));
    await section.getByRole('button', { name: 'Save phone number', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 3);
    expect(await page.evaluate(() => window.__profileSettings.contactCalls[2]!.input)).toEqual({ expectedRevision: 3, phone: '+12025550123' });
  } finally { await close(page); }
}, 30_000);

browserTest('an admitted verification remains cancellable when its delivery provider becomes unavailable', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableContacts());
    const section = page.locator('[data-slot="user-contact-settings"]');
    await section.getByRole('button', { name: 'Verify email', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 1);
    await page.evaluate(() => window.__profileSettings.resolveContact(0));
    await section.getByRole('button', { name: 'Cancel email verification', exact: true }).waitFor();
    await page.evaluate(() => window.__profileSettings.contactDeliveryUnavailable());
    await section.getByText('Delivery unavailable', { exact: true }).waitFor();
    expect(await section.getByRole('button', { name: 'Verify email', exact: true }).count()).toBe(0);
    await section.getByRole('button', { name: 'Cancel email verification', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 2);
    expect(await page.evaluate(() => window.__profileSettings.contactCalls[1]!.input)).toEqual({
      expectedRevision: 2, challengeId: 'acc_00000000-0000-0000-0000-000000000000',
    });
    await page.evaluate(() => window.__profileSettings.resolveContact(1));
    await section.getByText('Not verified', { exact: true }).waitFor();
    expect(await section.getByRole('button', { name: 'Cancel email verification', exact: true }).count()).toBe(0);
    expect(await section.getByText('Ownership verified', { exact: true }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('candidate email requires current password, stays pending and never replaces the active sign-in address before proof', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableContacts());
    const section = page.locator('[data-slot="user-contact-settings"]'); await section.getByRole('button', { name: 'Change email', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    await dialog.getByRole('textbox', { name: 'New email address' }).fill('new@example.test');
    await dialog.getByRole('button', { name: 'Send verification link', exact: true }).click();
    expect(await page.evaluate(() => window.__profileSettings.contactCalls.length)).toBe(0);
    await dialog.getByLabel('Current password', { exact: true }).fill('synthetic-private-password');
    await dialog.getByRole('button', { name: 'Send verification link', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 1);
    expect(await page.evaluate(() => window.__profileSettings.contactCalls[0]!.input)).toEqual({ expectedRevision: 1, email: 'new@example.test', currentPassword: 'synthetic-private-password' });
    await page.evaluate(() => window.__profileSettings.resolveContact(0)); await dialog.waitFor({ state: 'hidden' });
    expect(await section.getByRole('textbox', { name: 'Sign-in email' }).inputValue()).toBe('jane@example.test');
    expect(await section.getByText('new@example.test', { exact: true }).count()).toBe(1);
    expect(await section.getByText('Ownership verified', { exact: true }).count()).toBe(0);
    expect(await page.getByLabel('Current password', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => JSON.stringify(window.__profileSettings.observations))).not.toContain('synthetic-private-password');
  } finally { await close(page); }
}, 30_000);

browserTest('dirty email dialog supports Stay/Discard while authority retirement cancels contact work', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableContacts());
    const section = page.locator('[data-slot="user-contact-settings"]'); await section.getByRole('button', { name: 'Change email', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'New email address' }).fill('new@example.test');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const leave = page.getByRole('alertdialog'); await leave.waitFor(); await leave.getByRole('button', { name: 'Stay', exact: true }).click();
    expect(await dialog.getByRole('textbox', { name: 'New email address' }).inputValue()).toBe('new@example.test');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await leave.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await section.getByRole('button', { name: 'Verify email', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 1);
    await page.evaluate(() => window.__profileSettings.narrowContactCapabilities());
    await page.waitForFunction(() => window.__profileSettings.contactCalls[0]!.signal?.aborted === true);
    await page.evaluate(() => window.__profileSettings.rejectContact(0));
    expect(await section.count()).toBe(0); expect(await page.getByRole('alert').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('an unavailable candidate email can be corrected and retried without a false revision-conflict lock', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.enableContacts());
    await page.locator('[data-slot="user-contact-settings"]').getByRole('button', { name: 'Change email', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'New email address' }).fill('taken@example.test');
    await dialog.getByLabel('Current password', { exact: true }).fill('synthetic-password');
    await dialog.getByRole('button', { name: 'Send verification link', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 1);
    await page.evaluate(() => window.__profileSettings.rejectContact(0, 'DUPLICATE_EMAIL'));
    await dialog.getByRole('alert').waitFor(); expect(await dialog.getByRole('alert').innerText()).toContain('unavailable');
    await dialog.getByRole('textbox', { name: 'New email address' }).fill('available@example.test');
    await dialog.getByRole('button', { name: 'Send verification link', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.contactCalls.length === 2, undefined, { timeout: 2500 });
    expect(await page.evaluate(() => window.__profileSettings.contactCalls[1]!.input.expectedRevision)).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('email-link landing captures and removes URL proof, single-flights and does not confuse callback failure with rejected proof', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      window.history.replaceState(window.history.state, '', '/verify-contact?token=synthetic-proof&source=mail');
      window.__profileSettings.showLanding(undefined, true);
    });
    const section = page.getByRole('region', { name: 'Email contact verification' }); await section.waitFor();
    await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('token'));
    expect(new URL(page.url()).searchParams.get('source')).toBe('mail');
    await page.evaluate(() => { const button = document.querySelector<HTMLButtonElement>('button')!; button.click(); button.click(); });
    await page.waitForFunction(() => window.__profileSettings.completions.length === 1);
    expect(await page.evaluate(() => window.__profileSettings.completions[0]!.token)).toBe('synthetic-proof');
    await page.evaluate(() => window.__profileSettings.resolveCompletion(0));
    await section.getByRole('status').waitFor(); expect(await section.getByRole('status').innerText()).toContain('ownership has been verified');
    expect(await section.getByRole('alert').count()).toBe(0); expect(await page.evaluate(() => window.__profileSettings.verified)).toEqual(['account-a']);
    expect(await page.locator('body').innerText()).not.toContain('NEVER_RENDER_OR_LOG');
  } finally { await close(page); }
}, 30_000);

browserTest('replacing the controlled email proof aborts the old exchange and suppresses its late result', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__profileSettings.showLanding('old-proof'));
    const section = page.getByRole('region', { name: 'Email contact verification' });
    await section.getByRole('button', { name: 'Verify email', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.completions.length === 1);
    await page.evaluate(() => window.__profileSettings.replaceProof('new-proof'));
    await page.waitForFunction(() => window.__profileSettings.completions[0]!.signal?.aborted === true);
    await page.evaluate(() => window.__profileSettings.resolveCompletion(0));
    expect(await section.getByRole('status').count()).toBe(0); expect(await page.evaluate(() => window.__profileSettings.verified)).toEqual([]);
    await section.getByRole('button', { name: 'Verify email', exact: true }).click();
    await page.waitForFunction(() => window.__profileSettings.completions.length === 2);
    expect(await page.evaluate(() => window.__profileSettings.completions[1]!.token)).toBe('new-proof');
  } finally { await close(page); }
}, 30_000);

for (const dark of [false, true]) browserTest(`contact inputs and actions fit320px with ${dark ? 'dark' : 'light'} tokens`, async () => {
  const page = await open(dark);
  try {
    await page.evaluate(() => window.__profileSettings.enableContacts()); await page.setViewportSize({ width: 320, height: 600 });
    const section = page.locator('[data-slot="user-contact-settings"]'); await section.getByRole('textbox', { name: 'Phone number' }).fill('+12025550123');
    const bounds = await section.evaluate(element => ({ width: document.documentElement.scrollWidth,
      controls: [...element.querySelectorAll<HTMLElement>('input,button')].filter(control => !(control instanceof HTMLInputElement) || control.type !== 'hidden').map(control => {
        const box = control.getBoundingClientRect(); return { left: box.left, right: box.right };
      }) }));
    expect(bounds.width).toBe(320); expect(bounds.controls.every(box => box.left >= 0 && box.right <= 320)).toBe(true);
    const fits = await section.getByRole('textbox', { name: 'Phone number' }).evaluate(element => {
      const input = element as HTMLInputElement, styles = getComputedStyle(input), canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!; context.font = styles.font;
      return context.measureText(input.value).width + parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight) <= input.clientWidth;
    });
    expect(fits).toBe(true);
    await page.screenshot({ path: `/Volumes/code-bank/artifacts/zero-platform/diagnostics/profile-contacts-${dark ? 'dark' : 'light'}.png`, fullPage: true });
  } finally { await close(page); }
}, 30_000);

for (const dark of [false, true]) browserTest(`profile controls fit320px and inherit ${dark ? 'dark' : 'light'} tokens`, async () => {
  const page = await open(dark);
  try {
    await page.setViewportSize({ width: 320, height: 600 });
    await page.getByRole('textbox', { name: 'First name' }).fill('Narrow screen draft');
    const measurements = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-slot="user-profile-settings"]')!, bounds = root.getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, left: bounds.left, right: bounds.right,
        background: getComputedStyle(root).backgroundColor, card: getComputedStyle(document.documentElement).getPropertyValue('--card'),
        controls: [...root.querySelectorAll<HTMLElement>('input,textarea,[role="combobox"]')].map(element => {
          const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right };
        }) };
    });
    expect(measurements.width).toBe(320); expect(measurements.left).toBeGreaterThanOrEqual(0); expect(measurements.right).toBeLessThanOrEqual(320);
    expect(measurements.controls.every(rect => rect.left >= 0 && rect.right <= 320)).toBe(true); expect(measurements.card.trim()).not.toBe('');
    await page.screenshot({ path: `/Volumes/code-bank/artifacts/zero-platform/diagnostics/profile-settings-${dark ? 'dark' : 'light'}.png`, fullPage: true });
    await page.evaluate(() => window.__profileSettings.setProps({ saveMode: 'field' }));
    const fieldControls = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.profile-settings__control input,.profile-settings__field-actions button')]
      .map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right }; }));
    expect(fieldControls.every(rect => rect.left >= 0 && rect.right <= 320)).toBe(true);
    await page.screenshot({ path: `/Volumes/code-bank/artifacts/zero-platform/diagnostics/profile-settings-field-${dark ? 'dark' : 'light'}.png`, fullPage: true });
  } finally { await close(page); }
}, 30_000);
