/** Styled actual-grid off-page INSERT acceptance; membership-only stability is distinct from ordinary offset refetch consistency. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', styles = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'table-server-pill-'));
  try {
    const output = join(directory, 'fixture.js');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'data-table-server-insert-pill.browser-fixture.tsx'),
      '--target=browser', '--format=iife', '--outfile', output], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Server pill fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
    styles = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
const row = (id: string, rank: number) => ({ id, name: `Alpha ${id}`, rank });
async function settled(page: Page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="data-table-skeleton-body"]')
    && !document.querySelector('[data-slot="data-table-skeleton-crossfade"]') && !document.querySelector('[data-table-leaving]')
    && [...document.querySelectorAll('[data-row-id]')].every(row => row.getAnimations().length === 0));
}
async function ids(page: Page) { return page.locator('tr[data-row-id]:not([data-table-leaving])').evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id'))); }

browserTest('actual later-page new-record pill counts authoritative off-page INSERT once and reveals a clean first-page result', async () => {
  const page = await lease!.browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: 'no-preference' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<!doctype html><html><body style="margin:0;padding:12px"><div id="root"></div></body></html>');
    await page.addStyleTag({ content: styles }); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => window.__serverInsertPill.reads().length === 1);
    await page.evaluate(rows => window.__serverInsertPill.accept(0, rows, true, 4), [row('r1', 4), row('r2', 3)]);
    await page.locator('[data-row-id="r1"]').waitFor(); await settled(page);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.waitForFunction(() => window.__serverInsertPill.reads().length === 2);
    await page.evaluate(rows => window.__serverInsertPill.accept(1, rows, false, 4), [row('r3', 2), row('r4', 1)]);
    await page.locator('[data-row-id="r3"]').waitFor(); await settled(page);
    expect(await ids(page)).toEqual(['r3', 'r4']); await page.evaluate(() => window.__serverInsertPill.saveRows());
    await page.evaluate(() => { window.__serverInsertPill.emit({ op: 'INSERT', rowId: 'new' }); window.__serverInsertPill.emit({ op: 'INSERT', rowId: 'new' }); });
    await page.waitForFunction(() => window.__serverInsertPill.lookups().length === 1);
    expect((await page.evaluate(() => window.__serverInsertPill.lookups()))[0]!.ids).toEqual(['new']);
    await page.evaluate(() => window.__serverInsertPill.confirm(0, ['new']));
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    // Only the membership read resolves here. A normal accepted offset refetch may
    // shift membership; this test does not claim a pinned-page consistency model.
    expect(await ids(page)).toEqual(['r3', 'r4']); expect(await page.evaluate(() => window.__serverInsertPill.sameRows())).toBe(true);
    expect(await page.locator('[data-row-id="new"]').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Reveal 2 new records', exact: true }).count()).toBe(0);
    await page.evaluate(() => window.__serverInsertPill.emit({ op: 'UPDATE', rowId: 'new' }));
    await page.waitForFunction(() => window.__serverInsertPill.lookups().length === 2);
    expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0);
    await page.evaluate(() => window.__serverInsertPill.confirm(1, ['new']));
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    expect(await ids(page)).toEqual(['r3', 'r4']); expect(await page.evaluate(() => window.__serverInsertPill.sameRows())).toBe(true);
    const pendingLater = (await page.evaluate(() => window.__serverInsertPill.reads())).map((read, index) => ({ ...read, index }))
      .filter(read => read.index > 1 && read.query.pagination.pageIndex === 1);
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).click();
    await page.waitForFunction(() => window.__serverInsertPill.reads().some((read, index) => index > 1 && read.query.pagination.pageIndex === 0));
    const firstIndex = (await page.evaluate(() => window.__serverInsertPill.reads())).findIndex((read, index) => index > 1 && read.query.pagination.pageIndex === 0);
    await page.evaluate(({ index, rows }) => window.__serverInsertPill.accept(index, rows, true, 5), { index: firstIndex, rows: [row('new', 5), row('r1', 4)] });
    await page.locator('[data-row-id="new"]').waitFor(); await settled(page);
    expect(await ids(page)).toEqual(['new', 'r1']); expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0);
    expect(await page.getByRole('group', { name: 'Page 1 of 3', exact: true }).count()).toBe(1);
    for (const pending of pendingLater) {
      expect((await page.evaluate(() => window.__serverInsertPill.reads()))[pending.index]!.aborted).toBe(true);
      await page.evaluate(index => window.__serverInsertPill.accept(index, [{ id: 'late', name: 'Late old page', rank: 9 }], false, 5), pending.index);
    }
    expect(await ids(page)).toEqual(['new', 'r1']); expect(await page.locator('table').count()).toBe(1); expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
