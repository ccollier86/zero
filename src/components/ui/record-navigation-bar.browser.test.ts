/** Shared disclosure, keyboard, deliberate touch, and real Storage/DataStudio callers through the existing browser lease. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'; // Bun has no equivalent temporary-directory/removal API.
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'record-action-disclosure-'));
  try {
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    const output = join(directory, 'fixture.js'), build = Bun.spawn([process.execPath, 'build',
      `${import.meta.dir}/record-navigation-bar.browser-fixture.tsx`, '--target=browser', '--format=iife', '--outfile', output],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', timeout: 40_000, killSignal: 'SIGKILL' });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Action fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function open(width = 1100, touch = false, reduced = false) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 800 }, hasTouch: touch,
    reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  try {
    await page.setContent('<!doctype html><div id="root"></div>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    // Settle/close a failed mount before Bun's test deadline can retire the process-local browser.
    await page.getByTestId('shared').getByRole('button', { name: 'Open', exact: true }).waitFor({ timeout: 10_000 }); return page;
  } catch (cause) {
    await page.close(); throw new AggregateError([cause, ...messages.map(message => new Error(message))], 'Action fixture did not mount');
  }
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
browserTest('rest is icon-only; hover expands the full label without executing and pointer exit has no sticky mouse-focus label', async () => {
  const page = await open();
  try {
    const action = page.getByTestId('shared').getByRole('button', { name: 'Open', exact: true });
    expect(await action.getAttribute('data-expanded')).toBe('false'); expect((await action.boundingBox())!.width).toBeCloseTo(40, 0);
    await action.hover(); await page.waitForFunction(() => {
      const label = document.querySelector('[data-testid="shared"] [aria-label="Open"] [data-slot="record-navigation-action-label"]')!;
      return getComputedStyle(label).opacity === '1' && label.getBoundingClientRect().width > 20;
    });
    expect((await action.boundingBox())!.width).toBeGreaterThan(60); expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual([]);
    await action.click(); expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual(['Open']);
    await page.mouse.move(0, 0); await page.waitForFunction(() => document.querySelector('[data-testid="shared"] [aria-label="Open"]')?.getAttribute('data-expanded') === 'false');
    expect(await page.getByTestId('shared').getByRole('button', { name: 'Create record', exact: true }).isVisible()).toBe(true);
  } finally { await close(page); }
}, 30_000);
browserTest('native keyboard focus reveals labels, Enter/Space execute once, and disabled actions remain disabled', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Start keyboard', exact: true }).focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const action = page.getByTestId('shared').getByRole('button', { name: 'Open', exact: true });
    expect(await action.evaluate(element => document.activeElement === element)).toBe(true);
    expect(await action.getAttribute('data-expanded')).toBe('true');
    await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual(['Open', 'Open']);
    const disabled = page.getByTestId('shared').getByRole('button', { name: 'Forbidden', exact: true });
    expect(await disabled.isDisabled()).toBe(true); await disabled.evaluate(element => (element as HTMLButtonElement).click());
    expect(await page.evaluate(() => window.__recordActions.invoked())).not.toContain('Forbidden');
  } finally { await close(page); }
}, 30_000);
browserTest('touch first tap reveals without executing, second tap executes, and switching action retires the previous touch intent', async () => {
  const page = await open(320, true);
  try {
    const action = page.getByTestId('shared').getByRole('button', { name: 'Open', exact: true });
    await action.tap(); expect(await action.getAttribute('data-expanded')).toBe('true');
    expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual([]);
    await action.tap(); expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual(['Open']);
    const rename = page.getByTestId('shared').getByRole('button', { name: 'Rename', exact: true });
    await rename.tap(); expect(await action.getAttribute('data-expanded')).toBe('false');
    expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual(['Open']);
    await rename.tap(); expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual(['Open', 'Rename']);
  } finally { await close(page); }
}, 30_000);
browserTest('320px keyboard label disclosure stays inside the independently scrolling action track with no page overflow', async () => {
  const page = await open(320);
  try {
    await page.getByRole('button', { name: 'Start keyboard', exact: true }).focus();
    for (let index = 0; index < 8; index++) await page.keyboard.press('Tab');
    const action = page.getByTestId('shared').getByRole('button', { name: 'Archive table', exact: true });
    expect(await action.evaluate(element => document.activeElement === element)).toBe(true);
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="shared"] [aria-label="Archive table"]')!;
      const box = button.getBoundingClientRect(), track = button.parentElement!.getBoundingClientRect();
      return getComputedStyle(button.querySelector('[data-slot="record-navigation-action-label"]')!).opacity === '1'
        && box.left >= track.left - 1 && box.right <= track.right + 1;
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const placement = await action.evaluate(element => ({ actionTop: element.parentElement!.getBoundingClientRect().top,
      navigationBottom: element.parentElement!.parentElement!.firstElementChild!.getBoundingClientRect().bottom }));
    expect(placement.actionTop).toBeGreaterThanOrEqual(placement.navigationBottom);
  } finally { await close(page); }
}, 30_000);
browserTest('benign callback rerenders preserve a touch reveal, but a replaced selected context requires fresh intent', async () => {
  const page = await open(320, true);
  try {
    const action = page.getByTestId('shared').getByRole('button', { name: 'Open', exact: true });
    await action.tap(); await page.evaluate(() => window.__recordActions.rerender());
    await page.locator('main[data-render="1"]').waitFor();
    await action.tap(); expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual(['Open']);
    await page.getByRole('button', { name: 'Start keyboard', exact: true }).tap();
    await page.evaluate(() => window.__recordActions.clear()); await action.tap();
    await page.evaluate(() => window.__recordActions.context('B')); await page.locator('main[data-context="B"]').waitFor();
    expect(await action.getAttribute('data-expanded')).toBe('false');
    await page.evaluate(() => window.__recordActions.context('A')); await page.locator('main[data-context="A"]').waitFor();
    expect(await action.getAttribute('data-expanded')).toBe('false');
    await action.tap(); expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual([]);
    await action.tap(); expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual(['Open']);
  } finally { await close(page); }
}, 30_000);
browserTest('always-visible opt-out, reduced-motion disclosure, and built-in Studio/Storage defaults use the same primitive', async () => {
  const page = await open(320, false, true);
  try {
    const visible = page.getByTestId('visible').getByRole('button', { name: 'Open', exact: true });
    expect(await visible.getAttribute('data-expanded')).toBe('true'); expect((await visible.boundingBox())!.width).toBeGreaterThan(60);
    const storage = page.getByTestId('storage').getByRole('button', { name: 'Open', exact: true });
    const studio = page.getByTestId('studio').getByRole('button', { name: 'Inspect record', exact: true });
    expect(await storage.getAttribute('data-label-mode')).toBe('expand'); expect(await studio.getAttribute('data-label-mode')).toBe('expand');
    await studio.hover(); expect(await studio.getAttribute('data-expanded')).toBe('true');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="studio"] [data-slot="record-navigation-action-label"]')!).opacity === '1');
    expect(await studio.locator('[data-slot="record-navigation-action-label"]').evaluate(element => element.getAnimations().length)).toBe(0);
    const captures = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/record-navigation-disclosure';
    await mkdir(captures, { recursive: true });
    await page.screenshot({ path: join(captures, 'actions-light-320.png') });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: join(captures, 'actions-dark-320.png') });
    await studio.click(); expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual(['studio.inspect']);
  } finally { await close(page); }
}, 30_000);

browserTest('Data Studio and Storage callers slide labels on real hover and return to icon-only rest in both themes', async () => {
  const page = await open();
  try {
    const captures = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/calendar-field-editors';
    await mkdir(captures, { recursive: true });
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      await page.mouse.move(0, 0);
      for (const [caller, label] of [['storage', 'Open'], ['studio', 'Inspect record']] as const) {
        const action = page.getByTestId(caller).getByRole('button', { name: label, exact: true });
        expect(await action.getAttribute('data-label-mode')).toBe('expand');
        expect(await action.getAttribute('data-expanded')).toBe('false');
        await action.hover();
        await action.locator('[data-slot="record-navigation-action-label"]').evaluate(element => new Promise<void>((resolve, reject) => {
          let frames = 0, stable = 0, previousWidth = -1;
          function sample() {
            const width = element.getBoundingClientRect().width;
            stable = Math.abs(width - previousWidth) < .05 ? stable + 1 : 0;
            previousWidth = width;
            if (Number(getComputedStyle(element).opacity) >= .999 && width > 20 && stable >= 4) resolve();
            else if (++frames > 180) reject(new Error('Built-in action label did not slide open.'));
            else requestAnimationFrame(sample);
          }
          sample();
        }));
        expect((await action.boundingBox())!.width).toBeGreaterThan(60);
        await page.screenshot({ path: join(captures, `${caller}-action-${dark ? 'dark' : 'light'}.png`) });
        await page.mouse.move(0, 0);
        await page.waitForFunction(({ caller, label }) => document.querySelector(`[data-testid="${caller}"] [aria-label="${label}"]`)?.getAttribute('data-expanded') === 'false', { caller, label });
      }
      expect(await page.evaluate(() => window.__recordActions.invoked())).toEqual([]);
    }
  } finally { await close(page); }
}, 30_000);
