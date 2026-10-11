/** Computed-style qualification of the opt-in foundation with synthetic probes; no live app, DB or network services. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';
import { renderThemeFoundationCss } from './theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, legacyCss = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const require = createRequire(import.meta.url);
  const { compile } = require('@tailwindcss/node') as typeof import('@tailwindcss/node');
  const url = new URL('../frontend/styles/globals.css', import.meta.url);
  const compiler = await compile(await Bun.file(url).text(), { base: new URL('../frontend/styles/', import.meta.url).pathname, from: url.pathname, onDependency() {} });
  legacyCss = compiler.build(['bg-background', 'text-foreground', 'rounded-md']);
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(scheme: 'light' | 'dark' = 'light', reduced = false, coarse = false): Promise<Page> {
  const page = await lease!.browser.newPage({ colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference',
    viewport: { width: 1000, height: 700 }, hasTouch: coarse, isMobile: coarse });
  await page.setContent('<!doctype html><html><body><main id="legacy"><div class="probe"></div></main>' +
    '<main id="next" data-zero-theme="next" data-zero-mode="light"><div class="probe"></div>' +
    '<section id="density" data-zero-density="comfortable"><div class="probe"></div></section>' +
    '<section id="public" data-zero-surface="public"><div class="probe"></div></section>' +
    '<section id="nested" data-zero-theme="next" data-zero-mode="dark"><div class="probe"></div><div id="nested-public" class="zero-public-page"></div></section></main>' +
    '<div id="portal"><div class="probe"></div></div></body></html>');
  await page.addStyleTag({ content: legacyCss + '\n.probe{background:var(--background);color:var(--foreground);border:1px solid var(--input);border-radius:var(--radius);font-family:var(--font-platform-sans)}' });
  return page;
}
async function paint(page: Page, selector: string) {
  return page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, border: style.borderColor, radius: style.borderRadius, font: style.fontFamily };
  });
}
async function tokens(page: Page, selector: string, names: string[]) {
  return page.locator(selector).evaluate((element, keys) => Object.fromEntries(keys.map(key => [key, getComputedStyle(element).getPropertyValue(key).trim()])), names);
}

browserTest('loading next CSS leaves legacy roots/siblings identical and activates only explicit boundaries', async () => {
  const page = await mount();
  try {
    const before = await paint(page, '#legacy .probe'), body = await paint(page, 'body');
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    expect(await paint(page, '#legacy .probe')).toEqual(before); expect(await paint(page, 'body')).toEqual(body);
    expect(await paint(page, '#next > .probe')).toMatchObject({ background: 'rgb(255, 255, 255)', color: 'rgb(29, 29, 29)', radius: '6px' });
    expect(await tokens(page, '#next', ['--zero-theme-control-height', '--zero-modal-background', '--zero-tooltip-neutral-background']))
      .toMatchObject({ '--zero-theme-control-height': '2rem', '--zero-modal-background': '#ffffff', '--zero-tooltip-neutral-background': '#ffffff' });
  } finally { await page.close(); }
}, 30_000);

browserTest('explicit nested palettes and live switches rebind component aliases without stale ancestor colors', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    expect(await paint(page, '#nested > .probe')).toMatchObject({ background: 'rgb(20, 20, 20)', color: 'rgb(242, 242, 242)' });
    expect(await paint(page, '#nested-public')).toMatchObject({ background: 'rgb(20, 20, 20)', color: 'rgb(242, 242, 242)', border: 'rgb(43, 43, 43)' });
    await page.locator('html').evaluate(element => element.classList.add('dark'));
    expect(await paint(page, '#next > .probe')).toMatchObject({ background: 'rgb(255, 255, 255)', color: 'rgb(29, 29, 29)' });
    await page.locator('#next').evaluate(element => element.setAttribute('data-zero-mode', 'dark'));
    expect(await paint(page, '#next > .probe')).toMatchObject({ background: 'rgb(20, 20, 20)' });
    for (const selector of ['#next', '#density', '#public']) expect(await tokens(page, selector, ['--zero-modal-background', '--zero-tooltip-neutral-background']))
      .toEqual({ '--zero-modal-background': '#1f1f1f', '--zero-tooltip-neutral-background': '#1f1f1f' });
    await page.locator('#nested').evaluate(element => element.setAttribute('data-zero-mode', 'light'));
    expect(await paint(page, '#nested > .probe')).toMatchObject({ background: 'rgb(255, 255, 255)' });
    expect(await paint(page, '#nested-public')).toMatchObject({ background: 'rgb(255, 255, 255)', color: 'rgb(29, 29, 29)' });
    expect(await tokens(page, '#nested', ['--zero-modal-background'])).toEqual({ '--zero-modal-background': '#ffffff' });
    await page.locator('#nested').evaluate(element => element.setAttribute('data-zero-mode', 'dark'));
    expect(await tokens(page, '#nested', ['--zero-data-table-progress-background', '--zero-data-table-progress-foreground', '--zero-code-ansi-white', '--zero-viz-foreground', '--zero-sankey-ink-role']))
      .toEqual({ '--zero-data-table-progress-background': '#242424', '--zero-data-table-progress-foreground': '#bdbdbd', '--zero-code-ansi-white': '#f2f2f2', '--zero-viz-foreground': '#f2f2f2', '--zero-sankey-ink-role': 'foreground' });
  } finally { await page.close(); }
}, 30_000);

browserTest('system mode responds to color preference while explicit light mode remains explicit', async () => {
  const page = await mount('dark');
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    expect(await paint(page, '#next > .probe')).toMatchObject({ background: 'rgb(255, 255, 255)' });
    await page.locator('#next').evaluate(element => element.setAttribute('data-zero-mode', 'system'));
    expect(await paint(page, '#next > .probe')).toMatchObject({ background: 'rgb(20, 20, 20)' });
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await paint(page, '#next > .probe')).toMatchObject({ background: 'rgb(255, 255, 255)' });
  } finally { await page.close(); }
}, 30_000);

browserTest('Sankey particle radius follows explicit next mode across legacy nesting and keeps caller geometry overrides', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    expect(await tokens(page, '#next', ['--zero-sankey-particle-radius'])).toEqual({ '--zero-sankey-particle-radius': '1.2' });
    expect(await tokens(page, '#nested', ['--zero-sankey-particle-radius'])).toEqual({ '--zero-sankey-particle-radius': '1.3' });
    await page.locator('html').evaluate(element => element.classList.add('dark'));
    // Legacy-dark ancestors cannot replace the explicit light-island radius.
    expect(await tokens(page, '#next', ['--zero-sankey-particle-radius'])).toEqual({ '--zero-sankey-particle-radius': '1.2' });
    expect(await tokens(page, '#nested', ['--zero-sankey-particle-radius'])).toEqual({ '--zero-sankey-particle-radius': '1.3' });
    await page.locator('#nested').evaluate(element => (element as HTMLElement).style.setProperty('--zero-sankey-particle-radius', '2.4'));
    await page.locator('#nested').evaluate(element => element.setAttribute('data-zero-mode', 'light'));
    expect(await tokens(page, '#nested', ['--zero-sankey-particle-radius'])).toEqual({ '--zero-sankey-particle-radius': '2.4' });
    await page.locator('#nested').evaluate(element => (element as HTMLElement).style.removeProperty('--zero-sankey-particle-radius'));
    expect(await tokens(page, '#nested', ['--zero-sankey-particle-radius'])).toEqual({ '--zero-sankey-particle-radius': '1.2' });
    await page.locator('#next').evaluate(element => element.setAttribute('data-zero-mode', 'system'));
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await tokens(page, '#next', ['--zero-sankey-particle-radius'])).toEqual({ '--zero-sankey-particle-radius': '1.3' });
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await tokens(page, '#next', ['--zero-sankey-particle-radius'])).toEqual({ '--zero-sankey-particle-radius': '1.2' });
    // Typography/mode admission does not retune Sankey's drawing geometry or clocks.
    expect(await tokens(page, '#nested', ['--zero-sankey-ribbon-opacity', '--zero-sankey-motion-enter', '--zero-sankey-motion-morph']))
      .toEqual({ '--zero-sankey-ribbon-opacity': '.2', '--zero-sankey-motion-enter': '1000ms', '--zero-sankey-motion-morph': '700ms' });
  } finally { await page.close(); }
}, 30_000);

browserTest('document-root activation beats legacy :root and .dark without defeating explicit app overrides', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    await page.locator('html').evaluate(element => { element.setAttribute('data-zero-theme', 'next'); element.setAttribute('data-zero-mode', 'light'); element.classList.add('dark'); });
    expect(await paint(page, '#legacy .probe')).toMatchObject({ background: 'rgb(255, 255, 255)', color: 'rgb(29, 29, 29)' });
    expect(await paint(page, 'body')).toMatchObject({ background: 'rgb(255, 255, 255)', color: 'rgb(29, 29, 29)' });
    expect(await tokens(page, 'html', ['--zero-modal-background', '--zero-tooltip-neutral-background'])).toEqual({ '--zero-modal-background': '#ffffff', '--zero-tooltip-neutral-background': '#ffffff' });
    await page.locator('html').evaluate(element => element.setAttribute('data-zero-mode', 'dark'));
    expect(await paint(page, '#legacy .probe')).toMatchObject({ background: 'rgb(20, 20, 20)', color: 'rgb(242, 242, 242)' });
    expect(await paint(page, 'body')).toMatchObject({ background: 'rgb(20, 20, 20)', color: 'rgb(242, 242, 242)' });
    await page.addStyleTag({ content: '[data-zero-theme="next"] { --zero-theme-canvas: #224466; }' });
    expect(await paint(page, '#legacy .probe')).toMatchObject({ background: 'rgb(34, 68, 102)' });
    await page.locator('html').evaluate(element => element.removeAttribute('data-zero-mode'));
    expect(await tokens(page, 'html', ['--zero-theme-text-primary'])).toEqual({ '--zero-theme-text-primary': '#f2f2f2' });
  } finally { await page.close(); }
}, 30_000);

browserTest('density changes geometry only, preserving fixed modal/tooltip/inspector sizes and explicit overrides', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    expect(await tokens(page, '#density', ['--zero-theme-control-height', '--zero-modal-radius', '--zero-tooltip-radius', '--zero-chart-inspector-radius']))
      .toEqual({ '--zero-theme-control-height': '2.25rem', '--zero-modal-radius': '14px', '--zero-tooltip-radius': '8px', '--zero-chart-inspector-radius': '10px' });
    await page.locator('#next').evaluate(element => {
      (element as HTMLElement).style.setProperty('--zero-theme-primary-fill', '#224466');
      (element as HTMLElement).style.setProperty('--zero-modal-radius', '23px');
      (element as HTMLElement).style.setProperty('--zero-tooltip-radius', '19px');
      (element as HTMLElement).style.setProperty('--zero-chart-inspector-radius', '15px');
      (element as HTMLElement).style.setProperty('--zero-modal-background', '#ddeeff');
    });
    expect(await tokens(page, '#next', ['--primary', '--zero-modal-radius'])).toEqual({ '--primary': '#224466', '--zero-modal-radius': '23px' });
    expect(await tokens(page, '#density', ['--primary'])).toEqual({ '--primary': '#224466' });
    for (const selector of ['#density', '#public']) expect(await tokens(page, selector, ['--zero-modal-radius', '--zero-tooltip-radius', '--zero-chart-inspector-radius', '--zero-modal-background']))
      .toEqual({ '--zero-modal-radius': '23px', '--zero-tooltip-radius': '19px', '--zero-chart-inspector-radius': '15px', '--zero-modal-background': '#ddeeff' });
    await page.locator('#public').evaluate(element => element.classList.add('app-public'));
    await page.addStyleTag({ content: '.app-public{--zero-modal-background:#ccddee}' });
    expect(await tokens(page, '#public', ['--zero-modal-background'])).toEqual({ '--zero-modal-background': '#ccddee' });
    await page.locator('#density').evaluate(element => element.setAttribute('data-zero-density', 'touch'));
    expect(await tokens(page, '#density', ['--zero-theme-control-height'])).toEqual({ '--zero-theme-control-height': '2.75rem' });
  } finally { await page.close(); }
}, 30_000);

browserTest('resolved custom properties can be projected into an out-of-tree overlay without color drift', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    await page.evaluate(() => {
      const source = document.querySelector('#nested')!, target = document.querySelector<HTMLElement>('#portal')!, style = getComputedStyle(source);
      for (let i = 0; i < style.length; i++) { const name = style.item(i); if (name.startsWith('--')) target.style.setProperty(name, style.getPropertyValue(name)); }
    });
    expect(await paint(page, '#portal .probe')).toEqual(await paint(page, '#nested > .probe'));
    expect(await tokens(page, '#portal', ['--zero-modal-background', '--zero-tooltip-neutral-background', '--zero-chart-blue']))
      .toEqual(await tokens(page, '#nested', ['--zero-modal-background', '--zero-tooltip-neutral-background', '--zero-chart-blue']));
  } finally { await page.close(); }
}, 30_000);

browserTest('reduced motion keeps structural/safety timing and coarse pointers get comfortable target roles', async () => {
  const page = await mount('light', true, true);
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await tokens(page, '#next', ['--zero-theme-scroll-show-duration', '--zero-theme-scroll-hide-delay', '--zero-theme-hold-confirm-duration', '--zero-theme-hit-target-min', '--zero-modal-close-target']))
      .toEqual({ '--zero-theme-scroll-show-duration': '0ms', '--zero-theme-scroll-hide-delay': '900ms', '--zero-theme-hold-confirm-duration': '1500ms', '--zero-theme-hit-target-min': '2.75rem', '--zero-modal-close-target': '44px' });
    await page.locator('#next').evaluate(element => (element as HTMLElement).style.setProperty('--zero-modal-close-target', '56px'));
    expect(await tokens(page, '#density', ['--zero-modal-close-target'])).toEqual({ '--zero-modal-close-target': '56px' });
    await page.locator('#next').evaluate(element => {
      (element as HTMLElement).style.removeProperty('--zero-modal-close-target');
      (element as HTMLElement).style.setProperty('--zero-theme-modal-close-target', '52px');
    });
    expect(await tokens(page, '#density', ['--zero-modal-close-target'])).toEqual({ '--zero-modal-close-target': '52px' });
  } finally { await page.close(); }
}, 30_000);
