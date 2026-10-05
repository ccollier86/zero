/** Real synthetic browser checks for composed Zero Studio grid controls. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease, directory: string, script: string, css: string;
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
  await mkdir(join(process.cwd(), '.zero'), { recursive: true });
  directory = await mkdtemp(join(process.cwd(), '.zero/studio-grid-browser-'));
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'data-studio-grid.browser-fixture.tsx')],
    outdir: directory, naming: 'bundle.js', target: 'browser', format: 'iife' });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  script = await Bun.file(join(directory, 'bundle.js')).text();
  css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'missing-app'))).cssPath).text();
}, 60_000);
afterAll(async () => { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { lease?.release(); } });
async function page(): Promise<Page> {
  const current = await browser.newPage({ viewport: { width: 1040, height: 820 } });
  await current.setContent('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  await current.addStyleTag({ content: css }); await current.addScriptTag({ content: script });
  await current.locator('[data-column-id="name"]').waitFor(); return current;
}

browserTest('keeps schema headers and compact add action visible for empty records with independent permissions', async () => {
  const current = await page();
  try {
    await current.evaluate(() => window.__studioGrid.count(0));
    await current.getByText('No matching records').waitFor();
    expect(await current.getByRole('button', { name: 'Edit Name column', exact: true }).count()).toBe(1);
    expect(await current.getByRole('button', { name: 'Add column', exact: true }).count()).toBe(1);
    expect(await current.locator('[aria-label="Required"]').count()).toBe(1);
    await current.evaluate(() => window.__studioGrid.permissions(false, true));
    await current.waitForFunction(() => !document.querySelector('button[aria-label="Add column"]'));
    expect(await current.getByRole('button', { name: 'Edit Name column', exact: true }).isDisabled()).toBe(true);
    await current.getByRole('button', { name: 'Name column options' }).click();
    expect(await current.getByRole('menuitem', { name: 'Edit column' }).getAttribute('data-disabled')).not.toBeNull();
    await current.getByRole('menuitem', { name: 'Sort descending' }).click();
    expect((await current.evaluate(() => window.__studioGrid.operations())).at(-1)).toEqual({ type: 'sort', id: 'name', direction: 'desc' });
  } finally { await current.close(); }
}, 60_000);

browserTest('right-click menu transfers focus after close autofocus and saves the opening revision without renaming identity/key', async () => {
  const current = await page();
  try {
    await current.locator('[data-column-id="name"]').click({ button: 'right' });
    await current.getByRole('menuitem', { name: 'Edit column' }).click();
    const name = current.getByRole('textbox', { name: 'Column name', exact: true });
    await name.waitFor();
    await current.waitForFunction(() => document.activeElement?.getAttribute('data-slot') === 'data-studio-column-label');
    expect(await current.getByRole('menu').count()).toBe(0);
    await name.fill('Display name');
    expect(await current.getByRole('textbox', { name: 'Column field key' }).inputValue()).toBe('name');
    await current.evaluate(() => window.__studioGrid.revision());
    await current.getByRole('button', { name: 'Apply changes' }).click();
    await current.getByRole('alert').waitFor();
    const operation = (await current.evaluate(() => window.__studioGrid.operations())).find(item => item.type === 'update')!;
    expect(operation.revision).toBe(3); expect(operation.column?.columnId).toBe('name'); expect(operation.column?.key).toBe('name');
    expect(await name.inputValue()).toBe('Display name');
  } finally { await current.close(); }
}, 60_000);

browserTest('moves columns by ID and captures remove confirmation revision before a live refresh', async () => {
  const current = await page();
  try {
    await current.getByRole('button', { name: 'Score column options' }).click();
    await current.getByRole('menuitem', { name: 'Move left' }).click();
    await current.waitForFunction(() => window.__studioGrid.operations().some(item => item.type === 'move'));
    expect((await current.evaluate(() => window.__studioGrid.operations()))[0]).toEqual({ type: 'move', id: 'score', direction: 'left', revision: 3 });
    await current.getByRole('button', { name: 'Score column options' }).click();
    await current.getByRole('menuitem', { name: 'Remove column' }).click();
    await current.getByRole('alertdialog').waitFor();
    await current.evaluate(() => window.__studioGrid.revision());
    await current.getByRole('button', { name: 'Remove column', exact: true }).click();
    await current.waitForFunction(() => window.__studioGrid.operations().some(item => item.type === 'remove'));
    expect((await current.evaluate(() => window.__studioGrid.operations())).at(-1)).toEqual({ type: 'remove', id: 'score', revision: 3 });
  } finally { await current.close(); }
}, 60_000);

browserTest('uses one bounded scroller, sticky headers, TanStack mouse/keyboard resize, and a bounded row window', async () => {
  const current = await page();
  try {
    const grid = current.locator('[data-slot="data-studio-grid"]');
    expect(await grid.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await current.locator('[data-slot="table-container"]').evaluate(element => getComputedStyle(element).overflowX)).toBe('visible');
    expect(await current.locator('[data-row-id]').count()).toBeLessThan(45);
    const resize = current.getByRole('separator', { name: 'Resize Name' });
    await resize.focus(); await resize.press('ArrowRight');
    expect(await resize.getAttribute('aria-valuenow')).toBe('216');
    const bounds = await resize.boundingBox(); if (!bounds) throw new Error('Missing resize control');
    await current.mouse.move(bounds.x + bounds.width / 2, bounds.y + 10); await current.mouse.down();
    await current.mouse.move(bounds.x + 70, bounds.y + 10); await current.mouse.up();
    expect(Number(await resize.getAttribute('aria-valuenow'))).toBeGreaterThan(260);
    await grid.evaluate(element => { element.scrollTop = 12_000; });
    await current.waitForFunction(() => Number(document.querySelector('[data-row-id]')?.getAttribute('aria-rowindex')) > 100);
    expect(await current.locator('[data-row-id]').count()).toBeLessThan(45);
    const header = await current.locator('[data-slot="table-header"]').boundingBox();
    const viewport = await grid.boundingBox(); expect(header?.y).toBeCloseTo(viewport!.y, 0);
  } finally { await current.close(); }
}, 60_000);

browserTest('scrolls selected rows into view and Tab navigation preserves sleek typed cell acceptance', async () => {
  const current = await page();
  try {
    await current.evaluate(() => window.__studioGrid.select('row-500'));
    const row = current.locator('[data-row-id="row-500"]'); await row.waitFor();
    await row.getByRole('button', { name: 'Edit Name, current value Person 500' }).click();
    const input = row.getByRole('textbox', { name: 'Edit Name', exact: true });
    expect(await input.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
    await input.fill('Changed'); await input.press('Tab');
    await current.waitForFunction(() => document.activeElement?.closest('td')?.getAttribute('data-column-index') === '1');
    expect((await current.evaluate(() => window.__studioGrid.operations())).filter(item => item.type === 'commit').length).toBe(1);
    await row.getByRole('button', { name: 'Edit Score, current value 500' }).click();
    const number = row.getByRole('spinbutton', { name: 'Edit Score' }); await number.fill('42.5'); await number.press('Enter');
    await current.waitForFunction(() => window.__studioGrid.operations().filter(item => item.type === 'commit').length === 2);
  } finally { await current.close(); }
}, 60_000);

browserTest('TanStack touch sizing and keyboard bounds preserve column identity', async () => {
  const current = await page();
  try {
    const resize = current.getByRole('separator', { name: 'Resize Name' });
    const startX = await resize.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const touch = (x: number) => new Touch({ identifier: 1, target: element, clientX: x, clientY: rect.y + 10 });
      element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(rect.x)] }));
      return rect.x;
    });
    await current.waitForFunction(() => document.querySelector('[aria-label="Resize Name"]')?.getAttribute('data-resizing') === 'true');
    await resize.evaluate((element, x) => {
      const touch = new Touch({ identifier: 1, target: element, clientX: x + 60, clientY: 10 });
      document.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch] }));
    }, startX);
    await current.waitForFunction(() => document.querySelector('[aria-label="Resize Name"]')?.getAttribute('aria-valuenow') === '268');
    await resize.evaluate((element, x) => {
      const touch = new Touch({ identifier: 1, target: element, clientX: x + 60, clientY: 10 });
      document.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch] }));
    }, startX);
    expect(await resize.getAttribute('aria-valuenow')).toBe('268');
    await resize.focus(); await resize.press('End'); expect(await resize.getAttribute('aria-valuenow')).toBe('640');
    await resize.press('ArrowRight'); expect(await resize.getAttribute('aria-valuenow')).toBe('640');
    await resize.press('Home'); expect(await resize.getAttribute('aria-valuenow')).toBe('128');
    expect(await current.locator('[data-column-id="name"]').count()).toBe(1);
  } finally { await current.close(); }
}, 60_000);

browserTest('same-tick boolean edits admit one write and an unmounted pending edit cannot steal focus', async () => {
  const current = await page();
  try {
    await current.evaluate(() => { window.__studioGrid.mode('held'); window.__studioGrid.count(1); });
    const flag = current.locator('[data-row-id="row-0"]').getByRole('button', { name: 'Edit Flag', exact: true });
    await flag.evaluate(element => {
      if (!(element instanceof HTMLElement)) throw new Error('Expected an HTML cell button');
      element.click(); element.click();
    });
    expect((await current.evaluate(() => window.__studioGrid.operations())).filter(item => item.type === 'commit').length).toBe(1);
    await current.evaluate(() => window.__studioGrid.visible(false));
    await current.locator('[data-slot="data-studio-grid"]').waitFor({ state: 'detached' });
    await current.evaluate(() => window.__studioGrid.release());
    await current.evaluate(() => window.__studioGrid.visible(true));
    await current.locator('[data-slot="data-studio-grid"]').waitFor();
    expect((await current.evaluate(() => window.__studioGrid.operations())).filter(item => item.type === 'commit').length).toBe(1);
    expect(await current.locator('[data-save-state="pending"]').count()).toBe(0);
  } finally { await current.close(); }
}, 60_000);

browserTest('progressive load rejection offers a bounded retry and refresh-required disables continuation', async () => {
  const current = await page();
  try {
    expect(await current.getByText('All 1,000 matching records loaded.', { exact: true }).count()).toBe(1);
    await current.evaluate(() => { window.__studioGrid.count(0); window.__studioGrid.mode('error'); window.__studioGrid.progressive(true); });
    await current.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    expect((await current.evaluate(() => window.__studioGrid.operations())).filter(item => item.type === 'load').length).toBe(1);
    await current.evaluate(() => window.__studioGrid.mode('normal'));
    await current.getByRole('button', { name: 'Retry', exact: true }).click();
    await current.waitForFunction(() => window.__studioGrid.operations().filter(item => item.type === 'load').length === 2);
    await current.evaluate(() => { window.__studioGrid.refresh(true); window.__studioGrid.progressive(true); });
    await current.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
    expect(await current.getByRole('button', { name: 'Load more records' }).count()).toBe(0);
    expect(await current.getByText('All 1,000 matching records loaded.', { exact: true }).count()).toBe(0);
  } finally { await current.close(); }
}, 60_000);

browserTest('deliberate persisted field-key rename requires acknowledgement and preserves stable column ID', async () => {
  const current = await page();
  try {
    await current.getByRole('button', { name: 'Edit Name column', exact: true }).click();
    await current.getByRole('textbox', { name: 'Column field key' }).fill('display_name');
    await current.getByRole('button', { name: 'Apply changes' }).click();
    expect((await current.evaluate(() => window.__studioGrid.operations())).filter(item => item.type === 'update').length).toBe(0);
    await current.getByRole('checkbox', { name: 'Confirm column field key rename' }).click();
    await current.getByRole('button', { name: 'Apply changes' }).click();
    await current.waitForFunction(() => window.__studioGrid.table().schema.columns[0]?.key === 'display_name');
    const column = (await current.evaluate(() => window.__studioGrid.table())).schema.columns[0]!;
    expect(column.columnId).toBe('name'); expect(column.label).toBe('Name'); expect(column.key).toBe('display_name');
  } finally { await current.close(); }
}, 60_000);

browserTest('anchored column editor keeps all fields and actions reachable on a short viewport', async () => {
  const current = await page();
  try {
    await current.setViewportSize({ width: 720, height: 320 });
    await current.getByRole('button', { name: 'Edit Name column', exact: true }).click();
    const popup = current.locator('[data-slot="popover-content"]');
    await popup.waitFor();
    expect(await popup.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    expect(await popup.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(288);
    await current.getByRole('button', { name: 'Apply changes', exact: true }).scrollIntoViewIfNeeded();
    const box = await current.getByRole('button', { name: 'Apply changes', exact: true }).boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(320);
  } finally { await current.close(); }
}, 60_000);

browserTest('query changes retire editors without resetting same-table widths and the final column remains removable', async () => {
  const current = await page();
  try {
    const resize = current.getByRole('separator', { name: 'Resize Name' });
    await resize.focus(); await resize.press('ArrowRight');
    await current.getByRole('button', { name: 'Edit Name column', exact: true }).click();
    await current.getByRole('textbox', { name: 'Column name', exact: true }).fill('Unaccepted draft');
    await current.evaluate(() => { window.__studioGrid.query('new-filter'); window.__studioGrid.count(0); window.__studioGrid.columns(1); });
    await current.getByRole('textbox', { name: 'Column name', exact: true }).waitFor({ state: 'detached' });
    expect(await resize.getAttribute('aria-valuenow')).toBe('216');
    await current.getByRole('button', { name: 'Name column options' }).click();
    expect(await current.getByRole('menuitem', { name: 'Remove column' }).getAttribute('data-disabled')).toBe('false');
    await current.getByRole('menuitem', { name: 'Remove column' }).click();
    await current.getByRole('button', { name: 'Cancel', exact: true }).click();
    await current.locator('[role="alertdialog"]').waitFor({ state: 'detached' });
    await current.evaluate(() => window.__studioGrid.columns(0));
    await current.getByRole('button', { name: 'Add column', exact: true }).waitFor();
    expect(await current.getByRole('button', { name: 'Add column', exact: true }).count()).toBe(1);
    expect((await current.evaluate(() => window.__studioGrid.operations())).filter(item => item.type === 'update').length).toBe(0);
  } finally { await current.close(); }
}, 60_000);
