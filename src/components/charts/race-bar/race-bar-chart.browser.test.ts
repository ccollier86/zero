/** Browser qualification of real reference motion/controls and shared Zero tooltip using only isolated synthetic history. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { renderThemeFoundationCss } from '../../../design-system/theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/race-bar-chart';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true }); const directory = await mkdtemp(join(scratch, 'race-bar-browser-'));
  try {
    const output = join(directory, 'fixture.js'); const child = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/race-bar-chart.browser-fixture.tsx', '--target=browser', '--format=iife', '--outfile', output],
      { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error('Race Bar fixture build failed: ' + (stderr || stdout));
    bundle = await Bun.file(output).text(); css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); await mkdir(artifacts, { recursive: true });
}, 60_000);
afterAll(() => lease?.release());
async function mount(width = 1100, dark = false, reduced = false) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message)); page.setDefaultTimeout(5000);
  await page.setContent(`<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"${dark ? ' class="dark"' : ''}><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Race Bar chart fixture' }).waitFor();
  await page.waitForFunction(() => !!window.__raceBarFixture && document.querySelector('.zero-race-bar__plot')?.hasAttribute('data-position'));
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
async function settled(page: Page) { await page.waitForFunction(() => document.querySelector('.zero-race-bar__plot')?.getAttribute('data-settling') === 'false'); }
async function seek(page: Page, position: number) { await page.evaluate(value => window.__raceBarFixture.action('seek', value), position); await settled(page); }

browserTest('marker-only density and late fonts remeasure Race Bar while period selection and idle teardown stay intact', async () => {
  const page = await mount(1100, false, true);
  try {
    await seek(page, 4); await page.evaluate(() => window.__raceBarFixture.select('oak'));
    await page.addStyleTag({ content: renderThemeFoundationCss() + '\n[data-zero-density="touch"]{--zero-race-bar-name-size:22px;--zero-race-bar-value-size:24px}' });
    const row = await page.locator('[data-item-id="oak"]').elementHandle();
    const width = () => page.locator('[data-item-id="oak"] .zero-race-bar__name').evaluate(element => (element as HTMLElement).style.width);
    await page.getByTestId('card').evaluate(element => { element.setAttribute('data-zero-theme', 'next'); element.setAttribute('data-zero-mode', 'light'); });
    const before = await width();
    await page.getByTestId('card').evaluate(element => element.setAttribute('data-zero-density', 'touch'));
    await page.waitForFunction(previous => (document.querySelector('[data-item-id="oak"] .zero-race-bar__name') as HTMLElement).style.width !== previous, before);
    expect(await page.evaluate(() => window.__raceBarFixture.state())).toMatchObject({ frame: 4, selection: 'oak', playing: false });
    expect(await row!.evaluate(element => element === document.querySelector('[data-item-id="oak"]'))).toBe(true);
    await page.getByTestId('card').evaluate(element => element.removeAttribute('data-zero-density')); await settled(page);
    await page.waitForFunction(previous => (document.querySelector('[data-item-id="oak"] .zero-race-bar__name') as HTMLElement).style.width === previous, before);
    await page.addStyleTag({ content: '.zero-race-bar{--zero-race-bar-name-size:24px;--zero-race-bar-value-size:26px;--zero-chart-font-family:monospace}' });
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    await page.waitForFunction(previous => (document.querySelector('[data-item-id="oak"] .zero-race-bar__name') as HTMLElement).style.width !== previous, before);
    expect(await page.evaluate(() => window.__raceBarFixture.state())).toMatchObject({ frame: 4, selection: 'oak', playing: false });
    await page.waitForFunction(() => window.__raceBarPendingFrames() === 0);
    await page.evaluate(() => window.__raceBarFixture.unmount()); await page.locator('.zero-race-bar').waitFor({ state: 'detached' });
    await page.getByTestId('card').evaluate(element => element.setAttribute('data-zero-mode', 'dark'));
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone'))); await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    expect(await page.evaluate(() => window.__raceBarPendingFrames())).toBe(0);
  } finally { await close(page); }
}, 30_000);
for (const [width, dark, name] of [[1100, false, 'light'], [1100, true, 'dark'], [390, false, 'phone-light'], [390, true, 'phone-dark']] as const) {
  browserTest(`reference Race Bar anatomy, tokens and bounded ${name} layout`, async () => {
    const page = await mount(width, dark, true);
    try {
      await settled(page); expect(await page.locator('.zero-race-bar__row').count()).toBe(10); expect(await page.locator('.zero-race-bar__row[data-in-top="true"]').count()).toBe(8);
      expect(await page.locator('.zero-race-bar__plot').getAttribute('data-layout')).toBe(width < 500 ? 'inside' : 'outside');
      expect(await page.getByRole('slider', { name: 'Period' }).getAttribute('aria-valuetext')).toBe('January');
      expect(await page.getByRole('table', { name: 'Revenue by product, 2026' }).count()).toBe(1);
      expect(await page.locator('.zero-race-bar').evaluate(element => { const style = getComputedStyle(element); return { color: style.getPropertyValue('--zero-chart-blue').trim(), enter: style.getPropertyValue('--zero-race-bar-period-enter').trim() }; }))
        .toEqual({ color: dark ? '#3987e5' : '#2a78d6', enter: '420ms' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: join(artifacts, name + '.png'), fullPage: true });
    } finally { await close(page); }
  }, 30_000);
}
browserTest('clock seek blends numbers and retargets existing rows instead of remounting', async () => {
  const page = await mount();
  try {
    const row = await page.locator('[data-item-id="oak"]').elementHandle(); await page.evaluate(() => window.__raceBarFixture.action('seek', 6));
    await page.waitForFunction(() => { const position = Number(document.querySelector('.zero-race-bar__plot')?.getAttribute('data-position')); return position > .1 && position < 5; });
    expect(await page.locator('[data-item-id="oak"]').getAttribute('data-value')).not.toBe('30000');
    const mid = Number(await page.locator('.zero-race-bar__plot').getAttribute('data-position')); await page.evaluate(() => window.__raceBarFixture.action('seek', 2));
    expect(Number(await page.locator('.zero-race-bar__plot').getAttribute('data-position'))).toBeGreaterThan(mid - .5);
    await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(2);
    expect(await row!.evaluate(element => element === document.querySelector('[data-item-id="oak"]'))).toBe(true);
  } finally { await close(page); }
}, 30_000);
browserTest('play pause replay frame callbacks and real looping use the supplied history only', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__raceBarFixture.settings({ frameDuration: 100 })); await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor(); await page.waitForFunction(() => Number(document.querySelector('.zero-race-bar__plot')?.getAttribute('data-position')) > .2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click(); await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().playing)).toBe(false);
    await seek(page, 11); await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('.zero-race-bar__plot')?.getAttribute('data-position')) < 10.5);
    await page.evaluate(() => window.__raceBarFixture.action('pause')); await settled(page);
    await page.evaluate(() => { window.__raceBarFixture.settings({ loop: true }); window.__raceBarFixture.action('seek', 10); }); await settled(page);
    await page.evaluate(() => window.__raceBarFixture.action('play'));
    await page.waitForFunction(() => window.__raceBarFixture.state().requests.some(request => request.reason === 'playback' && request.position === 0));
    await page.evaluate(() => window.__raceBarFixture.action('pause')); expect((await page.evaluate(() => window.__raceBarFixture.state().observed)).length).toBeGreaterThan(1);
  } finally { await close(page); }
}, 30_000);
browserTest('keyboard reads bars, steps periods and default/custom/hidden inspectors reuse the Zero portal', async () => {
  const page = await mount(1100, false, true);
  try {
    await page.keyboard.press('Tab'); await page.keyboard.press('ArrowDown'); await page.getByRole('tooltip').filter({ hasText: 'Linen throw' }).waitFor();
    expect(await page.evaluate(() => window.__raceBarFixture.state().selection)).toBe('throw');
    expect(await page.locator('.zero-race-bar__tooltip').evaluate(element => !element.closest('figure'))).toBe(true);
    await page.keyboard.press('ArrowRight'); await settled(page); await page.getByRole('tooltip').filter({ hasText: '+88.5% vs January' }).waitFor();
    await page.evaluate(() => window.__raceBarFixture.tooltip('custom')); await page.getByTestId('custom-inspector').filter({ hasText: 'Custom Linen throw: 98000.0' }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.__raceBarFixture.tooltip('hidden'); window.__raceBarFixture.select('oak'); }); expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('pointer hover follows the cursor, touch pin toggles and selected values stay live while playing', async () => {
  const page = await mount();
  try {
    await page.locator('[data-item-id="throw"] .zero-race-bar__bar').hover(); await page.getByRole('tooltip').filter({ hasText: '$52K' }).waitFor();
    const anchor = page.locator('.zero-race-bar__inspection-anchor'), first = Number((await anchor.getAttribute('style'))?.match(/left: ([\d.]+)/)?.[1]);
    const box = await page.locator('[data-item-id="throw"] .zero-race-bar__bar').boundingBox(); await page.mouse.move(box!.x + 10, box!.y + 5);
    const second = Number((await anchor.getAttribute('style'))?.match(/left: ([\d.]+)/)?.[1]); expect(second).not.toBe(first);
    await page.mouse.move(2, 2); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.locator('[data-item-id="throw"]').dispatchEvent('pointerup', { pointerType: 'touch' }); await page.getByRole('tooltip').filter({ hasText: '$52K' }).waitFor();
    await page.evaluate(() => window.__raceBarFixture.action('play')); await page.getByRole('tooltip').filter({ hasText: '$53K' }).waitFor();
    await page.evaluate(() => window.__raceBarFixture.action('pause')); await settled(page);
    await page.locator('[data-item-id="throw"]').dispatchEvent('pointerup', { pointerType: 'touch' }); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  } finally { await close(page); }
}, 30_000);
browserTest('timeline capture/snap and native range keyboard requests work in controlled mode without feedback', async () => {
  const page = await mount(1100, false, true);
  try {
    await page.evaluate(() => window.__raceBarFixture.controlled(true)); const slider = page.getByRole('slider', { name: 'Period' }); const box = await slider.boundingBox();
    await page.mouse.move(box!.x + box!.width * .2, box!.y + 10); await page.mouse.down(); await page.mouse.move(box!.x + box!.width * .55, box!.y + 10); await page.mouse.up();
    await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(6);
    await slider.press('ArrowUp'); await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(7);
    await slider.press('Home'); await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(0);
    await page.evaluate(() => window.__raceBarFixture.reject(true)); await page.waitForFunction(() => window.__raceBarFixture.state().rejected);
    await page.evaluate(() => { window.__raceBarFixture.action('seek', 8); window.__raceBarFixture.action('play'); });
    await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(0); expect(await page.evaluate(() => window.__raceBarFixture.state().playing)).toBe(false);
    await page.evaluate(() => window.__raceBarFixture.reject(false)); await page.waitForFunction(() => !window.__raceBarFixture.state().rejected);
    await page.evaluate(() => { const slider = document.querySelector<HTMLInputElement>('.zero-race-bar__range')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '4.8'); slider.dispatchEvent(new Event('input', { bubbles: true })); });
    await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(5);
  } finally { await close(page); }
}, 30_000);
browserTest('reactive replacements retain item/period identity, hide retired selection and clear empty/single history', async () => {
  const page = await mount(1100, false, true);
  try {
    await seek(page, 5); const row = await page.locator('[data-item-id="oak"]').elementHandle();
    await page.evaluate(() => { const data = window.__raceBarFixture.reference(); window.__raceBarFixture.data({ ...data, frames: [{ id: '2025', period: 'Earlier', values: {} }, ...data.frames] }); });
    await settled(page); expect(await page.getByRole('slider', { name: 'Period' }).getAttribute('aria-valuetext')).toBe('June'); expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(6);
    expect(await row!.evaluate(element => element === document.querySelector('[data-item-id="oak"]'))).toBe(true);
    await page.locator('[data-item-id="oak"]').dispatchEvent('pointerup', { pointerType: 'touch' }); await page.getByRole('tooltip').waitFor();
    await page.evaluate(() => { window.__raceBarFixture.data({ items: [{ id: 'fresh', label: 'Fresh' }], frames: [{ period: 'Today', values: { fresh: 1 } }] }); });
    await settled(page); await page.getByRole('tooltip').waitFor({ state: 'hidden' }); await page.locator('[data-item-id="fresh"]').hover(); await page.getByRole('tooltip').filter({ hasText: 'Fresh' }).waitFor();
    await page.evaluate(() => window.__raceBarFixture.data({ items: [], frames: [] })); await settled(page); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    expect(await page.locator('.zero-race-bar__row').count()).toBe(0); expect(await page.locator('.zero-race-bar__period').textContent()).toBe('');
  } finally { await close(page); }
}, 30_000);
browserTest('chrome toggles do not reset period/playback and offscreen/explicit pause/teardown retire frames correctly', async () => {
  const page = await mount();
  try {
    await seek(page, 5); await page.evaluate(() => window.__raceBarFixture.settings({ showControls: false })); await settled(page);
    expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(5);
    await page.evaluate(() => window.__raceBarFixture.settings({ showControls: true, showTimeline: false })); await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    expect(await page.getByRole('slider').count()).toBe(0); await page.evaluate(() => window.__raceBarFixture.settings({ showTimeline: true })); await page.getByRole('slider').waitFor();
    expect(await page.getByRole('slider', { name: 'Period' }).getAttribute('aria-valuetext')).toBe('June');
    await page.evaluate(() => { window.__raceBarFixture.action('play'); document.querySelector<HTMLElement>('[data-testid="card"]')!.style.marginTop = '10000px'; });
    await page.waitForFunction(() => document.querySelector('.zero-race-bar__plot')?.getAttribute('data-running') === 'false');
    const hidden = Number(await page.locator('.zero-race-bar__plot').getAttribute('data-position'));
    await page.evaluate(() => { window.__raceBarFixture.action('pause'); document.querySelector<HTMLElement>('[data-testid="card"]')!.style.marginTop = ''; });
    await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().playing)).toBe(false); expect(Number(await page.locator('.zero-race-bar__plot').getAttribute('data-position'))).toBeCloseTo(Math.round(hidden), 0);
    await page.evaluate(() => window.__raceBarFixture.unmount()); await page.locator('[data-slot="race-bar-chart"]').waitFor({ state: 'detached' }); expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('zero and tiny positive domains produce finite geometry and token overrides reach portal/paint', async () => {
  const page = await mount(390, false, true);
  try {
    await page.evaluate(() => { window.__raceBarFixture.data({ items: [{ id: 'a', label: 'Tiny' }, { id: 'b', label: 'Other' }], frames: [{ period: 'Now', values: { a: 1e-300, b: 5e-301 } }] });
      document.documentElement.style.setProperty('--zero-race-bar-series-1', '#ff00aa'); document.documentElement.style.setProperty('--zero-race-bar-inspector-radius', '19px'); });
    await settled(page); expect(await page.locator('[data-item-id="a"] .zero-race-bar__bar').evaluate(element => parseFloat((element as HTMLElement).style.width))).toBeGreaterThan(100);
    await page.locator('[data-item-id="a"]').dispatchEvent('pointerup', { pointerType: 'touch' }); await page.getByRole('tooltip').waitFor();
    expect(await page.locator('.zero-race-bar__tooltip').evaluate(element => getComputedStyle(element).borderRadius)).toBe('19px');
    await page.evaluate(() => window.__raceBarFixture.data({ items: [{ id: 'a' }], frames: [{ period: 'Zero', values: { a: 0 } }] })); await settled(page);
    expect(await page.locator('.zero-race-bar__tick').count()).toBe(0); expect(await page.locator('[data-item-id="a"] .zero-race-bar__bar').getAttribute('style')).toContain('width: 0px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await close(page); }
}, 30_000);
browserTest('normal motion cropped reference preview contains ranking, totals, legend, timeline and default inspector', async () => {
  const page = await mount(1100, true);
  try {
    await seek(page, 5); await page.locator('[data-item-id="oak"] .zero-race-bar__bar').hover(); await page.getByRole('tooltip').filter({ hasText: 'Oak dining table' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.zero-race-bar__tooltip')?.getAnimations().some(animation => animation.playState === 'running'));
    await page.locator('.zero-race-bar__tooltip').evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
    expect(await page.locator('.zero-race-bar__tooltip').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    expect(await page.locator('.zero-race-bar__plot').evaluate(element => getComputedStyle(element).isolation)).toBe('isolate');
    await Bun.write(join(artifacts, 'preview-surface.json'), JSON.stringify(await page.locator('.zero-race-bar__tooltip').evaluate(element => {
      const result = []; for (let node: Element | null = element; node; node = node.parentElement) { const style = getComputedStyle(node);
        result.push({ tag: node.tagName, class: node.className, opacity: style.opacity, background: style.backgroundColor, filter: style.filter,
          card: style.getPropertyValue('--card'), zeroSurface: style.getPropertyValue('--zero-chart-surface'), tipSurface: style.getPropertyValue('--zero-tooltip-background') }); } return result;
    }), null, 2));
    await page.getByTestId('card').screenshot({ path: join(artifacts, 'preview.png') });
  } finally { await close(page); }
}, 30_000);
browserTest('autoplay waits for usable visible history and reduced motion keeps manual stepping available', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__raceBarFixture.data({ items: [], frames: [] }); window.__raceBarFixture.settings({ autoPlay: true }); });
    await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().playing)).toBe(false);
    await page.evaluate(() => window.__raceBarFixture.data(window.__raceBarFixture.reference()));
    await page.waitForFunction(() => window.__raceBarFixture.state().playing); await page.waitForFunction(() => Number(document.querySelector('.zero-race-bar__plot')?.getAttribute('data-position')) > .05);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => !window.__raceBarFixture.state().playing); await settled(page);
    await seek(page, 4); expect(await page.evaluate(() => window.__raceBarFixture.state().frame)).toBe(4);
  } finally { await close(page); }
}, 30_000);
browserTest('scoped font and palette tokens remeasure geometry without creating page overflow', async () => {
  const page = await mount(390, true, true);
  try {
    await page.evaluate(() => { const card = document.querySelector<HTMLElement>('[data-testid="card"]')!;
      card.style.setProperty('--zero-race-bar-name-size', '18px'); card.style.setProperty('--zero-race-bar-value-size', '20px'); card.style.setProperty('--zero-race-bar-series-1', '#00ffaa');
      window.__raceBarFixture.data({ items: [{ id: 'long', label: 'A very long item label '.repeat(20) }], frames: [{ id: 'long-period', period: 'A very long period '.repeat(20), values: { long: 1e308 } }] });
      window.__raceBarFixture.settings({ formatValue: value => value.toLocaleString('en-US') }); });
    await settled(page); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const value = page.locator('[data-item-id="long"] .zero-race-bar__value'); expect(await value.evaluate(element => getComputedStyle(element).fontSize)).toBe('20px');
    await page.locator('[data-item-id="long"]').dispatchEvent('pointerup', { pointerType: 'touch' }); await page.getByRole('tooltip').waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await close(page); }
}, 30_000);
browserTest('non-loop end and callback-driven unmount cannot leave a second presentation clock alive', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__raceBarFixture.settings({ frameDuration: 100 })); await seek(page, 10); await page.evaluate(() => window.__raceBarFixture.action('play'));
    await page.waitForFunction(() => !window.__raceBarFixture.state().playing); await settled(page);
    await page.waitForFunction(() => window.__raceBarPendingFrames() === 0);
    await page.evaluate(() => { window.__raceBarFixture.action('replay'); window.__raceBarFixture.unmount(); });
    await page.locator('[data-slot="race-bar-chart"]').waitFor({ state: 'detached' }); await page.waitForFunction(() => window.__raceBarPendingFrames() === 0);
    expect(await page.evaluate(() => window.__raceBarPendingFrames())).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('observed frame callbacks may pause and synchronously retire their chart without re-emitting or reviving frames', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__raceBarFixture.observedAction('pause'); window.__raceBarFixture.action('seek', 5); });
    await settled(page); expect(await page.evaluate(() => window.__raceBarFixture.state().playing)).toBe(false);
    const observed = await page.evaluate(() => window.__raceBarFixture.state().observed); expect(observed.filter(index => index === 1).length).toBe(1);
    await page.evaluate(() => { window.__raceBarFixture.observedAction('unmount'); window.__raceBarFixture.action('seek', 0); });
    await page.locator('[data-slot="race-bar-chart"]').waitFor({ state: 'detached' }); await page.waitForFunction(() => window.__raceBarPendingFrames() === 0);
  } finally { await close(page); }
}, 30_000);
