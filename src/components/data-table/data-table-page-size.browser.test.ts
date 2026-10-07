/** Styled controls exercise TanStack anchoring and shared local/server query state, not a duplicate paginator. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  const directory = await mkdtemp(join(root, 'table-page-size-'));
  try {
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    const output = join(directory, 'fixture.js');
    const build = Bun.spawn([process.execPath, 'build', `${import.meta.dir}/data-table-page-size.browser-fixture.tsx`,
      '--target=browser', '--format=iife', '--outfile', output], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Page-size fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function open(mode: Parameters<Window['__pageSizeTable']['mode']>[0] = 'array') {
  const page = await lease!.browser.newPage({ viewport: { width: 1100, height: 850 }, reducedMotion: 'reduce' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent('<!doctype html><div id="root"></div>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('combobox', { name: 'Rows per page' }).waitFor();
  if (mode !== 'array') await page.evaluate(mode => window.__pageSizeTable.mode(mode), mode);
  await page.getByRole('combobox', { name: 'Rows per page' }).waitFor();
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[aria-label="Rows per page"]')?.disabled);
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
async function size(page: Page, value: number) {
  await page.getByRole('combobox', { name: 'Rows per page' }).click();
  await page.getByRole('option', { name: String(value), exact: true }).click();
}
async function range(page: Page, text: string) { await page.getByRole('status', { name: text, exact: true }).waitFor(); }
async function renderedRows(page: Page, count: number) {
  // Existing row exit animation may briefly keep the prior page's DOM mounted.
  await page.waitForFunction(count => document.querySelectorAll('tbody tr').length === count, count);
  expect(await page.locator('tbody tr').count()).toBe(count);
}
for (const mode of ['array', 'controlled', 'collection', 'offset'] as const) browserTest(`${mode} keeps the page containing the former first row when size grows and shrinks`, async () => {
  const page = await open(mode);
  try {
    await range(page, mode === 'offset' ? 'Showing 61-80' : 'Showing 61-80 of 140');
    await page.getByRole('row', { name: 'Select row Record 061' }).getByLabel('Select row', { exact: true }).click();
    await page.waitForFunction(() => window.__pageSizeTable.selection()[0] === '61');
    await size(page, 50);
    await range(page, mode === 'offset' ? 'Showing 51-100' : 'Showing 51-100 of 140');
    await renderedRows(page, 50);
    expect(await page.evaluate(() => window.__pageSizeTable.selection())).toEqual([]);
    await size(page, 10);
    await range(page, mode === 'offset' ? 'Showing 51-60' : 'Showing 51-60 of 140');
    await renderedRows(page, 10);
    if (mode === 'offset') {
      expect(await page.evaluate(() => window.__pageSizeTable.queries().at(-1)?.pagination)).toEqual({ mode: 'offset', pageIndex: 5, pageSize: 10 });
      expect(await page.getByLabel('Last page').count()).toBe(0);
    }
    await size(page, 100);
    await range(page, mode === 'offset' ? 'Showing 1-100' : 'Showing 1-100 of 140');
    await renderedRows(page, 100);
  } finally { await close(page); }
}, 45_000);
for (const mode of ['array', 'controlled', 'collection'] as const) browserTest(`${mode} clamps a shrinking complete result to its last real page`, async () => {
  const page = await open(mode);
  try {
    await range(page, 'Showing 61-80 of 140');
    await page.evaluate(() => window.__pageSizeTable.rows(45)); await range(page, 'Showing 41-45 of 45');
    await renderedRows(page, 5);
    await size(page, 50); await range(page, 'Showing 1-45 of 45');
    await page.evaluate(() => window.__pageSizeTable.rows(25)); await range(page, 'Showing 1-25 of 25');
    await renderedRows(page, 25);
    expect(await page.getByLabel('Next page').isDisabled()).toBe(true);
  } finally { await close(page); }
}, 45_000);
browserTest('controlled page replacement retires page-local selection without resetting the supplied index', async () => {
  const page = await open('controlled');
  try {
    await range(page, 'Showing 61-80 of 140');
    await page.getByRole('row', { name: 'Select row Record 061' }).getByLabel('Select row', { exact: true }).click();
    await page.waitForFunction(() => window.__pageSizeTable.selection()[0] === '61');
    await page.evaluate(() => window.__pageSizeTable.control({ pagination: { pageIndex: 4, pageSize: 20 } }));
    await range(page, 'Showing 81-100 of 140');
    expect(await page.evaluate(() => window.__pageSizeTable.selection())).toEqual([]);
    expect(await page.evaluate(() => window.__pageSizeTable.state().pagination)).toEqual({ pageIndex: 4, pageSize: 20 });
  } finally { await close(page); }
}, 45_000);
browserTest('cursor batch changes reset opaque history honestly and retain unknown-count controls', async () => {
  const page = await open('cursor');
  try {
    await range(page, '20 records on this page'); await page.getByLabel('Next page').click();
    await page.waitForFunction(() => window.__pageSizeTable.queries().at(-1)?.pagination.pageIndex === 1);
    await page.getByText('Record 021', { exact: true }).waitFor();
    await range(page, '20 records on this page');
    await page.getByLabel('Next page').click();
    await page.waitForFunction(() => window.__pageSizeTable.queries().at(-1)?.pagination.pageIndex === 2);
    await page.getByText('Record 041', { exact: true }).waitFor();
    await range(page, '20 records on this page');
    await size(page, 50); await range(page, '50 records on this page');
    expect(await page.evaluate(() => window.__pageSizeTable.queries().at(-1)?.pagination)).toEqual({ mode: 'cursor', pageIndex: 0, pageSize: 50, cursor: null });
    expect(await page.getByLabel('Last page').count()).toBe(0);
    expect(await page.getByLabel('Previous page').isDisabled()).toBe(true);
    await page.getByLabel('Next page').click(); await range(page, '50 records on this page');
    await page.waitForFunction(() => window.__pageSizeTable.queries().at(-1)?.pagination.cursor === 'after-50');
    await page.getByText('Record 051', { exact: true }).waitFor();
    expect(await page.evaluate(() => window.__pageSizeTable.queries().at(-1)?.pagination.cursor)).toBe('after-50');
  } finally { await close(page); }
}, 45_000);
browserTest('known-total offset shrink clamps, while an unknown empty batch does not invent a total', async () => {
  const page = await open('offset');
  try {
    await range(page, 'Showing 61-80'); await size(page, 50); await range(page, 'Showing 51-100');
    await page.evaluate(() => window.__pageSizeTable.rows(25));
    await range(page, 'No results');
    expect(await page.evaluate(() => window.__pageSizeTable.queries().at(-1)?.pagination.pageIndex)).toBe(1);
    expect(await page.getByLabel('Last page').count()).toBe(0);
    await page.evaluate(() => { window.__pageSizeTable.knownTotal(true); window.__pageSizeTable.control({ pagination: { pageIndex: 3, pageSize: 50 } }); });
    await range(page, 'Showing 1-25 of 25');
    expect(await page.evaluate(() => window.__pageSizeTable.queries().at(-1)?.pagination.pageIndex)).toBe(0);
  } finally { await close(page); }
}, 45_000);
browserTest('search, filters, sort, source and authorization replacement still reset the offset page', async () => {
  const page = await open('offset');
  try {
    await range(page, 'Showing 61-80'); await size(page, 50); await range(page, 'Showing 51-100');
    await page.getByRole('searchbox', { name: 'Search records' }).fill('Record'); await range(page, 'Showing 1-50');
    await page.getByLabel('Next page').click(); await range(page, 'Showing 51-100');
    await page.evaluate(() => window.__pageSizeTable.control({ columnFilters: [{ id: 'name', value: 'Record' }] })); await range(page, 'Showing 1-50');
    await page.getByLabel('Next page').click(); await range(page, 'Showing 51-100');
    await page.getByRole('button', { name: 'Name', exact: true }).click(); await range(page, 'Showing 1-50');
    await page.getByLabel('Next page').click(); await range(page, 'Showing 51-100');
    await page.evaluate(() => window.__pageSizeTable.source()); await range(page, 'Showing 1-50');
    await page.getByLabel('Next page').click(); await range(page, 'Showing 51-100');
    await page.evaluate(() => window.__pageSizeTable.boundary()); await range(page, 'Showing 1-50');
    expect(await page.evaluate(() => window.__pageSizeTable.queries().at(-1)?.pagination.pageIndex)).toBe(0);
  } finally { await close(page); }
}, 45_000);
browserTest('page-size anchoring preserves active server search, filters and sorting', async () => {
  const page = await open('offset');
  try {
    await range(page, 'Showing 61-80');
    await page.getByRole('searchbox', { name: 'Search records' }).fill('Record'); await range(page, 'Showing 1-20');
    await page.evaluate(() => window.__pageSizeTable.control({ columnFilters: [{ id: 'name', value: 'Record' }] }));
    await page.getByRole('button', { name: 'Name', exact: true }).click();
    await page.waitForFunction(() => window.__pageSizeTable.queries().at(-1)?.sorting.length === 1);
    for (let index = 1; index <= 3; index++) {
      await page.getByLabel('Next page').click(); await range(page, `Showing ${index * 20 + 1}-${(index + 1) * 20}`);
    }
    await size(page, 50); await range(page, 'Showing 51-100');
    expect(await page.evaluate(() => {
      const query = window.__pageSizeTable.queries().at(-1)!;
      return { search: query.search, filters: query.filters, sorting: query.sorting, pagination: query.pagination };
    })).toEqual({ search: 'Record', filters: [{ id: 'name', value: 'Record' }], sorting: [{ id: 'name', desc: false }],
      pagination: { mode: 'offset', pageIndex: 1, pageSize: 50 } });
  } finally { await close(page); }
}, 45_000);
browserTest('MasterDetailPage uses the same offset anchoring rather than a separate page engine', async () => {
  const page = await open('master');
  try {
    await range(page, 'Showing 1-20');
    for (let index = 1; index <= 3; index++) {
      await page.getByLabel('Next page', { exact: true }).click(); await range(page, `Showing ${index * 20 + 1}-${(index + 1) * 20}`);
    }
    await size(page, 50); await range(page, 'Showing 51-100');
    expect(await page.evaluate(() => window.__pageSizeTable.queries().at(-1)?.pagination)).toEqual({ mode: 'offset', pageIndex: 1, pageSize: 50 });
  } finally { await close(page); }
}, 45_000);
