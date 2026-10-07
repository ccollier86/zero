/** Browser qualification of React-owned engine timing, node identity, native rows, queue priority and retirement. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises'; // Bun has no directory lifecycle API.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'table-motion-engine-'));
  try {
    const output = join(directory, 'fixture.js');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'data-table-motion.browser-fixture.tsx'), '--target=browser', '--format=iife', '--outfile', output],
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Motion fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 30000);
afterAll(() => lease?.release());
async function open(loading = false) {
  const page = await lease!.browser.newPage({ viewport: { width: 800, height: 650 }, reducedMotion: 'no-preference' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent(`<!doctype html><html data-initial-loading="${loading}"><style>
    body{margin:0;padding:20px} [data-frame]{width:600px;position:relative} table{width:100%;border-collapse:collapse;table-layout:fixed}
    tbody{position:relative} tr{height:36px} th,td{padding:0;border-bottom:1px solid #ccc;height:36px;box-sizing:border-box}
    input{width:120px} [data-skeleton-row]{background:#eee} [data-leaving]{pointer-events:none}
  </style><div id="root"></div></html>`);
  await page.addScriptTag({ content: bundle }); await page.locator('[data-frame]').waitFor(); return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
async function settled(page: Page) { await page.waitForFunction(() => document.querySelector('[data-frame]')?.getAttribute('data-busy') === 'false'); }
async function ids(page: Page) { return page.locator('tr[data-row-id]:not([data-leaving])').evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id'))); }

browserTest('frame zero populated rows receive exact initial stagger after StrictMode mount admission', async () => {
  const page = await open();
  try {
    const timings = await page.evaluate(() => document.getAnimations().filter(animation => (animation.effect as KeyframeEffect).target instanceof HTMLTableRowElement)
      .map(animation => ({ id: ((animation.effect as KeyframeEffect).target as Element).getAttribute('data-row-id'), timing: animation.effect!.getTiming(), frames: (animation.effect as KeyframeEffect).getKeyframes() })));
    expect(timings.map(item => item.id).sort()).toEqual(['a', 'b', 'c']);
    expect(timings.map(item => item.timing.delay).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 45, 90]);
    expect(timings.every(item => item.timing.duration === 525 && item.frames[0]!.transform === 'translateY(-4px)')).toBe(true);
    await settled(page); expect(await ids(page)).toEqual(['a', 'b', 'c']);
    expect(await page.locator('[data-frame]').getAttribute('data-reveal')).toBe('false');
  } finally { await close(page); }
}, 30_000);

browserTest('first load shows skeleton immediately and its actual reveal respects the 400ms minimum', async () => {
  const page = await open(true);
  try {
    expect(await page.locator('[data-skeleton-row]').count()).toBe(3);
    const start = await page.evaluate(() => performance.now());
    await page.evaluate(() => window.__motionEngine.change({ loading: false, rows: [{ id: 'ready', name: 'Ready' }] }));
    expect(await page.locator('[data-skeleton-row]').count()).toBe(3);
    await page.locator('[data-row-id="ready"]').waitFor();
    expect(await page.evaluate(start => performance.now() - start, start)).toBeGreaterThan(330);
    expect(await page.locator('[data-frame]').getAttribute('data-reveal')).toBe('true');
    await settled(page);
  } finally { await close(page); }
}, 30_000);

browserTest('a retained native row is inert and re-entry cancels its exit without replacing its node', async () => {
  const page = await open();
  try {
    await settled(page); await page.evaluate(() => window.__motionEngine.save('a'));
    await page.evaluate(() => window.__motionEngine.change({ rows: [{ id: 'b', name: 'Record b' }, { id: 'c', name: 'Record c' }] }));
    await page.locator('[data-row-id="a"][data-leaving]').waitFor();
    expect(await page.evaluate(() => {
      const row = document.querySelector('[data-row-id="a"]') as HTMLTableRowElement;
      return { position: row.style.position, inert: row.inert, hidden: row.getAttribute('aria-hidden'), captured: window.__motionEngine.capturedIds() };
    })).toEqual({ position: 'absolute', inert: true, hidden: 'true', captured: ['a', 'b', 'c'] });
    await page.evaluate(() => window.__motionEngine.change({ rows: [{ id: 'a', name: 'Returned' }, { id: 'b', name: 'Record b' }, { id: 'c', name: 'Record c' }] }));
    await page.locator('[data-row-id="a"]:not([data-leaving])').waitFor();
    expect(await page.evaluate(() => window.__motionEngine.same('a'))).toBe(true);
    expect(await page.locator('[data-row-id="a"]').count()).toBe(1);
    expect(await page.locator('[data-row-id="a"]').evaluate(row => (row as HTMLElement).style.position)).toBe('');
    await settled(page); expect(await ids(page)).toEqual(['a', 'b', 'c']);
  } finally { await close(page); }
}, 30_000);

browserTest('query priority retires a pending page and stale page exit cannot replace accepted query rows', async () => {
  const page = await open();
  try {
    await settled(page);
    await page.evaluate(() => window.__motionEngine.change({ pageIndex: 1, loading: true }));
    expect(await ids(page)).toEqual(['a', 'b', 'c']);
    await page.evaluate(() => window.__motionEngine.change({ pageIndex: 2, loading: true }));
    await page.evaluate(() => window.__motionEngine.change({ queryKey: 'filtered', pageIndex: 0, loading: false, rows: [{ id: 'filtered', name: 'Filtered' }] }));
    await settled(page); expect(await ids(page)).toEqual(['filtered']);
    expect(await page.locator('[data-skeleton-row]').count()).toBe(0);
    expect(await page.locator('[data-frame]').evaluate(frame => [...frame.querySelectorAll('tbody')].every(body => Number(getComputedStyle(body).opacity) === 1))).toBe(true);
  } finally { await close(page); }
}, 30_000);

browserTest('latest page waits for the exit and enters once without row stagger using the keyboard factor', async () => {
  const page = await open();
  try {
    await settled(page);
    await page.evaluate(() => window.__motionEngine.change({ pageIndex: 1, loading: true, navigationOrigin: 'keyboard' }));
    await page.evaluate(() => window.__motionEngine.change({ pageIndex: 2, loading: false, rows: [{ id: 'last', name: 'Latest page' }] }));
    await page.locator('[data-row-id="last"]').waitFor();
    const animations = await page.evaluate(() => document.getAnimations().filter(animation => (animation.effect as KeyframeEffect).target instanceof HTMLTableSectionElement)
      .map(animation => ({ duration: animation.effect!.getTiming().duration, delay: animation.effect!.getTiming().delay, frames: (animation.effect as KeyframeEffect).getKeyframes() })));
    expect(animations.some(animation => animation.duration === 525 * .7 && animation.delay === 0 && animation.frames[0]!.transform === 'translateX(8px)')).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().filter(animation => (animation.effect as KeyframeEffect).target instanceof HTMLTableRowElement).length)).toBe(0);
    await settled(page); expect(await ids(page)).toEqual(['last']);
  } finally { await close(page); }
}, 30_000);

browserTest('reduced-motion changes retire running leavers/moves and scope unmount retires loader continuations', async () => {
  const page = await open();
  try {
    await settled(page);
    await page.evaluate(() => window.__motionEngine.change({ rows: [{ id: 'c', name: 'Record c' }, { id: 'b', name: 'Record b' }] }));
    await page.locator('[data-row-id="a"][data-leaving]').waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelectorAll('[data-leaving]').length === 0);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.evaluate(() => window.__motionEngine.change({ pageIndex: 1, loading: true }));
    await page.evaluate(() => window.__motionEngine.scope());
    expect(await ids(page)).toEqual(['a', 'b', 'c']);
    await page.evaluate(() => window.__motionEngine.unmount()); await page.getByText('Unmounted').waitFor();
    await page.waitForTimeout(450); expect(await page.locator('[data-frame]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('refetch loader is delayed and preserves the native row and draft through its minimum visible interval', async () => {
  const page = await open();
  try {
    await settled(page); await page.evaluate(() => window.__motionEngine.save('a'));
    await page.getByRole('textbox', { name: 'Name a', exact: true }).fill('Unsubmitted draft');
    await page.evaluate(() => window.__motionEngine.change({ loading: true }));
    await page.waitForTimeout(140); expect(await page.locator('[data-skeleton-row]').count()).toBe(0);
    await page.locator('[data-skeleton-row]').first().waitFor();
    expect(await page.evaluate(() => window.__motionEngine.same('a'))).toBe(true);
    const accepted = await page.evaluate(() => {
      window.__motionEngine.change({ loading: false }); return performance.now();
    });
    expect(await page.locator('[data-skeleton-row]').count()).toBe(3);
    await page.getByRole('textbox', { name: 'Name a', exact: true }).waitFor();
    expect(await page.evaluate(start => performance.now() - start, accepted)).toBeGreaterThan(330);
    expect(await page.evaluate(() => window.__motionEngine.same('a'))).toBe(true);
    expect(await page.getByRole('textbox', { name: 'Name a', exact: true }).inputValue()).toBe('Unsubmitted draft');
    await settled(page);
  } finally { await close(page); }
}, 30_000);

browserTest('acknowledged editor suppresses skeleton admission and an error restores the visible retained page', async () => {
  const page = await open();
  try {
    await settled(page); await page.evaluate(() => window.__motionEngine.save('a'));
    await page.getByRole('textbox', { name: 'Name a', exact: true }).fill('Retryable edit');
    await page.evaluate(() => window.__motionEngine.change({ loading: true, allowSkeleton: false }));
    await page.waitForTimeout(450); expect(await page.locator('[data-skeleton-row]').count()).toBe(0);
    expect(await page.getByRole('textbox', { name: 'Name a', exact: true }).isVisible()).toBe(true);
    await page.evaluate(() => window.__motionEngine.change({ loading: false, error: true }));
    await settled(page); expect(await ids(page)).toEqual(['a', 'b', 'c']);
    expect(await page.evaluate(() => window.__motionEngine.same('a'))).toBe(true);
    expect(await page.getByRole('textbox', { name: 'Name a', exact: true }).inputValue()).toBe('Retryable edit');
    expect(await page.locator('tbody').evaluate(body => Number(getComputedStyle(body).opacity))).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('an already pinned leaver retains the same exit animation through an interrupted reflow', async () => {
  const page = await open();
  try {
    await settled(page);
    const owned = await page.evaluate(async () => {
      window.__motionEngine.change({ rows: [{ id: 'b', name: 'Record b' }, { id: 'c', name: 'Record c' }] });
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const row = document.querySelector('[data-row-id="a"]') as HTMLTableRowElement;
      const exit = row.getAnimations()[0];
      window.__motionEngine.change({ rows: [{ id: 'c', name: 'Record c' }, { id: 'b', name: 'Record b' }] });
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      return { same: row.getAnimations().includes(exit!), pinned: row.style.position, exitDuration: exit?.effect?.getTiming().duration };
    });
    expect(owned).toEqual({ same: true, pinned: 'absolute', exitDuration: 350 });
    await settled(page); expect(await ids(page)).toEqual(['c', 'b']);
    expect(await page.locator('[data-row-id="a"]').count()).toBe(0);
    expect(await page.locator('[data-row-id="b"]').evaluate(row => (row as HTMLElement).style.zIndex)).toBe('');
  } finally { await close(page); }
}, 30_000);

for (const mode of ['disabled', 'reduced'] as const) browserTest(`${mode} presentation updates immediately without retained leavers, animation or busy feedback`, async () => {
  const page = await open();
  try {
    await settled(page);
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(() => window.__motionEngine.change({ enabled: false }));
    const before = await page.evaluate(() => window.__motionEngine.busyEvents().length);
    await page.evaluate(() => window.__motionEngine.change({ pageIndex: 1, rows: [{ id: 'immediate', name: 'Immediate' }] }));
    await page.locator('[data-row-id="immediate"]').waitFor(); await settled(page);
    expect(await ids(page)).toEqual(['immediate']);
    expect(await page.locator('[data-leaving]').count()).toBe(0);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await page.evaluate(start => window.__motionEngine.busyEvents().length - start, before)).toBeLessThanOrEqual(2);
    expect(await page.locator('[data-frame]').getAttribute('data-reveal')).toBe('false');
    await page.evaluate(() => window.__motionEngine.change({ rows: [{ id: 'next', name: 'Next' }] }));
    await page.locator('[data-row-id="next"]').waitFor(); await settled(page);
    expect(await ids(page)).toEqual(['next']);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('replacement page exit starts from the current in-flight opacity instead of snapping to one', async () => {
  const page = await open();
  try {
    await settled(page);
    await page.evaluate(() => window.__motionEngine.change({ pageIndex: 1, rows: [{ id: 'middle', name: 'Middle' }] }));
    await page.locator('[data-row-id="middle"]').waitFor();
    const observed = await page.evaluate(async () => {
      const body = document.querySelector('tbody')!;
      const enter = body.getAnimations()[0]!;
      // Freeze an actual WAAPI intermediate state rather than depend on host
      // scheduling latency to observe a particular point in a 525ms curve.
      enter.pause(); enter.currentTime = 110;
      const before = Number(getComputedStyle(body).opacity);
      window.__motionEngine.change({ pageIndex: 2, loading: true });
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const exit = body.getAnimations().find(animation => animation !== enter)!;
      return { before, start: Number((exit.effect as KeyframeEffect).getKeyframes()[0]!.opacity), duration: exit.effect!.getTiming().duration };
    });
    expect(observed.before).toBeGreaterThan(0);
    expect(observed.before).toBeLessThan(1);
    expect(observed.start).toBeCloseTo(observed.before, 4);
    expect(observed.duration).toBe(230);
    await page.evaluate(() => window.__motionEngine.change({ loading: false, rows: [{ id: 'last', name: 'Last' }] }));
    await settled(page); expect(await ids(page)).toEqual(['last']);
  } finally { await close(page); }
}, 30_000);
