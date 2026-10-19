/** Styled public initial-load qualification; synthetic data, exact animation poses, and no transport latency. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises'; // Bun has no directory lifecycle API.
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', styles = '';
const failures = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/table-initial-reveal-');
  try {
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'data-table-initial-reveal.browser-fixture.tsx')], target: 'browser', format: 'iife' });
    if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
    bundle = await build.outputs.find(output => output.path.endsWith('.js'))!.text();
    styles = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
    styles += '\n' + (await Promise.all(build.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()))).join('\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function open(mode: 'populated' | 'pending' | 'empty' | 'server' | 'custom', reduced = false) {
  const page = await lease!.browser.newPage({ viewport: { width: 850, height: 700 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const messages: string[] = []; failures.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent(`<!doctype html><html data-initial-mode="${mode}"><body style="margin:0;padding:12px"><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: styles });
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function(keyframes, timing) {
      const animation = original.call(this, keyframes, timing);
      if (this instanceof HTMLTableRowElement && this.hasAttribute('data-row-id')) { animation.pause(); animation.currentTime = 0; }
      return animation;
    };
  });
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-slot="data-table-grid"]').waitFor();
  return page;
}
async function close(page: Page) { try { expect(failures.get(page)).toEqual([]); } finally { await page.close(); } }

for (const mode of ['populated', 'pending', 'custom', 'server'] as const) browserTest(`${mode} first result starts exact top-down reveal without a blank pre-expansion or loader minimum`, async () => {
  const page = await open(mode);
  try {
    if (mode === 'pending' || mode === 'server') expect(await page.locator('[data-slot="data-table-skeleton-body"] tr').count()).toBe(10);
    if (mode !== 'populated') await page.evaluate(async () => {
      window.__initialRevealHarness.admit();
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    });
    // Ready data must mount immediately, even when the initial skeleton only just appeared.
    expect(await page.locator('[data-row-id]').count()).toBe(10);
    const receipt = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLTableRowElement>('[data-row-id]')];
      const copy = document.querySelector('[data-slot="data-table-skeleton-crossfade"]')!;
      const frame = document.querySelector('[data-slot="data-table-height-frame"]')!;
      const first = rows[0]!, last = rows[9]!;
      const animations = rows.map(row => row.getAnimations()[0]!);
      const timings = animations.map(animation => ({ duration: animation.effect!.getTiming().duration,
        delay: animation.effect!.getTiming().delay, first: (animation.effect as KeyframeEffect).getKeyframes()[0]!.transform }));
      const firstOverlay = copy.querySelector('[data-slot="data-table-skeleton-overlay"]')!;
      const overlayAnimation = firstOverlay.getAnimations().find(animation => animation.effect!.getTiming().duration === 350)!;
      overlayAnimation.pause(); overlayAnimation.currentTime = 100;
      animations[0]!.currentTime = 100; animations[9]!.currentTime = 100;
      const heightAnimation = frame.getAnimations().find(animation => (animation.effect as KeyframeEffect).getKeyframes().some(keyframe => keyframe.height !== undefined));
      if (heightAnimation) { heightAnimation.pause(); heightAnimation.currentTime = 100; }
      const currentHeight = frame.getBoundingClientRect().height;
      const frameBounds = frame.getBoundingClientRect(), firstBounds = first.getBoundingClientRect();
      return { timings, firstOpacity: Number(getComputedStyle(first).opacity), lastOpacity: Number(getComputedStyle(last).opacity),
        firstText: first.textContent, overlayOpacity: Number(getComputedStyle(firstOverlay).opacity),
        overlayDuration: overlayAnimation.effect!.getTiming().duration, heightDuration: heightAnimation?.effect?.getTiming().duration,
        currentHeight, naturalHeight: (frame as HTMLElement).scrollHeight,
        firstInsideFrame: firstBounds.bottom > frameBounds.top && firstBounds.top < frameBounds.bottom };
    });
    expect(receipt.timings).toEqual(Array.from({ length: 10 }, (_, index) => ({ duration: 525, delay: index * 45, first: 'translateY(-4px)' })));
    expect(receipt.firstOpacity).toBeGreaterThan(0); expect(receipt.lastOpacity).toBe(0);
    expect(receipt.firstText).toContain('Complete value 0');
    expect(receipt.firstInsideFrame).toBe(true);
    expect(receipt.overlayDuration).toBe(350); expect(receipt.overlayOpacity).toBeLessThan(1);
    if (receipt.heightDuration !== undefined) expect(receipt.heightDuration).toBe(580);
    if (mode === 'custom') expect(receipt.heightDuration).toBeUndefined();
  } finally { await close(page); }
}, 30_000);

browserTest('a short first result shrinks its real skeleton allocation concurrently with row reveal using 580ms height easing', async () => {
  const page = await open('pending');
  try {
    const beforeHeight = await page.locator('[data-slot="data-table-height-frame"]').evaluate(frame => frame.getBoundingClientRect().height);
    await page.evaluate(async () => { window.__initialRevealHarness.admit(3); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const receipt = await page.evaluate(() => {
      const frame = document.querySelector('[data-slot="data-table-height-frame"]')!, first = document.querySelector('[data-row-id]')!;
      const heightAnimation = frame.getAnimations().find(animation => (animation.effect as KeyframeEffect).getKeyframes().some(keyframe => keyframe.height !== undefined))!;
      heightAnimation.pause(); heightAnimation.currentTime = 100;
      first.getAnimations()[0]!.currentTime = 100;
      const frames = (heightAnimation.effect as KeyframeEffect).getKeyframes();
      return { heightDuration: heightAnimation.effect!.getTiming().duration, heightFrom: Number.parseFloat(String(frames[0]!.height)),
        heightTo: Number.parseFloat(String(frames[1]!.height)), firstOpacity: Number(getComputedStyle(first).opacity) };
    });
    expect(await page.locator('[data-row-id]').count()).toBe(3);
    expect(receipt.heightDuration).toBe(580); expect(receipt.heightFrom).toBeCloseTo(beforeHeight, 1);
    expect(receipt.heightTo).toBeLessThan(receipt.heightFrom); expect(receipt.firstOpacity).toBeGreaterThan(0);
  } finally { await close(page); }
}, 30_000);

browserTest('a subsequent insert into an acknowledged empty result remains a live reflow, not an initial skeleton replay', async () => {
  const page = await open('empty');
  try {
    await page.evaluate(async () => { window.__initialRevealHarness.admit(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    expect(await page.locator('[data-row-id]').count()).toBe(10);
    expect(await page.locator('[data-slot="data-table-skeleton-crossfade"]').count()).toBe(0);
    const rows = await page.locator('[data-row-id]').evaluateAll(elements => elements.map(row => {
      const animation = row.getAnimations()[0]!;
      return { duration: animation.effect!.getTiming().duration, delay: animation.effect!.getTiming().delay,
        first: (animation.effect as KeyframeEffect).getKeyframes()[0]!.transform };
    }));
    expect(rows).toEqual(Array.from({ length: 10 }, () => ({ duration: 525, delay: 0, first: 'translateY(-3px)' })));
  } finally { await close(page); }
}, 30_000);

browserTest('reduced motion accepts the first result immediately with no row/crossfade animations', async () => {
  const page = await open('pending', true);
  try {
    await page.evaluate(async () => { window.__initialRevealHarness.admit(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    expect(await page.locator('[data-row-id]').count()).toBe(10);
    expect(await page.locator('[data-slot="data-table-skeleton-crossfade"]').count()).toBe(0);
    expect(await page.locator('[data-slot="data-table-skeleton-body"]').count()).toBe(0);
    expect(await page.locator('[data-row-id]').evaluateAll(rows => rows.every(row => row.getAnimations().length === 0 && Number(getComputedStyle(row).opacity) === 1))).toBe(true);
  } finally { await close(page); }
}, 30_000);
