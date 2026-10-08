/** Styled public DataTable qualification of sort-aware new-record counts and honest navigation affordances. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', styles = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratchRoot = process.env.ZERO_TEST_SCRATCH_ROOT ?? '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(join(scratchRoot, 'table-new-navigation-'));
  try {
    const output = join(directory, 'fixture.js');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'data-table-new-records-navigation.browser-fixture.tsx'),
      '--target=browser', '--format=iife', '--outfile', output], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`New-record navigation fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
    styles = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
const item = (id: string, rank: number, name = `Alpha ${id}`) => ({ id, rank, name });
async function open(options: { desc?: boolean; page?: number; scroll?: boolean; loading?: boolean; server?: boolean; reduced?: boolean } = {}) {
  const page = await lease!.browser.newPage({ viewport: { width: 900, height: 750 }, reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(7_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><html data-desc="${options.desc !== false}" data-page="${options.page ?? 0}" data-scroll="${Boolean(options.scroll)}" data-loading="${Boolean(options.loading)}" data-server="${Boolean(options.server)}"><body style="margin:0;padding:12px"><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: styles }); await page.addScriptTag({ content: bundle });
  await page.locator('[data-slot="data-table-grid"]').waitFor();
  return { page, errors };
}
async function settled(page: Page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="data-table-skeleton-body"]')
    && !document.querySelector('[data-slot="data-table-skeleton-crossfade"]') && !document.querySelector('[data-table-leaving]')
    && [...document.querySelectorAll('[data-row-id]')].every(row => row.getAnimations().length === 0));
}
async function ids(page: Page) { return page.locator('tr[data-row-id]:not([data-table-leaving])').evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id'))); }
async function close(page: Page, errors: string[]) {
  try { expect(errors).toEqual([]); expect(await page.evaluate(() => window.__newRecordNavigation.events())).toEqual([]); }
  finally { await page.close(); }
}
const pill = '[data-slot="data-table-new-records"]';
async function expectPassive(page: Page, count: number) {
  const status = page.getByRole('status', { name: `${count} new records`, exact: true });
  await status.waitFor();
  expect(await status.getAttribute('data-actionable')).toBe('false');
  expect(await status.locator('svg').count()).toBe(0);
  expect(await page.locator(`${pill}[data-actionable="true"]`).count()).toBe(0);
}

browserTest('descending genuine top arrivals make the later-page count actionable and reveal the first page', async () => {
  const { page, errors } = await open({ page: 1 });
  try {
    await settled(page); expect(await ids(page)).toEqual(['r9', 'r8', 'r7']);
    await page.evaluate(() => { window.__newRecordNavigation.save('r9'); window.__newRecordNavigation.insert([{ id: 'new-top', rank: 99, name: 'Alpha newest' }]); });
    const action = page.getByRole('button', { name: 'Reveal 1 new records', exact: true }); await action.waitFor();
    expect(await action.getAttribute('data-actionable')).toBe('true');
    expect(await ids(page)).toEqual(['r9', 'r8', 'r7']);
    expect(await page.evaluate(() => window.__newRecordNavigation.same('r9'))).toBe(true);
    // Complete collections retain the reader's navigable held-excluded view;
    // the truthful total includes the pending row, released on explicit reveal.
    expect(await page.getByRole('status', { name: 'Showing 4-6 of 13', exact: true }).count()).toBe(1);
    expect(await page.getByRole('group', { name: 'Page 2 of 4', exact: true }).count()).toBe(1);
    await action.click(); await page.locator('[data-row-id="new-top"]').waitFor(); await settled(page);
    expect(await ids(page)).toEqual(['new-top', 'r12', 'r11']);
    expect(await page.evaluate(() => window.__newRecordNavigation.state().pagination?.pageIndex)).toBe(0);
    expect(await page.getByRole('group', { name: 'Page 1 of 5', exact: true }).count()).toBe(1);
    expect(await page.locator(pill).count()).toBe(0);
  } finally { await close(page, errors); }
}, 30_000);

browserTest('ascending append and middle arrivals stay passive and do not force the reader to page one', async () => {
  const { page, errors } = await open({ desc: false, page: 1 });
  try {
    await settled(page); expect(await ids(page)).toEqual(['r4', 'r5', 'r6']);
    await page.evaluate(() => { window.__newRecordNavigation.save('r4'); window.__newRecordNavigation.insert([{ id: 'new-end', rank: 99, name: 'Alpha appended' }]); });
    await expectPassive(page, 1); expect(await ids(page)).toEqual(['r4', 'r5', 'r6']);
    await page.evaluate(() => window.__newRecordNavigation.insert([{ id: 'new-middle', rank: 5.5, name: 'Alpha middle' }]));
    await expectPassive(page, 2); await settled(page);
    expect(await ids(page)).toEqual(['r4', 'r5', 'new-middle']);
    expect(await page.evaluate(() => window.__newRecordNavigation.same('r4'))).toBe(true);
    expect(await page.evaluate(() => window.__newRecordNavigation.state().pagination?.pageIndex)).toBe(1);
    expect(await page.getByRole('group', { name: 'Page 2 of 5', exact: true }).count()).toBe(1);
    await page.evaluate(() => window.__newRecordNavigation.change({ sorting: [{ id: 'rank', desc: true }] }));
    await settled(page); expect(await page.locator(pill).count()).toBe(0);
  } finally { await close(page, errors); }
}, 30_000);

browserTest('mixed arrivals offer return-to-top only while the actual sorted leading row is new', async () => {
  const { page, errors } = await open({ page: 1 });
  try {
    await settled(page);
    await page.evaluate(() => window.__newRecordNavigation.insert([{ id: 'new-bottom', rank: 0, name: 'Alpha bottom' }]));
    await expectPassive(page, 1);
    await page.evaluate(() => window.__newRecordNavigation.insert([{ id: 'new-top', rank: 99, name: 'Alpha top' }]));
    await page.getByRole('button', { name: 'Reveal 2 new records', exact: true }).waitFor();
    await page.evaluate(() => window.__newRecordNavigation.update('new-top', { rank: 4.5 }));
    await expectPassive(page, 2);
    // An ordinary existing row moving to the top is not an incoming record.
    await page.evaluate(() => window.__newRecordNavigation.update('r12', { rank: 120 }));
    await expectPassive(page, 2); expect(await page.evaluate(() => window.__newRecordNavigation.state().pagination?.pageIndex)).toBe(1);
    await page.evaluate(() => window.__newRecordNavigation.insert([{ id: 'new-leading', rank: 999, name: 'Alpha genuine leader' }]));
    const action = page.getByRole('button', { name: 'Reveal 3 new records', exact: true }); await action.waitFor();
    await action.click(); await page.locator('[data-row-id="new-leading"]').waitFor(); await settled(page);
    expect((await ids(page))[0]).toBe('new-leading'); expect(await page.locator(pill).count()).toBe(0);
  } finally { await close(page, errors); }
}, 30_000);

browserTest('scroll-held top arrivals reveal smoothly while non-top arrivals keep a passive count', async () => {
  const { page, errors } = await open({ scroll: true });
  try {
    await settled(page);
    await page.locator('[data-navigation-scroll-owner]').evaluate(owner => { owner.scrollTop = 140; owner.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => window.__newRecordNavigation.insert([{ id: 'new-tail', rank: 0, name: 'Alpha tail' }]));
    await expectPassive(page, 1);
    expect(await page.locator('[data-navigation-scroll-owner]').evaluate(owner => owner.scrollTop)).toBeGreaterThan(100);
    await page.evaluate(() => window.__newRecordNavigation.insert([{ id: 'new-top', rank: 99, name: 'Alpha new top' }]));
    const action = page.getByRole('button', { name: 'Reveal 2 new records', exact: true }); await action.waitFor();
    expect(await page.locator('[data-row-id="new-top"]').count()).toBe(0);
    // Invoke the real action without test automation scrolling its footer into view first.
    await action.evaluate(button => (button as HTMLButtonElement).click());
    await page.waitForFunction(() => (document.querySelector('[data-navigation-scroll-owner]') as HTMLElement).scrollTop < 1);
    await settled(page); expect((await ids(page))[0]).toBe('new-top'); expect(await page.locator(pill).count()).toBe(0);
  } finally { await close(page, errors); }
}, 30_000);

browserTest('initial data resolution and ordinary value changes never invent new records', async () => {
  const { page, errors } = await open({ loading: true, reduced: true });
  try {
    expect(await page.locator(pill).count()).toBe(0);
    await page.evaluate(() => window.__newRecordNavigation.initial()); await settled(page);
    expect(await page.locator(pill).count()).toBe(0);
    await page.evaluate(() => window.__newRecordNavigation.change({ pagination: { pageIndex: 1, pageSize: 3 } })); await settled(page);
    await page.evaluate(() => window.__newRecordNavigation.update('r6', { rank: 100, name: 'Alpha existing updated' })); await settled(page);
    expect(await page.locator(pill).count()).toBe(0);
    await page.evaluate(() => window.__newRecordNavigation.insert([{ id: 'not-matching', rank: 0, name: 'Beta new' }]));
    await expectPassive(page, 1);
    await page.getByRole('searchbox', { name: 'Search arrival records', exact: true }).fill('Alpha');
    await page.waitForFunction(() => window.__newRecordNavigation.state().globalFilter === 'Alpha');
    await settled(page); expect(await page.locator(pill).count()).toBe(0);
  } finally { await close(page, errors); }
}, 30_000);

browserTest('ready refresh completion acknowledges a leading arrival already visible at the top', async () => {
  const { page, errors } = await open({ reduced: true });
  try {
    await settled(page);
    await page.evaluate(() => { window.__newRecordNavigation.loading(true);
      window.__newRecordNavigation.insert([{ id: 'new-ready', rank: 99, name: 'Alpha refreshing arrival' }]); });
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    await page.evaluate(() => window.__newRecordNavigation.loading(false));
    await page.locator('[data-row-id="new-ready"]').waitFor(); await settled(page);
    expect((await ids(page))[0]).toBe('new-ready'); expect(await page.locator(pill).count()).toBe(0);
  } finally { await close(page, errors); }
}, 30_000);

type Read = ReturnType<Window['__newRecordNavigation']['reads']>[number];
async function pending(page: Page, after: number, kind: 'page' | 'membership' | 'leading', search?: string) {
  const matches = (read: Read) => !read.aborted && (search === undefined || read.search === search)
    && (kind === 'page' ? read.includeTotal === 'true'
      : kind === 'membership' ? read.includeTotal === null && read.filters.some(filter => filter.startsWith('id:in:'))
        : read.includeTotal === null && read.limit === 1 && read.offset === 0 && !read.filters.some(filter => filter.startsWith('id:in:')));
  await page.waitForFunction(({ after, kind, search }) => window.__newRecordNavigation.reads().some((read, index) =>
    index >= after && !read.aborted && (search === undefined || read.search === search)
    && (kind === 'page' ? read.includeTotal === 'true'
      : kind === 'membership' ? read.includeTotal === null && read.filters.some(filter => filter.startsWith('id:in:'))
        : read.includeTotal === null && read.limit === 1 && read.offset === 0 && !read.filters.some(filter => filter.startsWith('id:in:')))), { after, kind, search });
  return (await page.evaluate(() => window.__newRecordNavigation.reads())).findIndex((read, index) => index >= after && matches(read));
}
async function accept(page: Page, index: number, rows: ReturnType<typeof item>[], total?: number) {
  await page.evaluate(({ index, rows, total }) => window.__newRecordNavigation.accept(index, rows, total), { index, rows, total });
}

browserTest('server navigation remains passive until the same-query authoritative first row is a genuine insertion', async () => {
  const { page, errors } = await open({ server: true, reduced: true });
  try {
    const first = await pending(page, 0, 'page'); await accept(page, first, [item('r12', 12), item('r11', 11), item('r10', 10)], 12); await settled(page);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    const second = await pending(page, first + 1, 'page'); await accept(page, second, [item('r9', 9), item('r8', 8), item('r7', 7)], 12); await settled(page);
    const before = (await page.evaluate(() => window.__newRecordNavigation.reads())).length;
    await page.evaluate(() => window.__newRecordNavigation.emit({ op: 'INSERT', rowId: 'new-middle' }));
    const refresh = await pending(page, before, 'page'); await accept(page, refresh, [item('r9', 9), item('r8', 8), item('r7', 7)], 13);
    const membership = await pending(page, before, 'membership'); await accept(page, membership, [item('new-middle', 8.5)]);
    await expectPassive(page, 1);
    const leading = await pending(page, before, 'leading'); await accept(page, leading, [item('r12', 12)]);
    await expectPassive(page, 1);
    expect(await page.evaluate(() => window.__newRecordNavigation.state().pagination?.pageIndex)).toBe(1);
    const beforeUpdate = (await page.evaluate(() => window.__newRecordNavigation.reads())).length;
    await page.evaluate(() => window.__newRecordNavigation.emit({ op: 'UPDATE', rowId: 'new-middle' }));
    expect(await page.locator(`${pill}[data-actionable="true"]`).count()).toBe(0);
    const updatedPage = await pending(page, beforeUpdate, 'page'); await accept(page, updatedPage, [item('r9', 9), item('r8', 8), item('r7', 7)], 13);
    const updatedMembership = await pending(page, beforeUpdate, 'membership'); await accept(page, updatedMembership, [item('new-middle', 99)]);
    const updatedLeading = await pending(page, beforeUpdate, 'leading'); await accept(page, updatedLeading, [item('new-middle', 99)]);
    const action = page.getByRole('button', { name: 'Reveal 1 new records', exact: true }); await action.waitFor(); await action.click();
    const revealed = await pending(page, updatedLeading + 1, 'page'); await accept(page, revealed, [item('new-middle', 99), item('r12', 12), item('r11', 11)], 13);
    await settled(page); expect((await ids(page))[0]).toBe('new-middle'); expect(await page.locator(pill).count()).toBe(0);
  } finally { await close(page, errors); }
}, 30_000);

browserTest('server leading proof from retired criteria cannot add an actionable arrow to the next query', async () => {
  const { page, errors } = await open({ server: true, reduced: true });
  try {
    const first = await pending(page, 0, 'page'); await accept(page, first, [item('r12', 12), item('r11', 11), item('r10', 10)], 12); await settled(page);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    const second = await pending(page, first + 1, 'page'); await accept(page, second, [item('r9', 9), item('r8', 8), item('r7', 7)], 12); await settled(page);
    const before = (await page.evaluate(() => window.__newRecordNavigation.reads())).length;
    await page.evaluate(() => window.__newRecordNavigation.emit({ op: 'INSERT', rowId: 'old-new' }));
    const refresh = await pending(page, before, 'page'); await accept(page, refresh, [item('r9', 9), item('r8', 8), item('r7', 7)], 13);
    const membership = await pending(page, before, 'membership'); await accept(page, membership, [item('old-new', 99)]);
    const leading = await pending(page, before, 'leading'); await expectPassive(page, 1);
    await page.getByRole('searchbox', { name: 'Search arrival records', exact: true }).fill('Beta');
    const nextQuery = await pending(page, leading + 1, 'page', 'Beta'); await accept(page, nextQuery, [item('beta', 1, 'Beta result')], 1); await settled(page);
    expect((await page.evaluate(() => window.__newRecordNavigation.reads()))[leading]!.aborted).toBe(true);
    await accept(page, leading, [item('old-new', 99)]);
    expect(await page.locator(pill).count()).toBe(0); expect(await ids(page)).toEqual(['beta']);
    expect(await page.locator('[data-row-id="old-new"]').count()).toBe(0);
  } finally { await close(page, errors); }
}, 30_000);
