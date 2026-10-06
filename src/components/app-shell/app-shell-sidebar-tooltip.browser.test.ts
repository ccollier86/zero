/** Real styled sidebar hover/focus/collision regressions using fresh isolated pages. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page, Locator } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import {
  acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '', css = '';
const screenshots = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/sidebar-tooltips';
const pageErrors = new WeakMap<Page, string[]>();

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratch, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'sidebar-tooltip-'));
  try {
    const styles = await buildPlatformStyles(directory, join(directory, 'absent-app'));
    css = await Bun.file(styles.cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/app-shell-sidebar-tooltip.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  bundle = await result.outputs[0]!.text();
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
}, 60_000);

afterAll(() => lease?.release());

browserTest('actual collapsed AppShell descriptions open on hover, not focus, and dismiss on click or Escape', async () => {
  const page = await mount('app-shell');
  try {
    const link = page.locator('a[href="#dashboard"]');
    await link.focus();
    await settleFrames(page);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    expect(await link.getAttribute('aria-label')).toBe('Dashboard');
    await showTooltip(page, link, 'Dashboard');
    const description = await link.getAttribute('aria-describedby');
    expect(description).toBeTruthy();
    expect(await page.getByRole('tooltip').getAttribute('id')).toBe(description);
    expect(await link.getAttribute('data-highlight')).toBe('true');
    expect(await link.evaluate((element) => getComputedStyle(element).position)).toBe('relative');
    await page.screenshot({ path: join(screenshots, 'collapsed-app-shell-tooltip.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: join(screenshots, 'collapsed-app-shell-tooltip-dark.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await link.click();
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await settleFrames(page);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    expect(await link.evaluate((element) => element === document.activeElement)).toBe(true);
    await page.mouse.move(500, 500);
    await showTooltip(page, link, 'Dashboard');
    await page.keyboard.press('Escape');
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    expect(await link.evaluate((element) => element === document.activeElement)).toBe(true);
    const group = page.locator('[data-sidebar="menu-button"]').filter({ hasText: 'Automation' });
    await showTooltip(page, group, 'Automation');
    const custom = page.locator('a[href="#custom"]');
    expect(await custom.getAttribute('aria-label')).toBe('Custom label');
    await showTooltip(page, custom, 'Custom descriptive help');
  } finally { await close(page); }
}, 30_000);

browserTest('animateOnHover=false keeps the public sidebar tooltip interactive', async () => {
  const page = await mount('static');
  try {
    const trigger = page.getByRole('button', { name: 'Unanimated navigation', exact: true });
    await trigger.focus();
    await settleFrames(page);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    await page.getByRole('button', { name: 'Control without hint', exact: true }).hover();
    await settleFrames(page);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    await showTooltip(page, trigger, 'Unanimated navigation');
    await trigger.click();
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    expect(await page.getByTestId('caller-clicks').textContent()).toBe('1');
    expect(await page.getByTestId('caller-pointers').textContent()).toBe('1');
    expect(await page.getByTestId('caller-ref').textContent()).toBe('true');
    await settleFrames(page);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Object-form description', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Explicit accessible name', exact: true }).count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('expanding suppresses the tooltip without replacing the focused navigation control', async () => {
  const page = await mount('app-shell');
  try {
    const link = page.locator('a[href="#dashboard"]');
    await link.focus();
    await showTooltip(page, link, 'Dashboard');
    const original = await link.elementHandle();
    await page.keyboard.press('Control+b');
    await page.locator('[data-slot="sidebar"][data-state="expanded"]').waitFor();
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    expect(await original!.evaluate((element) => element.isConnected && element === document.activeElement)).toBe(true);
    await link.hover();
    await settleFrames(page);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    await page.keyboard.press('Control+b');
    await page.locator('[data-slot="sidebar"][data-state="collapsed"]').waitFor();
    expect(await original!.evaluate((element) => element.isConnected && element === document.activeElement)).toBe(true);
    await page.mouse.move(500, 500);
    await link.hover();
    await page.getByRole('tooltip').waitFor({ state: 'visible' });
  } finally { await close(page); }
}, 30_000);

browserTest('workspace, account and brand controls have collapsed descriptions', async () => {
  const page = await mount('app-shell');
  try {
    await showTooltip(page, page.getByRole('button', { name: /Synthetic Workspace/ }), 'Synthetic Workspace');
    await showTooltip(page, page.getByRole('button', { name: /Synthetic User/ }), 'Synthetic User');
  } finally { await close(page); }
  const brand = await mount('brand');
  try {
    await showTooltip(brand, brand.getByRole('link', { name: /Synthetic Brand/ }), 'Synthetic Brand');
  } finally { await close(brand); }
}, 30_000);

browserTest('long descriptions on a right-edge sidebar wrap inside a narrow desktop viewport', async () => {
  const page = await mount('right-edge', 800);
  try {
    const link = page.getByRole('button', { name: 'Unanimated navigation', exact: true });
    await showTooltip(page, link, 'Advanced organization permissions');
    const visual = page.locator('[data-radix-popper-content-wrapper] > div > [data-slot="popover-content"]');
    await visual.waitFor();
    expect(await visual.getAttribute('data-side')).toBe(await visual.evaluate((element) => element.parentElement!.getAttribute('data-side')));
    expect(await visual.getAttribute('data-side')).toBe('left');
    expect(await visual.getAttribute('data-align')).toBe(await visual.evaluate((element) => element.parentElement!.getAttribute('data-align')));
    const box = await visual.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(7);
    expect(box!.x + box!.width).toBeLessThanOrEqual(793);
    expect(box!.width).toBeLessThanOrEqual(400);
    // The decorative arrow may intentionally project beyond the box. Text may not.
    expect(await visual.evaluate((element) => {
      const range = document.createRange();
      range.selectNode(element.firstChild!);
      const box = element.getBoundingClientRect();
      return [...range.getClientRects()].every((rect) => rect.left >= box.left && rect.right <= box.right);
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(screenshots, 'right-edge-long-tooltip.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: join(screenshots, 'right-edge-long-tooltip-dark.png'), animations: 'disabled' });
  } finally { await close(page); }
}, 30_000);

browserTest('mobile AppShell keeps labels but never opens collapsed desktop hints', async () => {
  const page = await mount('app-shell', 600);
  try {
    await page.keyboard.press('Control+b');
    await page.getByRole('dialog').waitFor();
    const link = page.locator('a[href="#dashboard"]');
    expect(await link.getAttribute('aria-label')).toBe('Dashboard');
    await link.hover();
    await settleFrames(page);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    await link.focus();
    await settleFrames(page);
    expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('public tooltips retain ordinary focus, hover and Escape behavior without browser errors', async () => {
  for (const dark of [false, true]) {
    const page = await mount('generic', 1100, dark);
    try {
      const trigger = page.getByRole('button', { name: 'Generic help', exact: true });
      await trigger.focus();
      await page.getByRole('tooltip').waitFor({ state: 'visible' });
      await waitTooltipPaint(page);
      expect(await page.getByRole('tooltip').textContent()).toBe('Accessible help description');
      const visual = page.locator('[data-radix-popper-content-wrapper] > div > [data-slot="popover-content"]');
      expect(await visual.textContent()).toBe('Ordinary tooltip description');
      expect(await visual.evaluate((element) => getComputedStyle(element.closest('[data-radix-popper-content-wrapper]')!).zIndex)).toBe('50');
      await page.keyboard.press('Escape');
      await page.getByRole('tooltip').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Next control', exact: true }).focus();
      await showTooltip(page, trigger, 'Accessible help description');
      await page.mouse.move(500, 600, { steps: 8 });
      await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    } finally { await close(page); }
  }
}, 30_000);

async function mount(scenario: string, width = 1100, dark = false): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width, height: 720 } });
  page.setDefaultTimeout(3500);
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => {
    errors.push(error.stack ?? error.message);
    console.error(`[${scenario}] browser error: ${error.stack ?? error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[${scenario}] console error: ${message.text()}`);
  });
  await page.route('http://zero-sidebar.test/**', (route) => route.fulfill({
    contentType: 'text/html', body: `<body class="bg-background text-foreground" data-scenario="${scenario}"><div id="root"></div></body>`,
  }));
  await page.goto('http://zero-sidebar.test/');
  await page.addStyleTag({ content: css });
  await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
  await page.addScriptTag({ content: bundle });
  if (scenario === 'generic') await page.getByRole('button', { name: 'Generic help', exact: true }).waitFor();
  else if (width >= 768) await page.locator('[data-slot="sidebar"][data-state="collapsed"]').waitFor();
  else {
    await page.getByText('Isolated AppShell fixture', { exact: true }).waitFor();
    await settleFrames(page);
  }
  return page;
}

async function close(page: Page): Promise<void> {
  await page.close();
  expect(pageErrors.get(page)).toEqual([]);
}

async function showTooltip(page: Page, trigger: Locator, label: string): Promise<void> {
  expect(await trigger.count()).toBe(1);
  await page.mouse.move(500, 600, { steps: 8 });
  if (await page.getByRole('tooltip').count()) {
    await page.getByRole('tooltip').waitFor({ state: 'hidden', timeout: 2500 });
  }
  await trigger.hover();
  const tooltip = page.getByRole('tooltip');
  try { await tooltip.waitFor({ state: 'visible', timeout: 2500 }); }
  catch (error) {
    await page.screenshot({ path: join(screenshots, 'tooltip-failure.png'), animations: 'disabled' });
    throw error;
  }
  await waitTooltipPaint(page);
  expect(await tooltip.textContent()).toContain(label);
}

async function waitTooltipPaint(page: Page): Promise<void> {
  try { await page.waitForFunction(() => {
    const content = document.querySelector('[data-slot="popover-content"]');
    if (!content) return false;
    const style = getComputedStyle(content);
    const scale = new DOMMatrixReadOnly(style.transform).a;
    return Number(style.opacity) >= 0.99 && Math.abs(scale - 1) < 0.01;
  }, undefined, { timeout: 2500 }); }
  catch (error) {
    console.error('Tooltip paint:', await page.evaluate(() => ({
      visibility: document.visibilityState,
      content: [...document.querySelectorAll('[data-slot="popover-content"]')].map((element) => ({
        style: element.getAttribute('style'),
        state: element.getAttribute('data-state'),
        opacity: getComputedStyle(element).opacity,
        transform: getComputedStyle(element).transform,
      })),
    })));
    throw error;
  }
}

function settleFrames(page: Page): Promise<void> {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
