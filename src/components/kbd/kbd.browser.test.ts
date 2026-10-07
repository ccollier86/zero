/** Real styled default/token/tooltip acceptance through the existing isolated browser harness. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const screenshots = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/kbd';
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true }); await mkdir(screenshots, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'kbd-browser-'));
  try {
    const style = await buildPlatformStyles(directory, `${directory}/absent-app`); css = await Bun.file(style.cssPath).text();
    const output = join(directory, 'fixture.js'), build = Bun.spawn([process.execPath, 'build', `${import.meta.dir}/kbd.browser-fixture.tsx`,
      '--target=browser', '--format=iife', '--outfile', output], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Kbd fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());
async function open(dark = false) {
  const page = await browser.newPage({ viewport: { width: 320, height: 660 }, reducedMotion: 'reduce' }); const messages: string[] = [];
  errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent('<!doctype html><div id="root"></div>'); await page.addStyleTag({ content: css });
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
  await page.addScriptTag({ content: bundle }); await page.getByTestId('plain').waitFor(); return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
for (const dark of [false, true]) browserTest(`compact keyboard defaults match semantic ${dark ? 'dark' : 'light'} tokens at320px`, async () => {
  const page = await open(dark);
  try {
    const key = page.getByTestId('plain');
    expect(await key.evaluate(element => { const style = getComputedStyle(element); return { height: style.height, minWidth: style.minWidth,
      gap: style.gap, padding: style.paddingInlineStart, size: style.fontSize, weight: style.fontWeight, events: style.pointerEvents, select: style.userSelect }; }))
      .toEqual({ height: '20px', minWidth: '20px', gap: '4px', padding: '4px', size: '12px', weight: '500', events: 'none', select: 'none' });
    expect(await key.evaluate(element => { const probe = document.createElement('span'); probe.style.background = 'var(--muted)';
      probe.style.color = 'var(--muted-foreground)'; document.body.append(probe); const a = getComputedStyle(element), b = getComputedStyle(probe);
      const result = a.backgroundColor === b.backgroundColor && a.color === b.color; probe.remove(); return result; })).toBe(true);
    expect(await page.getByTestId('group').evaluate(element => getComputedStyle(element).gap)).toBe('4px');
    expect(await page.getByTestId('default-icon').locator('svg').evaluate(element => getComputedStyle(element).width)).toBe('12px');
    expect(await page.getByTestId('sized-icon').locator('svg').evaluate(element => getComputedStyle(element).width)).toBe('20px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Check ref', exact: true }).click(); expect(await page.locator('#ref-result').textContent()).toBe('true');
    await page.screenshot({ path: join(screenshots, dark ? 'kbd-dark.png' : 'kbd-light.png'), animations: 'disabled' });
  } finally { await close(page); }
}, 30_000);
browserTest('public custom metrics inherit without changing unrelated key defaults', async () => {
  const page = await open();
  try {
    expect(await page.getByTestId('custom').evaluate(element => { const s = getComputedStyle(element); return { height: s.height, minWidth: s.minWidth,
      gap: s.gap, padding: s.paddingInlineStart, fontSize: s.fontSize, radius: s.borderRadius }; }))
      .toEqual({ height: '28px', minWidth: '30px', gap: '6px', padding: '8px', fontSize: '14px', radius: '3px' });
    expect(await page.getByTestId('custom').locator('svg').evaluate(element => getComputedStyle(element).width)).toBe('16px');
    expect(await page.getByTestId('custom-metrics').locator('[data-slot=kbd-group]').evaluate(element => getComputedStyle(element).gap)).toBe('9px');
    expect(await page.getByTestId('plain').evaluate(element => getComputedStyle(element).height)).toBe('20px');
    await page.getByTestId('custom-metrics').evaluate(element => (element as HTMLElement).style.setProperty('--zero-kbd-padding', '2px 7px'));
    expect(await page.getByTestId('custom').evaluate(element => [getComputedStyle(element).paddingBlockStart, getComputedStyle(element).paddingInlineStart])).toEqual(['2px', '7px']);
  } finally { await close(page); }
}, 30_000);
for (const dark of [false, true]) browserTest(`Zero tooltip key colors follow its ${dark ? 'dark' : 'light'} surface, not ordinary popovers; hints add no focus target`, async () => {
  const page = await open(dark);
  try {
    const trigger = page.getByRole('button', { name: 'Save example', exact: true }); await trigger.focus();
    await page.getByRole('tooltip', { name: 'Save with shortcut', exact: true }).waitFor();
    const key = page.locator('[data-radix-popper-content-wrapper] [data-testid=tooltip-key]');
    expect(await key.evaluate(element => { const s = getComputedStyle(element), p = getComputedStyle(element.closest('[data-slot=popover-content]')!);
      return s.color === p.color && s.backgroundColor !== p.backgroundColor; })).toBe(true);
    expect(await key.evaluate((element, opacity) => { const probe = document.createElement('span'); probe.style.color = 'inherit';
      probe.style.background = `color-mix(in srgb, currentColor ${opacity}, transparent)`; element.append(probe);
      const same = getComputedStyle(element).backgroundColor === getComputedStyle(probe).backgroundColor; probe.remove(); return same;
    }, dark ? '10%' : '20%')).toBe(true);
    expect(await key.getAttribute('tabindex')).toBeNull();
    await page.screenshot({ path: join(screenshots, dark ? 'kbd-tooltip-dark.png' : 'kbd-tooltip-light.png'), animations: 'disabled' });
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Ordinary popover', exact: true }).click();
    const ordinary = page.getByTestId('popover-key'); await ordinary.waitFor();
    expect(await ordinary.evaluate(element => getComputedStyle(element).color)).toBe(await page.getByTestId('plain').evaluate(element => getComputedStyle(element).color));
    await page.keyboard.press('Escape');
  } finally { await close(page); }
}, 30_000);
