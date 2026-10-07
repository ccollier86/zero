/** Real Chromium coverage for bounded canonical-text replacement and existing sequence compatibility; no app or database. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '';
const errors = new WeakMap<Page, string[]>();

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const build = await Bun.build({ entrypoints: [`${import.meta.dir}/data-table-animated-text.browser-fixture.tsx`],
    target: 'browser', format: 'iife' });
  if (!build.success) throw new Error(`Typing fixture build failed: ${build.logs.map(log => log.message).join('\n')}`);
  bundle = await build.outputs[0]!.text();
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function open(initial = 'Initial value', reduced = false, controlledClock = true) {
  const page = await lease!.browser.newPage({ viewport: { width: 900, height: 700 },
    reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5_000);
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.evaluate(value => { document.documentElement.dataset.initialText = value; }, initial);
  if (controlledClock) {
    await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-07T12:00:01Z'));
  }
  await page.addScriptTag({ content: bundle });
  await page.getByTestId('cell').waitFor();
  return page;
}

async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
const wrapper = '[data-slot="data-table-animated-text"]';
const visual = '[data-slot="typing-text-visual"]';

browserTest('mount is static; blank-to-text types once while canonical accessible/selectable text is already final', async () => {
  const page = await open('');
  try {
    expect(await page.locator(visual).count()).toBe(0);
    await page.evaluate(() => window.__typingTextMotion.probe());
    await page.evaluate(() => window.__typingTextMotion.value('New text'));
    expect(await page.getByTestId('accepted').textContent()).toBe('New text');
    expect(await page.getByRole('button', { name: 'New text', exact: true }).count()).toBe(1);
    expect(await page.locator(visual).getAttribute('aria-hidden')).toBe('true');
    expect(await page.locator(visual).textContent()).toBe('');
    await page.clock.runFor(48);
    expect(await page.locator(visual).textContent()).toBe('Ne');
    expect(await page.locator('[data-slot="typing-text-value"]').evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      return { selected: selection.toString(), opacity: getComputedStyle(element).opacity };
    })).toEqual({ selected: 'New text', opacity: '0' });
    expect(await page.locator(wrapper).evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      return selection.toString();
    })).toBe('New text');
    await page.clock.runFor(525);
    expect(await page.locator(visual).count()).toBe(0);
    expect(await page.getByTestId('cell').textContent()).toBe('New text');
    expect(await page.evaluate(() => window.__typingTextMotion.timers().pending)).toBe(0);
    await page.clock.runFor(2000);
    expect(await page.locator(visual).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('changed text backspaces before replacement, including an intermediate prefix matching the target', async () => {
  const page = await open('Old');
  try {
    await page.evaluate(() => window.__typingTextMotion.value('O'));
    expect(await page.locator(visual).textContent()).toBe('Old');
    await page.clock.runFor(24);
    expect(await page.locator(visual).textContent()).toBe('Ol');
    await page.clock.runFor(24);
    expect(await page.locator(visual).textContent()).toBe('O');
    expect(await page.locator(wrapper).getAttribute('data-typing')).toBe('');
    await page.clock.runFor(24);
    expect(await page.locator(visual).textContent()).toBe('');
    await page.clock.runFor(24);
    expect(await page.locator(visual).count()).toBe(0);
    expect(await page.getByTestId('cell').textContent()).toBe('O');
    await page.evaluate(() => window.__typingTextMotion.value(''));
    expect(await page.locator(visual).textContent()).toBe('O');
    await page.clock.runFor(24);
    expect(await page.locator(visual).count()).toBe(0);
    expect(await page.getByTestId('cell').textContent()).toBe('');
  } finally { await close(page); }
}, 30_000);

browserTest('switching the existing primitive between legacy and replacement modes keeps hook lifecycles separate', async () => {
  const page = await open('Initial value', false, false);
  try {
    await page.evaluate(() => window.__typingTextMotion.mode('type'));
    expect(await page.getByTestId('mode').textContent()).toBe('');
    await page.waitForFunction(() => document.querySelector('[data-testid="mode"]')?.textContent === 'Mo');
    expect(await page.getByTestId('mode').textContent()).toBe('Mo');
    await page.evaluate(() => window.__typingTextMotion.mode('replace'));
    expect(await page.getByTestId('mode').textContent()).toBe('Mode value');
    expect(await page.getByTestId('mode').locator(visual).count()).toBe(0);
    await page.evaluate(() => window.__typingTextMotion.mode('type'));
    expect(await page.getByTestId('mode').textContent()).toBe('');
    await page.waitForFunction(() => document.querySelector('[data-testid="mode"]')?.textContent === 'Mode value');
    expect(await page.getByTestId('mode').textContent()).toBe('Mode value');
  } finally { await close(page); }
}, 30_000);

browserTest('rapid updates coalesce from currently displayed glyphs and preserve the canonical child node', async () => {
  const page = await open('abcdef');
  try {
    await page.getByTestId('canonical-mark').evaluate(element => {
      (window as unknown as { __savedCanonical: Element }).__savedCanonical = element;
    });
    await page.evaluate(() => window.__typingTextMotion.value('First discarded target'));
    await page.clock.runFor(80);
    const current = await page.locator(visual).textContent();
    expect(current).not.toBe('abcdef');
    await page.evaluate(() => window.__typingTextMotion.value('Latest'));
    expect(await page.locator(visual).textContent()).toBe(current);
    expect(await page.getByRole('button', { name: 'Latest', exact: true }).count()).toBe(1);
    await page.clock.runFor(525);
    expect(await page.getByTestId('cell').textContent()).toBe('Latest');
    expect(await page.getByTestId('canonical-mark').evaluate(element =>
      element === (window as unknown as { __savedCanonical: Element }).__savedCanonical)).toBe(true);
    await page.clock.runFor(2000);
    expect(await page.getByTestId('cell').textContent()).toBe('Latest');
  } finally { await close(page); }
}, 30_000);

browserTest('a narrow long-to-short replacement clips only decorative glyphs while canonical copy and dynamic bounds remain intact', async () => {
  const page = await open('Former value has many ordinary words that wrap naturally inside a narrow cell before being replaced by short text');
  try {
    await page.evaluate(() => window.__typingTextMotion.bounds(140));
    const initialHeight = await page.getByTestId('cell').evaluate(element => element.getBoundingClientRect().height);
    await page.evaluate(() => window.__typingTextMotion.value('Short'));
    expect(await page.getByRole('button', { name: 'Short', exact: true }).count()).toBe(1);
    const clipping = await page.locator(visual).evaluate(element => ({
      overflow: getComputedStyle(element).overflow,
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
      scrollHeight: element.scrollHeight,
      canonicalHeight: element.previousElementSibling!.getBoundingClientRect().height,
      wrapperWidth: element.parentElement!.getBoundingClientRect().width,
      canonicalOverflow: getComputedStyle(element.previousElementSibling!).overflow,
    }));
    expect(clipping.overflow).toBe('hidden'); expect(clipping.canonicalOverflow).toBe('visible');
    expect(clipping.scrollHeight).toBeGreaterThan(clipping.height);
    expect(clipping.height).toBeLessThan(initialHeight);
    expect(clipping.width).toBe(clipping.wrapperWidth);
    await page.clock.runFor(48);
    const current = await page.locator(visual).textContent();
    await page.evaluate(() => window.__typingTextMotion.bounds(100));
    expect(await page.locator(visual).textContent()).toBe(current);
    expect(await page.locator('[data-slot="typing-text-value"]').evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      return selection.toString();
    })).toBe('Short');
    await page.clock.runFor(477);
    expect(await page.locator(visual).count()).toBe(0);
    expect(await page.getByTestId('cell').textContent()).toBe('Short');
  } finally { await close(page); }
}, 30_000);

browserTest('grapheme clusters stay whole and arbitrarily long changes use one bounded timer chain', async () => {
  const page = await open('');
  try {
    await page.evaluate(() => window.__typingTextMotion.probe());
    const target = '👨‍👩‍👧‍👦e\u0301🇺🇸👍🏽';
    await page.evaluate(value => window.__typingTextMotion.value(value), target);
    const prefixes = ['👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦e\u0301', '👨‍👩‍👧‍👦e\u0301🇺🇸'];
    for (const prefix of prefixes) {
      await page.clock.runFor(24); expect(await page.locator(visual).textContent()).toBe(prefix);
    }
    await page.clock.runFor(24);
    expect(await page.getByTestId('cell').textContent()).toBe(target);
    const long = 'A'.repeat(20_000);
    await page.evaluate(value => window.__typingTextMotion.value(value), long);
    await page.clock.runFor(48);
    const erasing = await page.locator(visual).textContent();
    expect(erasing).not.toBe(target); expect(erasing).not.toContain('A'); expect(erasing?.length).toBeGreaterThan(0);
    await page.clock.runFor(476);
    expect(await page.locator(visual).count()).toBe(1);
    await page.clock.runFor(1);
    expect(await page.locator(visual).count()).toBe(0);
    expect(await page.getByTestId('cell').textContent()).toBe(long);
    const timers = await page.evaluate(() => window.__typingTextMotion.timers());
    expect(timers.pending).toBe(0); expect(timers.peak).toBe(1); expect(timers.scheduled).toBeLessThan(50);
    await page.evaluate(value => {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
      window.__typingTextMotion.value(value);
    }, target);
    await page.clock.runFor(24);
    expect(await page.locator(visual).textContent()).toBe('');
    await page.clock.runFor(24);
    expect(await page.getByTestId('cell').textContent()).toBe(target);
  } finally { await close(page); }
}, 30_000);

browserTest('disable, dynamic reduced motion, and unmount cancel owned timers without replaying old updates', async () => {
  const page = await open('Original');
  try {
    await page.evaluate(() => window.__typingTextMotion.probe());
    await page.evaluate(() => window.__typingTextMotion.value('Disabled replacement'));
    await page.clock.runFor(48);
    await page.evaluate(() => window.__typingTextMotion.enabled(false));
    expect(await page.getByTestId('cell').textContent()).toBe('Disabled replacement');
    expect(await page.evaluate(() => window.__typingTextMotion.timers().pending)).toBe(0);
    await page.evaluate(() => window.__typingTextMotion.enabled(true));
    expect(await page.locator(visual).count()).toBe(0);
    await page.evaluate(() => window.__typingTextMotion.value('Reduced replacement'));
    await page.clock.runFor(48);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.querySelector('[data-slot="typing-text-visual"]'));
    expect(await page.getByTestId('cell').textContent()).toBe('Reduced replacement');
    expect(await page.evaluate(() => window.__typingTextMotion.timers().pending)).toBe(0);
    await page.evaluate(() => window.__typingTextMotion.value('Already reduced'));
    expect(await page.getByTestId('cell').textContent()).toBe('Already reduced');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.clock.runFor(525);
    expect(await page.locator(visual).count()).toBe(0);
    await page.evaluate(() => window.__typingTextMotion.value('Unmounted replacement'));
    await page.clock.runFor(48);
    await page.evaluate(() => window.__typingTextMotion.visible(false));
    expect(await page.evaluate(() => window.__typingTextMotion.timers().pending)).toBe(0);
    await page.clock.runFor(2000);
    await page.evaluate(() => window.__typingTextMotion.visible(true));
    expect(await page.getByTestId('cell').textContent()).toBe('Unmounted replacement');
    expect(await page.locator(visual).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('legacy string/array/loop timing and cursor provider still work, including viewport and delay gating', async () => {
  // This regression uses Chromium's real clock so its native viewport observer and Motion cursor keep their original lifecycle.
  const page = await open('Initial value', false, false);
  try {
    await page.evaluate(() => window.__typingTextMotion.legacy({ text: 'One' }));
    await page.waitForFunction(() => document.querySelector('[data-testid="legacy"]')?.textContent === 'One');
    expect(await page.getByTestId('legacy').textContent()).toBe('One');
    expect(await page.getByTestId('legacy-cursor').count()).toBe(1);
    await page.evaluate(() => window.__typingTextMotion.legacy({ text: ['A', 'B'], loop: true }));
    await page.waitForFunction(() => document.querySelector('[data-testid="legacy"]')?.textContent === 'A');
    expect(await page.getByTestId('legacy').textContent()).toBe('A');
    await page.waitForFunction(() => document.querySelector('[data-testid="legacy"]')?.textContent === 'B');
    expect(await page.getByTestId('legacy').textContent()).toBe('B');
    await page.waitForFunction(() => document.querySelector('[data-testid="legacy"]')?.textContent === 'A');
    expect(await page.getByTestId('legacy').textContent()).toBe('A');
    await page.evaluate(() => window.__typingTextMotion.legacy(null));
    await page.evaluate(() => window.__typingTextMotion.legacy({ text: 'Gated', inView: true, delay: 400 }));
    expect(await page.getByTestId('legacy').textContent()).toBe('');
    await page.getByTestId('legacy').scrollIntoViewIfNeeded();
    expect(await page.getByTestId('legacy').textContent()).toBe('');
    await page.waitForFunction(() => document.querySelector('[data-testid="legacy"]')?.textContent === 'Gated');
    expect(await page.getByTestId('legacy').textContent()).toBe('Gated');
  } finally { await close(page); }
}, 30_000);
