/** Styled integrated DataTable acceptance for genuine local additions, semantic rows, search and accepted editor lifecycle. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises'; // Bun has no directory lifecycle API.
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import { OBS_CODES } from '../../observability/codes';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', styles = '';
const failures = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'table-live-motion-'));
  try {
    const output = join(directory, 'fixture.js');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'data-table-live-motion.browser-fixture.tsx'),
      '--target=browser', '--format=iife', '--outfile', output], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Integrated table fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
    styles = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function open(options: { loading?: boolean; scroll?: boolean; dark?: boolean; width?: number; collection?: boolean; pauseInitialRows?: boolean } = {}) {
  const page = await lease!.browser.newPage({ viewport: { width: options.width ?? 900, height: 750 }, reducedMotion: 'no-preference' });
  page.setDefaultTimeout(5_000);
  const messages: string[] = []; failures.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent(`<!doctype html><html data-initial-loading="${Boolean(options.loading)}" data-unpaginated="${Boolean(options.scroll)}" data-collection="${Boolean(options.collection)}" class="${options.dark ? 'dark' : ''}"><body style="margin:0;padding:12px"><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: styles });
  if (options.pauseInitialRows) await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function(keyframes, timing) {
      const animation = original.call(this, keyframes, timing);
      if (this instanceof HTMLTableRowElement && this.hasAttribute('data-row-id')) animation.pause();
      return animation;
    };
    (window as unknown as { __restoreInitialMotion(): void }).__restoreInitialMotion = () => {
      Element.prototype.animate = original;
      for (const row of document.querySelectorAll('[data-row-id]')) for (const animation of row.getAnimations()) animation.play();
    };
  });
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-slot="data-table-grid"]').waitFor(); return page;
}
async function close(page: Page) { try { expect(failures.get(page)).toEqual([]); } finally { await page.close(); } }
async function settled(page: Page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="data-table-skeleton-body"]')
    && !document.querySelector('[data-slot="data-table-skeleton-overlay"]') && !document.querySelector('[data-table-leaving]')
    && [...document.querySelectorAll('[data-row-id]')].every(row => row.getAnimations().length === 0));
}
async function ids(page: Page) { return page.locator('tr[data-row-id]:not([data-table-leaving])').evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id'))); }

browserTest('one real native grid receives initial motion and retained row nodes survive a sorted insertion', async () => {
  const page = await open();
  try {
    expect(await page.locator('[data-slot="data-table-grid"]').count()).toBe(1);
    expect(await page.getByRole('table').count()).toBe(1);
    await settled(page); await page.evaluate(() => window.__liveMotion.save('r1'));
    await page.evaluate(() => window.__liveMotion.insert({ id: 'new', name: 'Alpha newest', rank: 999 }));
    await page.locator('[data-row-id="new"]').waitFor();
    expect((await ids(page)).slice(0, 3)).toEqual(['new', 'r1', 'r2']);
    expect(await page.evaluate(() => window.__liveMotion.same('r1'))).toBe(true);
    expect(await page.locator('[data-row-id="new"]').getAttribute('data-table-fresh')).toBe('');
    expect(await page.locator('[data-row-id="new"] td').first().evaluate(cell => ({ name: getComputedStyle(cell, '::before').animationName,
      duration: getComputedStyle(cell, '::before').animationDuration }))).toEqual({ name: 'zero-table-fresh', duration: '2s' });
    expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0);
    await settled(page); expect(await page.locator('table').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('an existing sort-key update moves the same native row and flashes changed cells without inventing an insertion', async () => {
  const page = await open();
  try {
    await settled(page); await page.evaluate(() => window.__liveMotion.save('r5'));
    await page.evaluate(() => window.__liveMotion.update('r5', { rank: 100, name: 'Alpha moved' }));
    await page.getByRole('button', { name: 'Alpha moved', exact: true }).waitFor();
    expect((await ids(page))[0]).toBe('r5'); expect(await page.evaluate(() => window.__liveMotion.same('r5'))).toBe(true);
    const flash = page.locator('[data-row-id="r5"] [data-slot="data-table-cell-flash"]').first(); await flash.waitFor({ state: 'attached' });
    expect(await flash.evaluate(element => ({ duration: getComputedStyle(element).animationDuration,
      frames: (element.getAnimations()[0]!.effect as KeyframeEffect).getKeyframes().map(frame => [frame.offset, Number(frame.opacity)]) })))
      .toEqual({ duration: '2s', frames: [[0, 1], [.35, 1], [1, 0]] });
    expect(await page.locator('[data-row-id="r5"]').getAttribute('data-table-fresh')).toBeNull();
    expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0); await settled(page);
  } finally { await close(page); }
}, 30_000);

browserTest('initial placeholder crossfade is independently opaque while actual incoming rows use 525ms and 45ms stagger', async () => {
  const page = await open({ pauseInitialRows: true });
  try {
    await page.locator('[data-slot="data-table-skeleton-crossfade"]').waitFor();
    const receipt = await page.evaluate(() => {
      const copy = document.querySelector('[data-slot="data-table-skeleton-crossfade"]')!;
      const rows = [...document.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]')].slice(0, 2);
      const placeholders = [...copy.querySelectorAll('tbody > tr')].slice(0, 2);
      const details = rows.map((row, index) => {
        const incoming = row.getAnimations()[0]!;
        const overlay = placeholders[index]!.querySelector('[data-slot="data-table-skeleton-overlay"]')!;
        const outgoing = overlay.getAnimations()[0]!;
        incoming.pause(); incoming.currentTime = index * 45;
        outgoing.pause(); outgoing.currentTime = index * 45;
        const start = { row: Number(getComputedStyle(row).opacity), placeholder: Number(getComputedStyle(overlay).opacity) };
        incoming.currentTime = 175 + index * 45; outgoing.currentTime = 175 + index * 45;
        const middle = { row: Number(getComputedStyle(row).opacity), placeholder: Number(getComputedStyle(overlay).opacity) };
        const timings = { incoming: incoming.effect!.getTiming().duration, incomingDelay: incoming.effect!.getTiming().delay,
          outgoing: outgoing.effect!.getTiming().duration, outgoingDelay: outgoing.effect!.getTiming().delay };
        incoming.play(); outgoing.play();
        return { start, middle, timings, separate: !overlay.closest('[data-row-id]') };
      });
      return { hidden: copy.getAttribute('aria-hidden'), recordCopies: copy.querySelectorAll('[data-row-id]').length, details };
    });
    await page.evaluate(() => (window as unknown as { __restoreInitialMotion(): void }).__restoreInitialMotion());
    expect(receipt.hidden).toBe('true'); expect(receipt.recordCopies).toBe(0);
    expect(receipt.details.map(detail => detail.timings)).toEqual([
      { incoming: 525, incomingDelay: 0, outgoing: 350, outgoingDelay: 0 },
      { incoming: 525, incomingDelay: 45, outgoing: 350, outgoingDelay: 45 },
    ]);
    expect(receipt.details.every(detail => detail.separate && detail.start.row === 0 && detail.start.placeholder === 1)).toBe(true);
    expect(receipt.details.every(detail => detail.middle.row > 0 && detail.middle.placeholder > 0)).toBe(true);
    await settled(page); expect(await page.locator('[data-slot="data-table-skeleton-crossfade"]').count()).toBe(0);
    expect(await page.getByRole('table').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('actual collection source ignores snapshot arrivals, admits late INSERT evidence and fences it before scope notifications', async () => {
  const page = await open({ collection: true });
  try {
    await settled(page); await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.locator('[data-row-id="r11"]').waitFor(); await settled(page);
    await page.evaluate(() => {
      window.__liveMotion.collectionInsert({ id: 'snapshot-joined', name: 'Snapshot joined record', rank: 999 });
      window.__liveMotion.sync({ type: 'sync.snapshot', table: 'records', rows: [{ id: 'snapshot-joined' }] });
    });
    await settled(page); expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0);
    await page.evaluate(() => window.__liveMotion.collectionInsert({ id: 'inserted', name: 'Confirmed inserted record', rank: 1000 }));
    await settled(page); expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0);
    await page.evaluate(() => window.__liveMotion.sync({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'inserted', row: { id: 'inserted', name: 'Confirmed inserted record', rank: 1000 } }));
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    await page.evaluate(() => {
      window.__liveMotion.scope('organization-b', false);
      window.__liveMotion.sync({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'snapshot-joined', row: { id: 'snapshot-joined', name: 'Retired scope receipt', rank: 999 } });
    });
    expect(await page.getByRole('button', { name: 'Reveal 2 new records', exact: true }).count()).toBe(0);
    await page.evaluate(() => window.__liveMotion.notify());
    await page.locator('[data-row-id="new-scope"]').waitFor();
    expect(await page.locator('[data-row-id="r11"]').count()).toBe(0); expect(await page.locator('[data-table-leaving]').count()).toBe(0);
    await settled(page); expect(await ids(page)).toEqual(['new-scope']);
    expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('genuine sorted additions above a later page are held without shifting its selected native rows', async () => {
  const page = await open();
  try {
    await settled(page); await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.locator('[data-row-id="r11"]').waitFor(); await settled(page);
    const before = await ids(page); await page.evaluate(() => window.__liveMotion.save('r11'));
    await page.locator('[data-row-id="r11"]').getByRole('checkbox', { name: 'Select row', exact: true }).click();
    await page.evaluate(() => window.__liveMotion.insert({ id: 'new', name: 'Alpha newest', rank: 999 }));
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    expect(await ids(page)).toEqual(before); expect(await page.evaluate(() => window.__liveMotion.same('r11'))).toBe(true);
    expect(await page.locator('[data-row-id="r11"]').getByRole('checkbox', { name: 'Select row', exact: true }).getAttribute('aria-checked')).toBe('true');
    expect(await page.locator('[data-row-id="new"]').count()).toBe(0);
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).click();
    await page.locator('[data-row-id="new"]').waitFor(); await settled(page);
    expect((await ids(page)).slice(0, 2)).toEqual(['new', 'r1']);
    expect(await page.getByRole('group', { name: 'Page 1 of 4', exact: true }).count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('real scroll position holds local arrivals, then reveal returns to the top and shows fresh rows', async () => {
  const page = await open({ scroll: true });
  try {
    await settled(page);
    await page.locator('[data-fixture-owner]').evaluate(owner => { owner.scrollTop = 180; owner.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => window.__liveMotion.save('r10'));
    await page.evaluate(() => window.__liveMotion.insert({ id: 'new', name: 'Alpha newest', rank: 999 }));
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    expect(await page.locator('[data-row-id="new"]').count()).toBe(0); expect(await page.evaluate(() => window.__liveMotion.same('r10'))).toBe(true);
    // The bottom action would normally be reached by the reader; invoke its
    // actual DOM click without Playwright scrolling the owner back to it.
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await page.locator('[data-row-id="new"]').waitFor();
    await page.waitForFunction(() => (document.querySelector('[data-fixture-owner]') as HTMLElement).scrollTop < 1);
    expect((await ids(page))[0]).toBe('new'); await settled(page);
  } finally { await close(page); }
}, 30_000);

browserTest('debounced real search highlights plain text and does not count nonmatching arrivals or expose old query rows', async () => {
  const page = await open();
  try {
    await settled(page); await page.getByRole('searchbox', { name: 'Search live records' }).fill('Alpha');
    await page.waitForFunction(() => document.querySelector('[data-current-query]')?.textContent === 'Alpha').catch(async cause => {
      const receipt = await page.evaluate(() => ({ fixture: window.__liveMotion.snapshot(), query: document.querySelector('[data-current-query]')?.textContent,
        input: (document.querySelector('[role="searchbox"]') as HTMLInputElement)?.value }));
      throw new Error(`Search publication receipt: ${JSON.stringify(receipt)}`, { cause });
    });
    await settled(page);
    expect(await page.locator('[data-slot="data-table-search-match"]').count()).toBeGreaterThan(0);
    expect(await page.locator('tr[data-row-id]').allTextContents()).not.toContain('Beta record 02');
    await page.evaluate(() => window.__liveMotion.state({ pagination: { pageIndex: 1, pageSize: 10 } }));
    await settled(page);
    await page.evaluate(() => window.__liveMotion.insert({ id: 'unmatched', name: 'Beta unseen', rank: 999 }));
    await settled(page); expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0);
    await page.evaluate(() => window.__liveMotion.insert({ id: 'matching', name: 'Alpha newest', rank: 1000 }));
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    await page.getByRole('searchbox', { name: 'Search live records' }).fill('no-record-matches');
    await page.waitForFunction(() => document.querySelector('[data-current-query]')?.textContent === 'no-record-matches', undefined, { timeout: 5_000 });
    await page.locator('[data-slot="data-table-empty"]').waitFor();
    expect(await page.locator('[data-slot="data-table-empty"]').textContent()).toContain('No results.');
    expect(await page.getByRole('button', { name: 'Clear filters', exact: true }).isVisible()).toBe(true);
    await settled(page);
    expect(await ids(page)).toEqual([]); expect(await page.getByRole('button', { name: /Reveal \d+ new records/ }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('actual shared Skeleton uses 1400ms table pulse, 70ms row offsets and no animation under reduced motion', async () => {
  const page = await open({ loading: true });
  try {
    const observed = await page.locator('[data-slot="data-table-skeleton-body"] tr').evaluateAll(rows => rows.slice(0, 2).map(row => {
      const skeleton = row.querySelector('[data-slot="data-table-skeleton"]')!;
      const style = getComputedStyle(skeleton), animation = skeleton.getAnimations()[0];
      return { name: style.animationName, duration: style.animationDuration, delay: style.animationDelay,
        opacities: (animation?.effect as KeyframeEffect)?.getKeyframes().map(frame => Number(frame.opacity)) };
    }));
    expect(observed).toEqual([
      { name: 'zero-table-skeleton', duration: '1.4s', delay: '0s', opacities: [.5, 1, .5] },
      { name: 'zero-table-skeleton', duration: '1.4s', delay: '0.07s', opacities: [.5, 1, .5] },
    ]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.locator('[data-slot="data-table-skeleton"]').first().evaluate(skeleton => ({ name: getComputedStyle(skeleton).animationName, animations: skeleton.getAnimations().length }))).toEqual({ name: 'none', animations: 0 });
  } finally { await close(page); }
}, 30_000);

browserTest('source-identity replacement removes old native rows immediately and retires an admitted editor failure', async () => {
  const page = await open();
  try {
    await settled(page);
    await page.locator('[data-row-id="r1"]').getByRole('button', { name: 'Alpha record 01', exact: true }).click();
    const input = page.locator('[data-slot="editable-cell-editor"] input'); await input.fill('Old-source draft'); await input.press('Enter');
    await page.waitForFunction(() => window.__liveMotion.writes().length === 1);
    await page.evaluate(() => window.__liveMotion.configure({ primaryKey: 'alternateId' }));
    await page.locator('[data-row-id="other-r1"]').waitFor();
    expect(await page.locator('[data-row-id="r1"]').count()).toBe(0);
    expect(await page.locator('[data-table-leaving]').count()).toBe(0);
    await page.waitForFunction(() => window.__liveMotion.writes()[0]?.aborted === true);
    await page.evaluate(() => window.__liveMotion.rejectWrite(0));
    await settled(page); expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.evaluate(() => window.__liveMotion.events().length)).toBe(0);
    expect(await page.locator('[data-slot="editable-cell-editor"]').count()).toBe(0); expect(await page.locator('table').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('full skeleton is immediate and refetch preserves real native row identity across accepted results', async () => {
  const page = await open({ loading: true });
  try {
    expect(await page.locator('[data-slot="data-table-skeleton-body"] tr').count()).toBe(10);
    await page.evaluate(() => { window.__liveMotion.replace([{ id: 'ready', name: 'Alpha ready', rank: 1 }]); window.__liveMotion.configure({ loading: false }); });
    await page.locator('[data-row-id="ready"]').waitFor(); await settled(page); await page.evaluate(() => window.__liveMotion.save('ready'));
    await page.evaluate(() => window.__liveMotion.configure({ loading: true }));
    await page.locator('[data-slot="data-table-skeleton-body"]').waitFor();
    expect(await page.evaluate(() => window.__liveMotion.same('ready'))).toBe(true);
    await page.evaluate(() => { window.__liveMotion.update('ready', { name: 'Alpha accepted' }); window.__liveMotion.configure({ loading: false }); });
    await page.getByRole('button', { name: 'Alpha accepted', exact: true }).waitFor(); await settled(page);
    expect(await page.evaluate(() => window.__liveMotion.same('ready'))).toBe(true); expect(await page.locator('table').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('accepted inline write retains its actual editor during refetch and retry never dispatches the write twice', async () => {
  const page = await open();
  try {
    await settled(page);
    await page.locator('[data-row-id="r1"]').getByRole('button', { name: 'Alpha record 01', exact: true }).click();
    const input = page.locator('[data-slot="editable-cell-editor"] input'); await input.fill('Accepted draft');
    await input.press('Enter'); await page.waitForFunction(() => window.__liveMotion.writes().length === 1);
    expect(await input.isDisabled()).toBe(true);
    await page.evaluate(() => window.__liveMotion.acceptWrite(0)); await page.waitForFunction(() => window.__liveMotion.refreshCount() === 1);
    await page.waitForTimeout(450); expect(await page.locator('[data-slot="data-table-skeleton-body"]').count()).toBe(0);
    expect(await input.inputValue()).toBe('Accepted draft'); expect(await input.isVisible()).toBe(true);
    await page.evaluate(() => window.__liveMotion.rejectRefresh(0));
    await page.getByText('The change was saved, but the table could not refresh. Retry refresh.').waitFor();
    expect(await input.inputValue()).toBe('Accepted draft'); expect(await page.getByText('PRIVATE_REFRESH_CAUSE').count()).toBe(0);
    const events = await page.evaluate(() => window.__liveMotion.events());
    expect(events).toHaveLength(1); expect(events[0]!.code).toBe(OBS_CODES.FRONTEND_MUTATION_FAILED.code);
    expect(events[0]!.metadata).toEqual({ surface: 'data-table', kind: 'cell', stage: 'refresh' });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_REFRESH_CAUSE');
    await page.locator('[data-slot="editable-cell-editor"]').getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => window.__liveMotion.refreshCount() === 2); expect(await page.evaluate(() => window.__liveMotion.writes().length)).toBe(1);
    await page.evaluate(() => window.__liveMotion.acceptRefresh(1)); await page.getByRole('button', { name: 'Accepted draft', exact: true }).waitFor();
    expect(await input.count()).toBe(0); expect(await page.locator('table').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

for (const dark of [false, true]) browserTest(`real controls and native rows fit 320px in ${dark ? 'dark' : 'light'} mode without duplicated grids`, async () => {
  const page = await open({ dark, width: 320 });
  try {
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    expect(await page.locator('table').count()).toBe(1);
    expect(await page.getByRole('searchbox', { name: 'Search live records' }).isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Next page', exact: true }).isVisible()).toBe(true);
  } finally { await close(page); }
}, 30_000);
