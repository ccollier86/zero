/** Browser qualification uses isolated synthetic cohorts; it does not boot an app, DB, provider, query or production service. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import type * as React from 'react';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { renderThemeFoundationCss } from '../../../design-system/theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/funnel-chart';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true }); const directory = await mkdtemp(join(scratch, 'funnel-browser-'));
  try {
    const output = join(directory, 'fixture.js'), process = Bun.spawn([globalThis.process.execPath, '--no-env-file', 'build', import.meta.dir + '/funnel-chart.browser-fixture.tsx', '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    if (code !== 0) throw new Error('Funnel fixture build failed: ' + (stderr || stdout));
    bundle = await Bun.file(output).text(); css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); await mkdir(artifacts, { recursive: true });
}, 60_000);
afterAll(() => lease?.release());
async function mount(width = 1100, dark = false, reduced = true) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message)); page.setDefaultTimeout(6000);
  await page.setContent(`<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"${dark ? ' class="dark"' : ''}><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Funnel chart fixture' }).waitFor();
  await page.waitForFunction(() => !!window.__funnelFixture && document.querySelector('.zero-funnel__plot')?.hasAttribute('data-growth')); return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
async function settled(page: Page) { await page.waitForFunction(() => document.querySelector('.zero-funnel__plot')?.getAttribute('data-settling') === 'false'); }

browserTest('next mode density and public marker changes repaint Funnel cached bands without retiring active stages', async () => {
  const page = await mount();
  try {
    await settled(page); await page.addStyleTag({ content: renderThemeFoundationCss() + '\n[data-zero-density="touch"]{--zero-funnel-tint:.63}\n[data-zero-surface="public"]{--zero-funnel-tint:.81}\n[data-zero-page="public"]{--zero-funnel-tint:.9}' });
    const first = await page.locator('[data-stage-id="visit"]').elementHandle(); await page.evaluate(() => window.__funnelFixture.inspect('cart'));
    const band = page.locator('.zero-funnel__svg path[data-segment-id="mobile"]').first();
    const matchesResolvedTokens = async () => page.waitForFunction(() => {
      const figure = document.querySelector('.zero-funnel')!, css = getComputedStyle(figure), probe = document.querySelector('.zero-funnel__probe')!;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d')!;
      const read = (index: number) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(probe.children[index]!).color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const surface = read(0), series = read(2), tint = Number.parseFloat(css.getPropertyValue('--zero-funnel-tint'));
      const expected = `rgb(${surface.map((value, index) => Math.round(value + (series[index]! - value) * tint)).join(',')})`;
      return document.querySelector('.zero-funnel__svg path[data-segment-id="mobile"]')?.getAttribute('fill') === expected;
    });
    await page.getByTestId('card').evaluate(element => { element.setAttribute('data-zero-theme', 'next'); element.setAttribute('data-zero-mode', 'light'); }); await matchesResolvedTokens();
    const light = await band.getAttribute('fill'); await page.getByTestId('card').evaluate(element => element.setAttribute('data-zero-mode', 'dark')); await matchesResolvedTokens();
    expect(await band.getAttribute('fill')).not.toBe(light);
    for (const [name, value] of [['data-zero-density', 'touch'], ['data-zero-surface', 'public'], ['data-zero-page', 'public']] as const) {
      const before = await band.getAttribute('fill'); await page.getByTestId('card').evaluate((element, values) => element.setAttribute(values[0]!, values[1]!), [name, value]); await matchesResolvedTokens();
      expect(await band.getAttribute('fill')).not.toBe(before);
    }
    await page.getByTestId('card').evaluate(element => { element.setAttribute('data-zero-mode', 'system'); element.removeAttribute('data-zero-density'); element.removeAttribute('data-zero-surface'); element.removeAttribute('data-zero-page'); });
    await page.emulateMedia({ colorScheme: 'light' }); await matchesResolvedTokens(); expect(await band.getAttribute('fill')).toBe(light);
    await page.emulateMedia({ colorScheme: 'dark' }); await matchesResolvedTokens(); expect(await band.getAttribute('fill')).not.toBe(light);
    expect(await first!.evaluate(element => element === document.querySelector('[data-stage-id="visit"]'))).toBe(true);
    expect(await page.evaluate(() => window.__funnelFixture.state().active)).toBe('cart');
    await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
    await page.evaluate(() => window.__funnelFixture.unmount()); await page.locator('.zero-funnel').waitFor({ state: 'detached' });
    await page.getByTestId('card').evaluate(element => element.setAttribute('data-zero-mode', 'light')); await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' }); expect(await page.evaluate(() => window.__funnelPendingFrames())).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('Funnel presentation changes preserve flowing particles and the in-flight count clock', async () => {
  const page = await mount(1100, false, false);
  try {
    await page.addStyleTag({ content: '[data-zero-mode="dark"]{--zero-chart-blue:#ff00aa}' });
    await page.waitForFunction(() => Number(document.querySelector('.zero-funnel__plot')?.getAttribute('data-particles')) > 10);
    const after = await page.evaluate(async () => {
      const plot = document.querySelector('.zero-funnel__plot')!, before = Number(plot.getAttribute('data-particles'));
      document.querySelector('[data-testid="card"]')!.setAttribute('data-zero-mode', 'dark');
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      document.fonts.dispatchEvent(new Event('loadingdone'));
      return { before, after: Number(plot.getAttribute('data-particles')) };
    });
    expect(after.after).toBe(after.before); expect(after.after).toBeGreaterThan(10);
    expect(await page.locator('.zero-funnel__plot').getAttribute('data-growth')).not.toBe('0');
    await page.evaluate(() => window.__funnelFixture.unmount()); await page.locator('.zero-funnel').waitFor({ state: 'detached' }); await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
  } finally { await close(page); }
}, 30_000);
for (const [width, dark, name] of [[1100, false, 'light'], [1100, true, 'dark'], [390, false, 'phone-light'], [390, true, 'phone-dark']] as const) {
  browserTest(`reference Funnel anatomy, shared token palette and bounded ${name} layout`, async () => {
    const page = await mount(width, dark);
    try {
      await settled(page); expect(await page.locator('.zero-funnel__step').count()).toBe(5); expect(await page.locator('.zero-funnel__svg g').count()).toBe(2);
      expect(await page.locator('.zero-funnel__subtitle').textContent()).toBe('Last 30 days, 3.7% convert');
      expect(await page.locator('.zero-funnel__plot').getAttribute('data-orientation')).toBe(width < 500 ? 'vertical' : 'horizontal');
      expect(await page.getByRole('table', { name: 'Checkout funnel, Last 30 days' }).count()).toBe(1);
      expect(await page.getByRole('switch', { name: 'Flow' }).getAttribute('aria-checked')).toBe('true');
      expect(await page.locator('.zero-funnel').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-chart-blue').trim())).toBe(dark ? '#3987e5' : '#2a78d6');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: join(artifacts, name + '.png'), fullPage: true }); if (name === 'light') await page.getByTestId('card').screenshot({ path: join(artifacts, 'preview.png') });
    } finally { await close(page); }
  }, 30_000);
}
browserTest('total split and isolation preserve stage/segment identities and exact observed inspectors', async () => {
  const page = await mount();
  try {
    const first = await page.locator('[data-stage-id="visit"]').elementHandle(); const totalPaths = await page.locator('.zero-funnel__svg g').evaluateAll(elements => [...elements[0]!.children].map(element => element.getAttribute('d')));
    await page.getByRole('switch', { name: 'Split', exact: true }).click(); await settled(page);
    expect(await page.locator('.zero-funnel').getAttribute('data-view')).toBe('split');
    const splitPaths = await page.locator('.zero-funnel__svg g').evaluateAll(elements => [...elements[0]!.children].map(element => element.getAttribute('d'))); expect(splitPaths).not.toEqual(totalPaths);
    await page.evaluate(() => window.__funnelFixture.inspect('cart')); await page.getByRole('tooltip').filter({ hasText: '16,700' }).waitFor();
    expect(await page.getByRole('tooltip').textContent()).toContain('Mobile9,600Desktop7,100Total16,700');
    expect(await page.locator('.zero-funnel__tooltip').evaluate(element => !element.closest('figure'))).toBe(true);
    await page.screenshot({ path: join(artifacts, 'split-inspection.png'), fullPage: true });
    await page.getByRole('button', { name: 'Mobile', exact: true }).click(); await settled(page);
    expect(await page.locator('.zero-funnel__subtitle').textContent()).toBe('Last 30 days, 2.3% convert');
    expect(await page.locator('[data-stage-id="visit"] .zero-funnel__value').textContent()).toBe('70.2K');
    expect(await first!.evaluate(element => element === document.querySelector('[data-stage-id="visit"]'))).toBe(true);
    await page.evaluate(() => window.__funnelFixture.inspect('buy')); await page.getByRole('tooltip').filter({ hasText: '1,600' }).waitFor();
    await page.screenshot({ path: join(artifacts, 'isolated-inspection.png'), fullPage: true });
  } finally { await close(page); }
}, 30_000);
browserTest('controlled requests accept or reject view flow and stage changes without hidden mutations', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__funnelFixture.controlled(true); window.__funnelFixture.reject(true); });
    await page.getByRole('button', { name: 'Mobile', exact: true }).click(); await page.getByRole('switch', { name: 'Flow', exact: true }).click();
    await page.evaluate(() => window.__funnelFixture.inspect('buy')); await settled(page);
    expect(await page.evaluate(() => window.__funnelFixture.state().view)).toEqual({ kind: 'total' }); expect(await page.evaluate(() => window.__funnelFixture.state().flow)).toBe(true);
    expect(await page.evaluate(() => window.__funnelFixture.state().active)).toBeNull();
    await page.evaluate(() => window.__funnelFixture.reject(false)); await page.getByRole('button', { name: 'Desktop', exact: true }).click();
    await page.getByRole('switch', { name: 'Flow', exact: true }).click(); await page.evaluate(() => window.__funnelFixture.inspect('cart')); await settled(page);
    // An already-settled static paint is not evidence that React has committed
    // the parent's controlled response to an imperative ref request.
    await page.waitForFunction(() => window.__funnelFixture.state().active === 'cart');
    expect(await page.evaluate(() => window.__funnelFixture.state())).toMatchObject({ view: { kind: 'segment', id: 'desktop' }, flow: false, active: 'cart' });
  } finally { await close(page); }
}, 30_000);
browserTest('keyboard inspection announces discrete exact rates and supports custom/hidden Zero inspectors', async () => {
  const page = await mount();
  try {
    await page.locator('.zero-funnel__plot').focus(); await page.keyboard.press('End'); await page.getByRole('tooltip').filter({ hasText: 'Purchased' }).waitFor();
    expect(await page.locator('[aria-live="polite"]').textContent()).toContain('Purchased, 3,700 sessions, 44% kept from Started checkout, 3.7% of the first step.');
    await page.evaluate(() => window.__funnelFixture.tooltip('custom')); await page.getByTestId('custom-inspector').filter({ hasText: 'Custom Purchased: 3700' }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.__funnelFixture.tooltip('hidden'); window.__funnelFixture.inspect('visit'); }); expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('press and drag inspects vertical stages, delayed release cleanup survives unmount', async () => {
  const page = await mount(390);
  try {
    const plot = page.locator('.zero-funnel__plot'), box = await plot.boundingBox();
    await plot.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: box!.x + 30, clientY: box!.y + 20 });
    await page.getByRole('tooltip').filter({ hasText: 'Visited store' }).waitFor();
    await plot.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 7, buttons: 1, clientX: box!.x + 30, clientY: box!.y + box!.height - 20 });
    await page.getByRole('tooltip').filter({ hasText: 'Purchased' }).waitFor();
    await plot.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7 }); await page.evaluate(() => window.__funnelFixture.unmount());
    await page.locator('[data-slot="funnel-chart"]').waitFor({ state: 'detached' }); await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
  } finally { await close(page); }
}, 30_000);
browserTest('animated view changes retarget current thickness and bounded particles suspend offscreen/hidden', async () => {
  const page = await mount(1100, false, false);
  try {
    await page.waitForFunction(() => Number(document.querySelector('.zero-funnel__plot')?.getAttribute('data-growth')) > .95);
    await page.waitForFunction(() => Number(document.querySelector('.zero-funnel__plot')?.getAttribute('data-particles')) > 0);
    await page.evaluate(() => { window.__funnelFixture.flow(false); window.__funnelFixture.view({ kind: 'split' }); });
    const initial = await page.locator('.zero-funnel__svg').innerHTML(); await page.waitForFunction(previous => document.querySelector('.zero-funnel__svg')?.innerHTML !== previous, initial);
    await page.evaluate(() => window.__funnelFixture.view({ kind: 'segment', id: 'mobile' })); await settled(page);
    expect(await page.locator('.zero-funnel__plot').getAttribute('data-particles')).toBe('0');
    await page.evaluate(() => window.__funnelFixture.flow(true)); await page.waitForFunction(() => Number(document.querySelector('.zero-funnel__plot')?.getAttribute('data-particles')) > 0);
    expect(Number(await page.locator('.zero-funnel__plot').getAttribute('data-particles'))).toBeLessThanOrEqual(40);
    await page.evaluate(() => { document.querySelector<HTMLElement>('[data-testid="card"]')!.style.marginTop = '1600px'; });
    await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
    await page.evaluate(() => { document.querySelector<HTMLElement>('[data-testid="card"]')!.style.marginTop = '24px'; });
    await page.waitForFunction(() => window.__funnelPendingFrames() > 0);
    await page.evaluate(() => window.__funnelFixture.unmount()); await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
  } finally { await close(page); }
}, 30_000);
browserTest('reactive replacement keeps stage IDs, masks retired choices and clears empty/zero geometry', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__funnelFixture.view({ kind: 'segment', id: 'desktop' }); window.__funnelFixture.inspect('cart'); }); await settled(page);
    const step = await page.locator('[data-stage-id="cart"]').elementHandle();
    await page.evaluate(() => { const data = window.__funnelFixture.reference(); window.__funnelFixture.data({ ...data, segments: [...data.segments!].reverse() }); }); await settled(page);
    expect(await step!.evaluate(element => element === document.querySelector('[data-stage-id="cart"]'))).toBe(true);
    expect(await page.getByRole('tooltip').textContent()).toContain('Desktop7,100');
    await page.evaluate(() => window.__funnelFixture.data({ stages: [{ id: 'fresh', value: 0 }] })); await settled(page);
    expect(await page.locator('.zero-funnel').getAttribute('data-view')).toBe('total'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    expect(await page.locator('.zero-funnel__svg path').evaluateAll(paths => paths.every(path => path.getAttribute('d') === 'M0,0'))).toBe(true);
    await page.evaluate(() => window.__funnelFixture.data({ stages: [] })); await settled(page);
    expect(await page.locator('.zero-funnel__step').count()).toBe(0); await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
    await page.evaluate(() => window.__funnelFixture.data(window.__funnelFixture.reference())); await settled(page); expect(await page.locator('.zero-funnel__step').count()).toBe(5);
  } finally { await close(page); }
}, 30_000);
browserTest('scoped tokens update shared canvas/inspector roles and long/extreme finite values remain bounded', async () => {
  const page = await mount(390);
  try {
    await page.evaluate(() => { window.__funnelFixture.settings({ style: { '--zero-chart-blue': '#ff0000', '--zero-chart-inspector-radius': '15px', '--zero-chart-label-size': '13px' } as React.CSSProperties }); }); await settled(page);
    expect(await page.locator('.zero-funnel__svg path[data-segment-id="mobile"]').getAttribute('fill')).toBe('rgb(255,184,184)');
    await page.evaluate(() => window.__funnelFixture.inspect('cart')); await page.getByRole('tooltip').waitFor(); expect(await page.locator('.zero-funnel__tooltip').evaluate(element => getComputedStyle(element).borderRadius)).toBe('15px');
    await page.evaluate(() => window.__funnelFixture.data({ stages: [{ id: 'large', label: 'A very long label '.repeat(60), value: 1e308 }, { id: 'small', label: 'Smaller', value: 5e307 }] })); await settled(page);
    expect(await page.locator('.zero-funnel__subtitle').textContent()).toBe('Last 30 days, 50% convert');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { window.__funnelFixture.data({ stages: [{ id: 'tiny', value: Number.MIN_VALUE }, { id: 'less', value: Number.MIN_VALUE }] }); }); await settled(page);
    expect(await page.locator('.zero-funnel__subtitle').textContent()).toBe('Last 30 days, 100% convert'); expect(await page.locator('.zero-funnel__empty').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('batched and callback-reentrant ref requests preserve final intent in controlled and uncontrolled charts', async () => {
  const page = await mount();
  try {
    for (const controlled of [false, true]) {
      await page.evaluate(value => window.__funnelFixture.controlled(value), controlled);
      await page.evaluate(() => { window.__funnelFixture.inspect('cart'); window.__funnelFixture.clear(); window.__funnelFixture.flow(false); window.__funnelFixture.flow(true);
        window.__funnelFixture.view({ kind: 'segment', id: 'mobile' }); window.__funnelFixture.view({ kind: 'total' }); }); await settled(page);
      expect(await page.evaluate(() => window.__funnelFixture.state())).toMatchObject({ view: { kind: 'total' }, flow: true, active: null });
      await page.evaluate(() => { window.__funnelFixture.activeAction('clear'); window.__funnelFixture.inspect('buy'); }); await settled(page);
      expect(await page.evaluate(() => window.__funnelFixture.state().active)).toBeNull();
    }
  } finally { await close(page); }
}, 30_000);
browserTest('retired data cannot leave stale announcements and a new API inspector cancels old touch ownership', async () => {
  const page = await mount(390);
  try {
    await page.locator('.zero-funnel__plot').focus(); await page.keyboard.press('End'); await page.getByRole('tooltip').waitFor();
    await page.evaluate(() => window.__funnelFixture.data({ stages: [] })); await settled(page); expect(await page.locator('[aria-live="polite"]').textContent()).toBe('');
    await page.evaluate(() => window.__funnelFixture.data(window.__funnelFixture.reference())); await settled(page);
    const plot = page.locator('.zero-funnel__plot'), box = await plot.boundingBox();
    await plot.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: box!.x + 30, clientY: box!.y + 20 });
    await plot.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7 }); await page.evaluate(() => window.__funnelFixture.inspect('buy'));
    await page.waitForTimeout(1750); expect(await page.evaluate(() => window.__funnelFixture.state().active)).toBe('buy');
    await page.evaluate(() => { window.__funnelFixture.activeAction('retire'); window.__funnelFixture.inspect('cart'); });
    await page.locator('[data-slot="funnel-chart"]').waitFor({ state: 'detached' }); await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
  } finally { await close(page); }
}, 30_000);
browserTest('static motion applies to chart controls and inspectors, with pixel-perfect measured selection pill', async () => {
  const page = await mount(1100, false, false);
  try {
    await page.evaluate(() => window.__funnelFixture.settings({ motion: false })); await settled(page); await page.getByRole('button', { name: 'Desktop', exact: true }).click(); await settled(page);
    expect(await page.locator('.zero-funnel').getAttribute('data-motion')).toBe('static');
    expect(await page.locator('.zero-funnel__pill').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
    const selected = await page.getByRole('button', { name: 'Desktop', exact: true }).boundingBox(), pill = await page.locator('.zero-funnel__pill').boundingBox();
    expect(pill!.x).toBeCloseTo(selected!.x); expect(pill!.y).toBeCloseTo(selected!.y); expect(pill!.width).toBeCloseTo(selected!.width); expect(pill!.height).toBeCloseTo(selected!.height);
    await page.getByRole('switch', { name: 'Flow', exact: true }).click(); expect(await page.locator('.zero-funnel__plot').getAttribute('data-particles')).toBe('0');
    await page.evaluate(() => window.__funnelFixture.inspect('cart')); await page.getByRole('tooltip').waitFor();
    expect(await page.locator('.zero-funnel__tooltip').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-tooltip-motion-blur-enter').trim())).toBe('1ms');
  } finally { await close(page); }
}, 30_000);
browserTest('modern CSS color resolution and explicit zero tint produce the actual supplied surface paint', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__funnelFixture.settings({ style: { '--zero-chart-surface': 'oklch(0.7 0.2 40)', '--zero-funnel-tint': '0' } as React.CSSProperties })); await settled(page);
    const expected = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d')!;
      context.fillStyle = 'oklch(0.7 0.2 40)'; context.fillRect(0, 0, 1, 1); return `rgb(${Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(',')})`; });
    expect(await page.locator('.zero-funnel__svg path[data-segment-id="mobile"]').getAttribute('fill')).toBe(expected);
    await page.evaluate(() => window.__funnelFixture.inspect('cart')); await page.getByRole('tooltip').waitFor();
    await page.evaluate(() => { document.querySelector<HTMLElement>('[data-testid="card"]')!.style.width = '0px'; });
    await page.waitForFunction(() => document.querySelector('.zero-funnel__svg')?.getAttribute('width') === '0'); expect(await page.locator('.zero-funnel__svg').getAttribute('width')).toBe('0');
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  } finally { await close(page); }
}, 30_000);
browserTest('zeroing existing cohorts immediately clears rolling counts, rates and the animated clock', async () => {
  const page = await mount(1100, false, false);
  try {
    await page.waitForFunction(() => Number(document.querySelector('.zero-funnel__plot')?.getAttribute('data-growth')) > .6);
    await page.evaluate(() => { const data = window.__funnelFixture.reference(); window.__funnelFixture.data({ ...data,
      stages: data.stages.map(stage => ({ ...stage, values: { mobile: 0, desktop: 0 } })) }); }); await settled(page);
    expect(await page.locator('.zero-funnel__value').allTextContents()).toEqual(['0', '0', '0', '0', '0']);
    expect(await page.locator('.zero-funnel__subtitle').textContent()).toBe('Last 30 days, — convert');
    expect(await page.locator('.zero-funnel__svg path').evaluateAll(paths => paths.every(path => path.getAttribute('d') === 'M0,0'))).toBe(true);
    await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
    await page.evaluate(() => { const data = window.__funnelFixture.reference(); window.__funnelFixture.data({ ...data,
      stages: data.stages.map(stage => ({ ...stage, values: { mobile: stage.values!.mobile!, desktop: 0 } })) }); window.__funnelFixture.view({ kind: 'segment', id: 'desktop' }); });
    await settled(page); expect(await page.locator('.zero-funnel__value').allTextContents()).toEqual(['0', '0', '0', '0', '0']);
    await page.waitForFunction(() => window.__funnelPendingFrames() === 0);
  } finally { await close(page); }
}, 30_000);
browserTest('controlled rejected requests remain retryable without a confirming parent render', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => { window.__funnelFixture.controlled(true); window.__funnelFixture.reject(true); });
    const before = await page.evaluate(() => window.__funnelFixture.state().requests.length);
    for (let index = 0; index < 2; index++) { await page.getByRole('button', { name: 'Mobile', exact: true }).click(); await page.getByRole('switch', { name: 'Flow', exact: true }).click(); }
    expect((await page.evaluate(() => window.__funnelFixture.state().requests.length)) - before).toBe(4);
    expect(await page.evaluate(() => window.__funnelFixture.state().view)).toEqual({ kind: 'total' });
  } finally { await close(page); }
}, 30_000);
for (const width of [1100, 390]) browserTest(`last-stage inspector stays inside ${width < 500 ? 'vertical' : 'horizontal'} plot boundaries when it fits`, async () => {
  const page = await mount(width);
  try {
    await page.evaluate(() => window.__funnelFixture.inspect('buy')); await page.getByRole('tooltip').waitFor();
    const plot = await page.locator('.zero-funnel__plot').boundingBox(), tip = await page.locator('.zero-funnel__tooltip').boundingBox();
    expect(tip!.x).toBeGreaterThanOrEqual(plot!.x); expect(tip!.y).toBeGreaterThanOrEqual(plot!.y);
    expect(tip!.x + tip!.width).toBeLessThanOrEqual(plot!.x + plot!.width + 1); expect(tip!.y + tip!.height).toBeLessThanOrEqual(plot!.y + plot!.height + 1);
    if (width >= 500) { const column = await page.locator('.zero-funnel__column').boundingBox();
      expect(tip!.x + tip!.width).toBeLessThanOrEqual(column!.x - 8 + 1); }
  } finally { await close(page); }
}, 30_000);
