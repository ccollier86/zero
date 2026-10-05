/** Actual component + platform CSS geometry, no running app or sensitive data. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const browserFaults: string[] = [];
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'zero-workspace-layout-'));
  try {
    const styles = await buildPlatformStyles(directory, join(directory, 'absent-app'));
    css = await Bun.file(styles.cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/list-detail-workspace.browser-fixture.tsx`], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => { lease?.release(); expect(browserFaults).toEqual([]); });

async function mount(mode: string, width = 1200, height = 720) {
  const page = await browser!.newPage({ viewport: { width, height } });
  page.on('pageerror', error => browserFaults.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserFaults.push(message.text()); });
  await page.route('http://zero-layout.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto(`http://zero-layout.invalid/?mode=${mode}`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  return page;
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const find = (slot: string) => document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
    const layout = find('list-detail-layout');
    const panes = (find('list-detail-panes') ?? layout.firstElementChild) as HTMLElement;
    const list = (find('list-detail-list') ?? panes.firstElementChild) as HTMLElement;
    const detail = (find('list-detail-detail') ?? panes.lastElementChild) as HTMLElement;
    const bar = (find('list-detail-bottom-bar') ?? layout.lastElementChild) as HTMLElement;
    return { pageHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight,
      layoutBottom: layout.getBoundingClientRect().bottom, barTop: bar.getBoundingClientRect().top,
      barBottom: bar.getBoundingClientRect().bottom, listBottom: list.getBoundingClientRect().bottom,
      detailBottom: detail.getBoundingClientRect().bottom, listHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight, detailHeight: detail.clientHeight,
      detailBody: detail.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')?.clientHeight ?? 0,
      detailScroll: detail.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')?.scrollHeight ?? 0 };
  });
}

for (const mode of ['raw', 'master', 'shell', 'sidebar', 'simple', 'topbar-workspace', 'minimal-workspace']) {
  browserTest(`${mode} keeps both long panes and actions inside a bounded workspace`, async () => {
    const page = await mount(mode);
    try {
      await page.getByRole('button', { name: 'Create record', exact: true }).waitFor();
      const box = await geometry(page);
      expect(box.pageHeight).toBeLessThanOrEqual(box.viewportHeight + 1);
      expect(box.listHeight).toBeGreaterThan(100);
      expect(box.listScrollHeight).toBeGreaterThan(box.listHeight);
      expect(box.detailScroll).toBeGreaterThan(box.detailBody);
      expect(box.listBottom).toBeLessThanOrEqual(box.barTop + 1);
      expect(box.detailBottom).toBeLessThanOrEqual(box.barTop + 1);
      expect(box.barBottom).toBeLessThanOrEqual(box.layoutBottom + 1);
      await page.locator('[data-slot="list-detail-list"]').evaluate(element => { element.scrollTop = 600; });
      const scroll = await page.locator('[data-slot="list-detail-list"]').evaluate(element => element.scrollTop);
      expect(scroll).toBeGreaterThan(0);
      expect(await page.getByRole('button', { name: 'Create record', exact: true }).isVisible()).toBe(true);
    } finally { await page.close(); }
  }, 30_000);
}

browserTest('hidden detail frees list width and keyboard/pointer separator resizes only the desktop panes', async () => {
  const page = await mount('raw');
  try {
    await page.getByRole('button', { name: 'Toggle detail', exact: true }).waitFor();
    const list = page.locator('[data-slot="list-detail-list"]');
    const before = (await list.boundingBox())!.width;
    await page.getByRole('button', { name: 'Toggle detail', exact: true }).click();
    expect(await page.locator('[data-slot="list-detail-detail"]').isVisible()).toBe(false);
    expect((await list.boundingBox())!.width).toBeGreaterThan(before);
    await page.getByRole('button', { name: 'Toggle detail', exact: true }).click();
    const separator = page.getByRole('separator', { name: 'Resize list and detail panels', exact: true });
    expect(await separator.count()).toBe(1);
    await separator.focus(); await separator.press('Home');
    expect(Number(await separator.getAttribute('aria-valuenow'))).toBeCloseTo(Number(await separator.getAttribute('aria-valuemin')), 2);
    const smaller = (await list.boundingBox())!.width;
    expect(smaller).toBeGreaterThanOrEqual(191);
    await separator.press('End');
    expect(Number(await separator.getAttribute('aria-valuenow'))).toBeCloseTo(Number(await separator.getAttribute('aria-valuemax')), 2);
    expect((await list.boundingBox())!.width).toBeGreaterThan(smaller);
    expect((await page.locator('[data-slot="list-detail-detail"]').boundingBox())!.width).toBeGreaterThanOrEqual(255);
    const handle = (await separator.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 20); await page.mouse.down();
    await page.mouse.move(600, handle.y + 20); await page.mouse.up();
    expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(40);
    expect(Number(await separator.getAttribute('aria-valuenow'))).toBeLessThan(60);
  } finally { await page.close(); }
}, 30_000);

browserTest('CSS-sized defaults persist until library resizing, and hide/mobile transitions preserve one draft tree', async () => {
  const page = await mount('raw', 1800, 720);
  try {
    const detail = page.locator('[data-slot="list-detail-detail"]');
    await page.getByRole('button', { name: 'Toggle detail', exact: true }).waitFor();
    expect((await detail.boundingBox())!.width).toBeCloseTo(352, 0);
    const draft = page.getByRole('textbox', { name: 'Draft note', exact: true });
    await draft.fill('Unsaved draft survives');
    await page.getByRole('button', { name: 'Toggle detail', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle detail', exact: true }).click();
    expect(await draft.inputValue()).toBe('Unsaved draft survives');
    expect((await detail.boundingBox())!.width).toBeCloseTo(352, 0);
    await page.setViewportSize({ width: 1400, height: 720 });
    await page.waitForFunction(() => Math.abs(document.querySelector<HTMLElement>('[data-slot="list-detail-detail"]')!.clientWidth - 352) <= 1);
    const separator = page.getByRole('separator', { name: 'Resize list and detail panels', exact: true });
    await separator.focus(); await separator.press('ArrowLeft');
    const resized = (await detail.boundingBox())!.width;
    expect(resized).toBeGreaterThan(352);
    await page.getByRole('button', { name: 'Toggle detail', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle detail', exact: true }).click();
    expect((await detail.boundingBox())!.width).toBeCloseTo(resized, 0);
    await page.setViewportSize({ width: 390, height: 640 });
    await page.getByRole('button', { name: 'Back to list', exact: true }).waitFor();
    expect(await draft.inputValue()).toBe('Unsaved draft survives');
    expect(await draft.count()).toBe(1);
    await page.setViewportSize({ width: 1400, height: 720 });
    await separator.waitFor();
    expect(await draft.inputValue()).toBe('Unsaved draft survives');
    expect((await detail.boundingBox())!.width).toBeCloseTo(resized, 0);
  } finally { await page.close(); }
}, 30_000);

browserTest('nested resizable content cannot replace the outer separator measurement', async () => {
  const page = await mount('nested');
  try {
    await page.getByRole('separator', { name: 'Nested separator', exact: true }).waitFor();
    expect((await page.locator('[data-slot="list-detail-detail"]').boundingBox())!.width).toBeCloseTo(352, 0);
  } finally { await page.close(); }
});

browserTest('mobile long detail has a reachable Back and actions; selection does not create duplicate trees', async () => {
  const page = await mount('raw', 390, 640);
  try {
    const back = page.getByRole('button', { name: 'Back to list', exact: true });
    await back.waitFor();
    expect(await page.locator('[data-slot="detail-panel"]').count()).toBe(1);
    const box = await geometry(page);
    expect(box.pageHeight).toBeLessThanOrEqual(641);
    expect(box.detailScroll).toBeGreaterThan(box.detailBody);
    expect(await page.getByRole('button', { name: 'Create record', exact: true }).isVisible()).toBe(true);
    await back.click();
    expect(await page.locator('[data-slot="list-detail-list"]').isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Select 2', exact: true }).click();
    await back.waitFor({ timeout: 3_000 });
    expect(await back.isVisible()).toBe(true);
    expect(await page.locator('[data-slot="detail-panel"]').count()).toBe(1);
  } finally { await page.close(); }
}, 30_000);

browserTest('document shell mode retains natural page scrolling', async () => {
  const page = await mount('document');
  try {
    await page.getByText('Long detail 79', { exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
  } finally { await page.close(); }
});

browserTest('animated tabs content-fill-content transition clears the old natural height and keeps a long pane bounded', async () => {
  const page = await mount('tabs');
  try {
    const contents = page.locator('[data-slot="tabs-contents"]');
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-slot="tabs-contents"]')!.getBoundingClientRect().height > 1000);
    await page.getByRole('button', { name: 'Toggle tab height', exact: true }).click();
    await page.getByTestId('height-mode').filter({ hasText: 'fill' }).waitFor();
    const bounded = await contents.evaluate(element => ({ height: element.getBoundingClientRect().height, inlineHeight: (element as HTMLElement).style.height,
      parentHeight: element.parentElement!.getBoundingClientRect().height }));
    expect(bounded.height).toBeLessThanOrEqual(bounded.parentHeight);
    expect(bounded.inlineHeight).toBe('auto');
    const long = page.getByTestId('long-tab-body');
    expect(await long.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await long.evaluate(element => { element.scrollTop = 500; });
    expect(await long.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole('tab', { name: 'Short tab', exact: true }).click();
    expect((await contents.boundingBox())!.height).toBeCloseTo(bounded.height, 0);
    await page.getByRole('button', { name: 'Toggle tab height', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-slot="tabs-contents"]')!.getBoundingClientRect().height < 100);
    expect((await contents.boundingBox())!.height).toBeGreaterThan(0);
    await page.getByRole('tab', { name: 'Long tab', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-slot="tabs-contents"]')!.getBoundingClientRect().height > 1000);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(721);
  } finally { await page.close(); }
}, 30_000);

browserTest('desktop-hidden detail still opens on mobile, and narrow action/status controls remain reachable', async () => {
  const page = await mount('status&hidden=1', 390, 640);
  try {
    const back = page.getByRole('button', { name: 'Back to list', exact: true });
    await back.waitFor();
    expect(await page.locator('[data-slot="list-detail-detail"]').isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Previous record', exact: true }).count()).toBe(0);
    expect(await page.getByRole('status').textContent()).toBe('80 records');
    const lastAction = page.getByRole('button', { name: 'Action 7', exact: true });
    await lastAction.focus();
    const within = await lastAction.evaluate(element => {
      const box = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return box.left >= parent.left - 1 && box.right <= parent.right + 1;
    });
    expect(within).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await back.click();
    expect(await page.locator('[data-slot="list-detail-list"]').isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Select 2', exact: true }).click();
    await back.waitFor({ timeout: 3_000 });
    expect(await back.isVisible()).toBe(true);
    await page.setViewportSize({ width: 1200, height: 720 });
    await page.locator('[data-slot="list-detail-list"]').waitFor({ state: 'visible' });
    expect(await page.locator('[data-slot="list-detail-detail"]').isVisible()).toBe(false);
    expect(await page.locator('[data-slot="list-detail-list"]').isVisible()).toBe(true);
  } finally { await page.close(); }
}, 30_000);
