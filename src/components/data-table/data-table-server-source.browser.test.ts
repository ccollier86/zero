/** Actual React hook coordination regressions using the existing controlled browser lease. No network/app database. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease, scratch: string, bundle: string;
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  const root = process.env.ZERO_TEST_SCRATCH_ROOT ?? tmpdir();
  await mkdir(root, { recursive: true }); scratch = await mkdtemp(join(root, 'server-source-browser-'));
  bundle = join(scratch, 'bundle.js');
  // Isolate compiler state from preceding runtime imports in this multi-file Bun process.
  const child = Bun.spawn([process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'data-table-server-source.browser-fixture.tsx'),
    '--target=browser', '--format=iife', '--outfile', bundle], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`Server-source fixture build failed (${code}): ${stderr || stdout}`);
}, 60_000);
afterAll(async () => {
  try { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  finally { lease?.release(); }
}, 60_000);
async function mount(): Promise<Page> {
  const page = await lease.browser.newPage();
  await page.setContent('<div id="root"></div>'); await page.addScriptTag({ path: bundle });
  await page.waitForFunction(() => window.__serverSource?.queries().length === 1);
  return page;
}
async function accept(page: Page, index: number, name: string, hasMore = false, cursor?: string) {
  await page.evaluate(({ index, name, hasMore, cursor }) => window.__serverSource.resolve(index, [{ id: name, name }], hasMore, cursor), { index, name, hasMore, cursor });
  await page.getByText(name, { exact: true }).waitFor();
}

browserTest('default adjacent prefetch starts immediately, hover/focus join it, and navigation retains same-scope previous rows', async () => {
  const page = await mount();
  try {
    expect(await page.evaluate(() => window.__serverSource.state().isLoading)).toBe(true);
    await accept(page, 0, 'first-page', true);
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await page.getByRole('button', { name: 'Prefetch next' }).hover();
    await page.getByRole('button', { name: 'Prefetch next' }).focus();
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(2);
    await page.evaluate(() => window.__serverSource.page(1));
    await page.waitForFunction(() => window.__serverSource.state().isPreviousData);
    const previous = await page.evaluate(() => window.__serverSource.state());
    expect(previous.data[0]?.name).toBe('first-page'); expect(previous.isLoading).toBe(true);
    expect(previous.requestKey).not.toBe(previous.resolvedRequestKey);
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(2);
    await accept(page, 1, 'second-page');
    const accepted = await page.evaluate(() => window.__serverSource.state());
    expect(accepted.isPreviousData).toBe(false); expect(accepted.page?.total).toBeUndefined();
    expect(accepted.changeReason).toBe('query'); expect(accepted.resultRevision).toBe(2);
    expect(accepted.requestKey).toBe(accepted.resolvedRequestKey);
    await page.evaluate(() => window.__serverSource.page(0));
    await page.getByText('first-page', { exact: true }).waitFor();
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(2);
  } finally { await page.close(); }
}, 60_000);

browserTest('last query wins, aborts superseded reads, and keeps only presentation data while the new query is pending', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'original-page');
    await page.evaluate(() => window.__serverSource.search('Ada'));
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await page.evaluate(() => window.__serverSource.search('Bea'));
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    expect(await page.evaluate(() => window.__serverSource.aborted(1))).toBe(true);
    expect(await page.evaluate(() => window.__serverSource.state().isPreviousData)).toBe(true);
    await accept(page, 2, 'accepted-Bea');
    await page.evaluate(() => window.__serverSource.resolve(1, [{ id: 'stale', name: 'stale-Ada' }]));
    expect(await page.getByText('stale-Ada', { exact: true }).count()).toBe(0);
    expect((await page.evaluate(() => window.__serverSource.state())).data[0]?.name).toBe('accepted-Bea');
  } finally { await page.close(); }
}, 60_000);

browserTest('source/table and adapter replacement mask old rows and settle cancelled prefetch even if transport ignores abort', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'private-source-a', true);
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await page.evaluate(async () => { const pending = window.__serverSource.prefetch(1); window.__serverSource.source(2); await pending; });
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    expect(await page.evaluate(() => window.__serverSource.aborted(1))).toBe(true);
    expect(await page.getByText('private-source-a', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => window.__serverSource.state().data)).toEqual([]);
    await page.evaluate(() => window.__serverSource.resolve(1, [{ id: 'late', name: 'late-source-a' }]));
    await accept(page, 2, 'source-b');
    await page.evaluate(() => window.__serverSource.source(1));
    await page.waitForFunction(() => window.__serverSource.queries().length === 4);
    expect(await page.getByText('source-b', { exact: true }).count()).toBe(0);
    await accept(page, 3, 'new-adapter');
    expect(await page.getByText('late-source-a', { exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 60_000);

browserTest('the live SDK boundary fences late receipts before notification/rerender and never reuses rows from another organization', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'organization-a-private');
    await page.evaluate(() => window.__serverSource.search('pending'));
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await page.evaluate(() => {
      window.__serverSource.scope('organization-b', false);
      window.__serverSource.resolve(1, [{ id: 'old', name: 'pre-render-old-authority' }]);
    });
    await page.evaluate(() => window.__serverSource.notify());
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    expect(await page.getByText('organization-a-private', { exact: true }).count()).toBe(0);
    expect(await page.getByText('pre-render-old-authority', { exact: true }).count()).toBe(0);
    await accept(page, 2, 'organization-b-record');
    await page.evaluate(() => window.__serverSource.scope('organization-a'));
    await page.waitForFunction(() => window.__serverSource.queries().length === 4);
    expect(await page.getByText('organization-b-record', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => window.__serverSource.state().data)).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

browserTest('unreadable same-scope authority clears rows/cache and freezes reads until the real boundary is ready', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'before-policy-change', true);
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await page.evaluate(() => window.__serverSource.unavailable());
    await page.waitForFunction(() => window.__serverSource.state().data.length === 0);
    expect(await page.evaluate(() => window.__serverSource.aborted(1))).toBe(true);
    await page.evaluate(() => window.__serverSource.prefetch(1));
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(2);
    expect(await page.evaluate(() => window.__serverSource.state().isLoading)).toBe(false);
    await page.evaluate(() => window.__serverSource.ready());
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    await accept(page, 2, 'new-policy-record');
    expect(await page.getByText('before-policy-change', { exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 60_000);

browserTest('refresh/live invalidation retire caches and expose truthful accepted reasons without claiming an inserted count', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'initial', true);
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await page.evaluate(() => { void window.__serverSource.refresh(); });
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    expect(await page.evaluate(() => window.__serverSource.aborted(1))).toBe(true);
    expect(await page.evaluate(() => window.__serverSource.state().isPreviousData)).toBe(false);
    await accept(page, 2, 'refreshed');
    expect(await page.evaluate(() => window.__serverSource.state().changeReason)).toBe('refresh');
    await page.evaluate(() => window.__serverSource.live());
    await page.waitForFunction(() => window.__serverSource.queries().length === 4);
    await accept(page, 3, 'live-reconciled');
    expect(await page.evaluate(() => window.__serverSource.state().changeReason)).toBe('live');
    expect(await page.evaluate(() => window.__serverSource.state().resultRevision)).toBe(3);
  } finally { await page.close(); }
}, 60_000);

browserTest('cursor prefetch only requests an admitted next cursor; opt-out cancels speculation and unknown pages do nothing', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__serverSource.mode('cursor'));
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await accept(page, 1, 'cursor-first', true, 'opaque-next');
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    expect((await page.evaluate(() => window.__serverSource.queries()))[2]?.pagination.cursor).toBe('opaque-next');
    await page.evaluate(() => window.__serverSource.prefetch(7));
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(3);
    await page.evaluate(() => window.__serverSource.prefetchEnabled(false));
    await page.waitForFunction(() => window.__serverSource.aborted(2));
    await page.evaluate(() => window.__serverSource.prefetch(1));
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(3);
    await page.evaluate(() => window.__serverSource.page(1, 'opaque-next'));
    await page.waitForFunction(() => window.__serverSource.queries().length === 4);
    await accept(page, 3, 'cursor-second');
    expect(await page.evaluate(() => window.__serverSource.state().page?.total)).toBeUndefined();
  } finally { await page.close(); }
}, 60_000);

browserTest('speculative failure never replaces a successful foreground page and unmount settles retired prefetch', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'foreground-safe', true);
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await page.evaluate(() => window.__serverSource.reject(1));
    await page.waitForFunction(() => window.__serverSource.events().length > 0);
    expect(await page.evaluate(() => window.__serverSource.state().error)).toBeNull();
    expect(await page.getByText('foreground-safe', { exact: true }).isVisible()).toBe(true);
    await page.evaluate(async () => { const pending = window.__serverSource.prefetch(1); window.__serverSource.unmount(); await pending; });
    expect(await page.evaluate(() => window.__serverSource.aborted(2))).toBe(true);
    await page.evaluate(() => window.__serverSource.prefetch(1));
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(3);
  } finally { await page.close(); }
}, 60_000);

browserTest('custom query-bound live INSERTs are confirmed by current server membership, not ordinary response joiners or refreshes', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'baseline');
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'genuine' }));
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => window.__serverSource.resolve(1, [{ id: 'genuine', name: 'genuine' }, { id: 'page-shift', name: 'ordinary-page-shift' }]));
    await page.getByText('genuine', { exact: true }).waitFor();
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual(['genuine']);
    expect(await page.evaluate(() => window.__serverSource.state().changeReason)).toBe('live');
    await page.evaluate(() => { void window.__serverSource.refresh(); });
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    await accept(page, 2, 'genuine');
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => window.__serverSource.emit({ op: 'UPDATE', rowId: 'update-not-insert' }));
    await page.waitForFunction(() => window.__serverSource.queries().length === 4);
    await accept(page, 3, 'update-not-insert');
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

browserTest('unseen INSERTs are not counted, and changing search retires staged IDs and old adapter callbacks', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'initial-query');
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'not-in-page' }));
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await accept(page, 1, 'server-matching-other-record');
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => window.__serverSource.search('new-query'));
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    expect(await page.evaluate(() => window.__serverSource.retired(0))).toBe(true);
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'retired-stream' }, 0));
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(3);
    await accept(page, 2, 'not-in-page');
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

browserTest('built-in sources consume only admitted single Sync changes and never label snapshots/catchup or custom endpoints as INSERTs', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'custom-baseline');
    await page.evaluate(() => window.__serverSource.sync({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'unrelated-sdk', row: { id: 'unrelated-sdk' } }));
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(1);
    await page.evaluate(() => window.__serverSource.source(3));
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await accept(page, 1, 'built-in-baseline');
    await page.evaluate(() => {
      for (const type of ['sync.snapshot', 'sync.catchup', 'sync.ack']) window.__serverSource.sync({ type, table: 'records', op: 'INSERT', rowId: 'snapshot-joiner', row: { id: 'snapshot-joiner' } });
      window.__serverSource.sync({ type: 'sync.change', table: 'other_records', op: 'INSERT', rowId: 'wrong-table', row: { id: 'wrong-table' } });
      window.__serverSource.sync({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'invalid', row: null });
    });
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(2);
    await page.evaluate(() => window.__serverSource.sync({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'genuine-sync', row: { id: 'genuine-sync' } }));
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    await accept(page, 2, 'genuine-sync');
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual(['genuine-sync']);
  } finally { await page.close(); }
}, 60_000);

browserTest('late live callbacks cannot cross source or synchronous organization replacement, including before notification', async () => {
  const page = await mount();
  try {
    await accept(page, 0, 'private-a');
    await page.evaluate(() => { window.__serverSource.scope('organization-b', false); window.__serverSource.emit({ op: 'INSERT', rowId: 'old-family' }, 0); });
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(1);
    await page.evaluate(() => window.__serverSource.notify());
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await accept(page, 1, 'old-family');
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => window.__serverSource.source(2));
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'old-source' }, 1));
    expect(await page.evaluate(() => window.__serverSource.queries().length)).toBe(3);
    await accept(page, 2, 'old-source');
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

browserTest('a genuine insertion during initial baseline loading is ordinary initial data, never a fabricated new-record count', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'initial-arrival' }));
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    expect(await page.evaluate(() => window.__serverSource.aborted(0))).toBe(true);
    await accept(page, 1, 'initial-arrival');
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

browserTest('optional authoritative membership confirms off-page INSERTs without changing page rows and persists only across pagination', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__serverSource.prefetchEnabled(false); window.__serverSource.source(4);
      window.__serverSource.criteria({ search: 'Alpha', filters: [{ id: 'name', value: { op: 'contains', value: 'visible' } }], sorting: [{ id: 'name', desc: true }] }); });
    await page.waitForFunction(() => window.__serverSource.queries().length === 2);
    await accept(page, 1, 'baseline');
    await page.evaluate(() => window.__serverSource.page(1));
    await page.waitForFunction(() => window.__serverSource.queries().length === 3);
    await accept(page, 2, 'later-page');
    await page.evaluate(() => { window.__serverSource.emit({ op: 'INSERT', rowId: 'above-page' }); window.__serverSource.emit({ op: 'INSERT', rowId: 'above-page' }); });
    await page.waitForFunction(() => window.__serverSource.confirmations().length === 1);
    const lookup = (await page.evaluate(() => window.__serverSource.confirmations()))[0]!;
    expect(lookup.rowIds).toEqual(['above-page']);
    expect(lookup.query).toMatchObject({ search: 'Alpha', searchFields: ['name'], filters: [{ id: 'name', value: { op: 'contains', value: 'visible' } }],
      sorting: [{ id: 'name', desc: true }], pagination: { pageIndex: 1, pageSize: 2 } });
    await page.evaluate(() => window.__serverSource.confirm(0, ['above-page']));
    await page.waitForFunction(() => window.__serverSource.state().confirmedLiveInsertedRowIds.length === 1);
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual(['above-page']);
    expect(await page.evaluate(() => window.__serverSource.state().data.map(row => row.id))).toEqual(['later-page']);
    expect(await page.evaluate(() => window.__serverSource.state().liveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => window.__serverSource.page(2));
    await page.waitForFunction(() => window.__serverSource.queries().some(query => query.pagination.pageIndex === 2));
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual(['above-page']);
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'during-navigation' }));
    await page.waitForFunction(() => window.__serverSource.confirmations().length === 2);
    await page.evaluate(() => window.__serverSource.confirm(1, ['during-navigation']));
    await page.waitForFunction(() => window.__serverSource.state().confirmedLiveInsertedRowIds.length === 2);
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual(['above-page', 'during-navigation']);
    await page.evaluate(() => window.__serverSource.pageSize(3));
    await page.waitForFunction(() => window.__serverSource.state().confirmedLiveInsertedRowIds.length === 0);
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

browserTest('membership UPDATE revalidates, DELETE wins late lookup receipts, and reveal retires transport that ignores abort', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__serverSource.prefetchEnabled(false); window.__serverSource.source(4); });
    await page.waitForFunction(() => window.__serverSource.queries().length === 2); await accept(page, 1, 'baseline');
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'new' }));
    await page.waitForFunction(() => window.__serverSource.confirmations().length === 1);
    await page.evaluate(() => { window.__serverSource.emit({ op: 'UPDATE', rowId: 'new' }); window.__serverSource.confirm(0, ['new']); });
    await page.waitForFunction(() => window.__serverSource.confirmations().length === 2);
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => window.__serverSource.confirm(1, ['new']));
    await page.waitForFunction(() => window.__serverSource.state().confirmedLiveInsertedRowIds.length === 1);
    await page.evaluate(() => window.__serverSource.emit({ op: 'UPDATE', rowId: 'new' }));
    await page.waitForFunction(() => window.__serverSource.confirmations().length === 3);
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => { window.__serverSource.emit({ op: 'DELETE', rowId: 'new' }); window.__serverSource.confirm(2, ['new']); });
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'later' }));
    await page.waitForFunction(() => window.__serverSource.confirmations().length === 4);
    await page.evaluate(() => window.__serverSource.clearLiveInsertions());
    expect((await page.evaluate(() => window.__serverSource.confirmations()))[3]!.aborted).toBe(true);
    await page.evaluate(() => window.__serverSource.confirm(3, ['later']));
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

browserTest('disabled, denied, replaced and initially-loading membership never invent counts or disturb foreground errors', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__serverSource.prefetchEnabled(false); window.__serverSource.source(4); window.__serverSource.confirmEnabled(false); });
    await page.waitForFunction(() => window.__serverSource.queries().length === 2); await accept(page, 1, 'baseline');
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'disabled' }));
    expect(await page.evaluate(() => window.__serverSource.confirmations().length)).toBe(0);
    await page.evaluate(() => window.__serverSource.confirmEnabled(true));
    await page.locator('main[data-confirm-enabled="true"]').waitFor();
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'denied' }));
    await page.waitForFunction(() => window.__serverSource.confirmations().length === 1);
    await page.evaluate(() => window.__serverSource.rejectConfirmation(0));
    await page.waitForFunction(() => window.__serverSource.events().length > 0);
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual([]);
    expect(await page.evaluate(() => window.__serverSource.state().error)).toBeNull();
    expect(await page.locator('body').textContent()).not.toContain('PRIVATE_MEMBERSHIP_ERROR');
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'retired' }));
    await page.waitForFunction(() => window.__serverSource.confirmations().length === 2);
    await page.evaluate(() => window.__serverSource.search('replacement'));
    await page.waitForFunction(() => window.__serverSource.confirmations()[1]!.aborted);
    await page.evaluate(() => window.__serverSource.confirm(1, ['retired']));
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual([]);
    await page.evaluate(() => window.__serverSource.emit({ op: 'INSERT', rowId: 'initial-new-query' }));
    expect(await page.evaluate(() => window.__serverSource.confirmations().length)).toBe(2);
  } finally { await page.close(); }
}, 60_000);

browserTest('built-in membership uses captured search and PK filters on a bounded read without adding lookup rows to the accepted page', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__serverSource.prefetchEnabled(false); window.__serverSource.source(3); window.__serverSource.primaryKey('id');
      window.__serverSource.criteria({ search: 'Alpha', filters: [{ id: 'name', value: { op: 'contains', value: 'visible' } }], sorting: [{ id: 'name', desc: true }] }); });
    await page.waitForFunction(() => window.__serverSource.queries().length === 2); await accept(page, 1, 'baseline');
    await page.evaluate(() => window.__serverSource.page(1));
    await page.waitForFunction(() => window.__serverSource.queries().length === 3); await accept(page, 2, 'later-page');
    await page.evaluate(() => window.__serverSource.sync({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'above', row: { id: 'above', name: 'Alpha visible newest' } }));
    await page.waitForFunction(() => window.__serverSource.queries().some(query => query.path?.includes('filter=id%3Ain%3Aabove')));
    const queries = await page.evaluate(() => window.__serverSource.queries());
    const index = queries.findIndex(query => query.path?.includes('filter=id%3Ain%3Aabove'));
    const params = new URL(queries[index]!.path!, 'http://fixture.invalid').searchParams;
    expect(params.get('search')).toBe('Alpha'); expect(params.getAll('searchField')).toEqual(['name']);
    expect(params.getAll('filter')).toEqual(['id:in:above', 'name:contains:visible']); expect(params.getAll('sort')).toEqual(['name:desc']);
    expect(params.get('limit')).toBe('1'); expect(params.get('offset')).toBe('0');
    await page.evaluate(index => window.__serverSource.resolve(index, [{ id: 'above', name: 'Alpha visible newest' }]), index);
    await page.waitForFunction(() => window.__serverSource.state().confirmedLiveInsertedRowIds.length === 1);
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual(['above']);
    expect(await page.evaluate(() => window.__serverSource.state().data.map(row => row.id))).toEqual(['later-page']);
    expect(await page.getByText('Alpha visible newest', { exact: true }).count()).toBe(0);
    await page.evaluate(() => window.__serverSource.sync({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'pk-denied', row: { id: 'pk-denied' } }));
    await page.waitForFunction(() => window.__serverSource.queries().some(query => query.path?.includes('filter=id%3Ain%3Apk-denied')));
    const deniedIndex = (await page.evaluate(() => window.__serverSource.queries())).findIndex(query => query.path?.includes('filter=id%3Ain%3Apk-denied'));
    await page.evaluate(index => window.__serverSource.reject(index), deniedIndex);
    await page.waitForFunction(() => window.__serverSource.events().length > 0);
    expect(await page.evaluate(() => window.__serverSource.state().confirmedLiveInsertedRowIds)).toEqual(['above']);
    expect(await page.evaluate(() => window.__serverSource.state().data.map(row => row.id))).toEqual(['later-page']);
    expect(await page.evaluate(() => window.__serverSource.state().error)).toBeNull();
    expect(await page.locator('body').textContent()).not.toContain('SYNTHETIC_PRIVATE_SOURCE_ERROR');
  } finally { await page.close(); }
}, 60_000);
