/** Full component regressions use the repository's existing browser-test harness. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease;
let scratch: string;
let bundle: string;
let styles: string;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  const root = process.env.ZERO_TEST_SCRATCH_ROOT ?? tmpdir();
  await mkdir(root, { recursive: true });
  scratch = await mkdtemp(join(root, 'full-table-browser-'));
  const entry = join(scratch, 'entry.tsx');
  await Bun.write(entry, `import ${JSON.stringify(join(import.meta.dir, 'data-table-browser-fixture.tsx'))};`);
  const result = await Bun.build({ entrypoints: [entry], outdir: scratch, naming: 'bundle.js', target: 'browser', format: 'iife' });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  bundle = join(scratch, 'bundle.js');
  styles = (await buildPlatformStyles(scratch, join(scratch, 'missing-app'))).cssPath;
}, 60_000);

afterAll(async () => {
  try { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  finally { lease?.release(); }
}, 60_000);

async function mount(): Promise<Page> {
  const page = await lease.browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ path: styles });
  await page.addScriptTag({ path: bundle });
  await page.waitForFunction(() => window.__fullTableHarness?.queries().length > 0);
  return page;
}

async function settle(page: Page, rows: { id: string; name: string }[], hasMore = false) {
  await page.evaluate(({ rows, hasMore }) => {
    const harness = window.__fullTableHarness;
    const index = harness.queries().length - 1;
    const query = harness.queries()[index]!;
    harness.resolve(index, { rows, page: query.pagination.mode === 'cursor'
      ? { mode: 'cursor', hasMore, nextCursor: hasMore ? `cursor-${query.pagination.pageIndex + 1}` : null }
      : { mode: 'offset', hasMore, offset: query.pagination.pageIndex * query.pagination.pageSize } });
  }, { rows, hasMore });
  if (rows[0]) await page.getByText(rows[0].name, { exact: true }).waitFor();
}

describe('DataTable complete server interaction', () => {
  browserTest('keeps controls usable while loading and fences superseded search replies', async () => {
    const page = await mount();
    try {
      const initial = await page.evaluate(() => window.__fullTableHarness.queries().length - 1);
      const search = page.getByRole('searchbox', { name: 'Search records' });
      expect(await search.isVisible()).toBe(true);
      await search.fill('Ada');
      await page.waitForFunction(() => window.__fullTableHarness.queries().at(-1)?.search === 'Ada');
      expect(await page.evaluate((i) => window.__fullTableHarness.aborted(i), initial)).toBe(true);
      await settle(page, [{ id: '2', name: 'server-accepted-outside-local-filter' }]);
      await page.evaluate((i) => window.__fullTableHarness.resolve(i, { rows: [{ id: '1', name: 'stale-first-result' }], page: { mode: 'offset', offset: 0, hasMore: false } }), initial);
      expect(await page.getByText('stale-first-result', { exact: true }).count()).toBe(0);
      expect(await page.getByText('server-accepted-outside-local-filter', { exact: true }).isVisible()).toBe(true);
    } finally { await page.close(); }
  }, 60_000);

  browserTest('uses offset pages without a count or a second client pagination pass', async () => {
    const page = await mount();
    try {
      await settle(page, [{ id: '1', name: 'one' }, { id: '2', name: 'two' }], true);
      expect(await page.getByLabel('Last page').count()).toBe(0);
      await page.getByLabel('Next page').click();
      await page.waitForFunction(() => window.__fullTableHarness.queries().at(-1)?.pagination.pageIndex === 1);
      await settle(page, [{ id: '3', name: 'three' }, { id: '4', name: 'four' }]);
      expect(await page.getByRole('status', { name: 'Showing 3-4', exact: true }).isVisible()).toBe(true);
      await page.getByRole('button', { name: 'Name', exact: true }).click();
      await page.waitForFunction(() => {
        const query = window.__fullTableHarness.queries().at(-1);
        return query?.pagination.pageIndex === 0 && query.sorting[0]?.id === 'name';
      });
    } finally { await page.close(); }
  }, 60_000);

  browserTest('tracks opaque cursor history and never invents a last-page jump', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__fullTableHarness.mode('cursor'));
      await page.waitForFunction(() => window.__fullTableHarness.queries().at(-1)?.pagination.mode === 'cursor');
      expect(await page.evaluate(() => window.__fullTableHarness.queries().at(-1)?.pagination))
        .toEqual({ mode: 'cursor', pageIndex: 0, pageSize: 2, cursor: null });
      await settle(page, [{ id: '1', name: 'cursor-first' }, { id: '2', name: 'cursor-second' }], true);
      await page.getByLabel('Next page').click();
      await page.waitForFunction(() => window.__fullTableHarness.queries().at(-1)?.pagination.cursor === 'cursor-1');
      await settle(page, [{ id: '3', name: 'cursor-third' }]);
      expect(await page.getByLabel('Last page').count()).toBe(0);
      const acceptedQueryCount = await page.evaluate(() => window.__fullTableHarness.queries().length);
      await page.getByLabel('Previous page').click();
      // Foreground caching remains enabled with prefetch:false; returning must use the exact accepted opaque-cursor page.
      await page.getByRole('group', { name: 'Page 1', exact: true }).waitFor();
      await page.getByText('cursor-first', { exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('tbody')?.textContent?.includes('cursor-third'));
      expect(await page.locator('tbody tr').count()).toBe(2);
      expect(await page.getByText('cursor-second', { exact: true }).isVisible()).toBe(true);
      expect(await page.getByLabel('Previous page').isDisabled()).toBe(true);
      expect(await page.evaluate(() => window.__fullTableHarness.queries().length)).toBe(acceptedQueryCount);
      await page.getByLabel('Next page').click();
      await page.getByRole('group', { name: 'Page 2', exact: true }).waitFor();
      await page.getByText('cursor-third', { exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('tbody')?.textContent?.includes('cursor-first'));
      expect(await page.locator('tbody tr').count()).toBe(1);
      expect(await page.evaluate(() => window.__fullTableHarness.queries().length)).toBe(acceptedQueryCount);
    } finally { await page.close(); }
  }, 60_000);

  browserTest('clears selection and old row DOM immediately when the source partition changes', async () => {
    const page = await mount();
    try {
      await settle(page, [{ id: '1', name: 'old-partition-private-row' }]);
      await page.getByLabel('Select row', { exact: true }).click();
      await page.waitForFunction(() => window.__fullTableHarness.selection()[0] === '1');
      await page.evaluate(() => window.__fullTableHarness.table('other-records'));
      await page.waitForFunction(() => window.__fullTableHarness.selection().length === 0);
      expect(await page.getByText('old-partition-private-row', { exact: true }).count()).toBe(0);
      const notifications = await page.evaluate(() => window.__fullTableHarness.selectionChanges());
      expect(notifications).toBeLessThan(12);
      await settle(page, [{ id: '1', name: 'new-partition-row' }]);
      expect(await page.getByLabel('Select row', { exact: true }).getAttribute('aria-checked')).toBe('false');
    } finally { await page.close(); }
  }, 60_000);

  browserTest('retires cursors and selection when an adapter changes on the same table', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__fullTableHarness.mode('cursor'));
      await page.waitForFunction(() => window.__fullTableHarness.queries().at(-1)?.pagination.mode === 'cursor');
      await settle(page, [{ id: '1', name: 'first-adapter-first-page' }], true);
      await page.getByLabel('Next page').click();
      await page.waitForFunction(() => window.__fullTableHarness.queries().at(-1)?.pagination.cursor === 'cursor-1');
      await settle(page, [{ id: '2', name: 'first-adapter-second-page' }]);
      await page.getByRole('row', { name: 'Select row first-adapter-second-page' }).getByLabel('Select row', { exact: true }).click();
      await page.waitForFunction(() => window.__fullTableHarness.selection()[0] === '2');
      const previousCount = await page.evaluate(() => window.__fullTableHarness.queries().length);
      await page.evaluate(() => window.__fullTableHarness.replaceAdapter());
      await page.waitForFunction((count) => {
        const queries = window.__fullTableHarness.queries();
        const query = queries.at(-1);
        return queries.length > count && query?.pagination.pageIndex === 0 && query.pagination.cursor === null;
      }, previousCount);
      expect(await page.getByText('first-adapter-second-page', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => window.__fullTableHarness.selection())).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);

  browserTest('keeps fixed column widths stable when a long secret is revealed', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__fullTableHarness.mode('layout'));
      const cell = page.locator('tbody td').first();
      await cell.waitFor();
      const width = await cell.evaluate((element) => element.getBoundingClientRect().width);
      const tableWidth = await page.locator('table').evaluate((element) => element.getBoundingClientRect().width);
      await page.getByRole('button', { name: 'Reveal secret' }).click();
      const revealedWidth = await cell.evaluate((element) => element.getBoundingClientRect().width);
      const revealedTableWidth = await page.locator('table').evaluate((element) => element.getBoundingClientRect().width);
      expect(Math.abs(revealedWidth - width)).toBeLessThan(1);
      expect(Math.abs(revealedTableWidth - tableWidth)).toBeLessThan(1);
      expect(revealedTableWidth).toBeLessThanOrEqual(650);
    } finally { await page.close(); }
  }, 60_000);

  browserTest('awaits the custom writer and retries failed refresh without repeating the accepted write', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__fullTableHarness.mode('edit'));
      await page.getByRole('button', { name: 'before-edit', exact: true }).click();
      const input = page.locator('[data-slot="editable-cell-editor"] input');
      await input.fill('after-edit');
      await input.press('Enter');
      await page.waitForFunction(() => window.__fullTableHarness.editCounts().commits === 1);
      expect(await input.isDisabled()).toBe(true);
      expect(await page.evaluate(() => window.__fullTableHarness.editCounts().automaticWrites)).toBe(0);
      await page.evaluate(() => window.__fullTableHarness.acceptWrite());
      await page.waitForFunction(() => window.__fullTableHarness.editCounts().refreshes === 1);
      expect(await input.isVisible()).toBe(true);
      await page.evaluate(() => window.__fullTableHarness.rejectRefresh());
      await page.getByText('The change was saved, but the table could not refresh. Retry refresh.').waitFor();
      expect(await page.getByText('private raw refresh detail').count()).toBe(0);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.waitForFunction(() => window.__fullTableHarness.editCounts().refreshes === 2);
      expect(await page.evaluate(() => window.__fullTableHarness.editCounts().commits)).toBe(1);
      await page.evaluate(() => window.__fullTableHarness.acceptRefresh());
      await page.getByRole('button', { name: 'after-edit', exact: true }).waitFor();
      expect(await input.count()).toBe(0);
    } finally { await page.close(); }
  }, 60_000);
});
