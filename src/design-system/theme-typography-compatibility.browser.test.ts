/** Native computed-style checks for existing specialized consumers; no app configuration, data or font downloads. */
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
  const compiler = await compile(await Bun.file(url).text(), { base: new URL('../frontend/styles/', import.meta.url).pathname,
    from: url.pathname, onDependency() {} });
  legacyCss = compiler.build([]);
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

const consumers = '<div class="zero-modal"><h2 class="zero-modal__title">Managed modal</h2><p class="zero-modal__description">Modal detail</p></div>' +
  '<div class="zero-tooltip">Hint<div class="zero-tooltip-title">Hint title</div><div class="zero-tooltip-mono">Technical hint</div></div>' +
  '<figure class="zero-native-chart"><div class="zero-native-chart__title">Chart title</div><div class="zero-native-chart__sub">Chart label</div>' +
  '<div class="zero-native-chart__footer">Chart metadata</div><div class="zero-native-chart__tooltip"><div class="value">1,234</div></div></figure>' +
  '<ul class="zero-dense-list"><li><span class="zero-dense-list__title">List title</span><span class="zero-dense-list__description">List detail</span></li></ul>' +
  '<div class="zero-code-block"><pre class="shiki">const value = 1;</pre></div>';

async function mount(): Promise<Page> {
  const page = await lease!.browser.newPage({ colorScheme: 'light', viewport: { width: 1000, height: 700 } });
  await page.setContent('<!doctype html><html><body><section id="legacy">' + consumers + '</section>' +
    '<section id="next" data-zero-theme="next" data-zero-mode="light">' + consumers + '</section></body></html>');
  await page.addStyleTag({ content: legacyCss });
  return page;
}
async function type(page: Page, selector: string) {
  return page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, leading: style.lineHeight, weight: style.fontWeight, tracking: style.letterSpacing,
      family: style.fontFamily, numeric: style.fontVariantNumeric };
  });
}

browserTest('new typography bridges preserve existing specialized text and leave unopted consumers unchanged', async () => {
  const page = await mount();
  try {
    const untouched = await type(page, '#legacy .zero-modal__title');
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    expect(await type(page, '#legacy .zero-modal__title')).toEqual(untouched);
    expect(await type(page, '#next .zero-modal__title')).toMatchObject({ size: '16.32px', leading: '22.032px', weight: '600', tracking: '-0.1632px' });
    expect(await type(page, '#next .zero-modal')).toMatchObject({ size: '14px', leading: '21px' });
    expect(await type(page, '#next .zero-tooltip')).toMatchObject({ size: '12.5px', leading: '17.5px', weight: '500' });
    expect(await type(page, '#next .zero-tooltip-title')).toMatchObject({ weight: '600' });
    expect(await type(page, '#next .zero-tooltip-mono')).toMatchObject({ size: '12px', leading: '17.4px' });
    expect(await type(page, '#next .zero-native-chart__title')).toMatchObject({ size: '14px', weight: '500' });
    expect(await type(page, '#next .zero-native-chart__sub')).toMatchObject({ size: '12.5px' });
    expect(await type(page, '#next .zero-native-chart__footer')).toMatchObject({ size: '11.5px' });
    expect(await type(page, '#next .zero-native-chart__tooltip')).toMatchObject({ size: '12px', leading: '17.4px' });
    expect(await type(page, '#next .zero-native-chart__tooltip .value')).toMatchObject({ size: '17px', leading: '22.1px', numeric: 'tabular-nums' });
    expect(await type(page, '#next .zero-dense-list__title')).toMatchObject({ size: '14px', leading: '19.6px', weight: '500' });
    expect(await type(page, '#next .zero-dense-list__description')).toMatchObject({ size: '13px', leading: '18.85px' });
    expect(await type(page, '#next .shiki')).toMatchObject({ size: '13px', leading: '22.75px' });
  } finally { await page.close(); }
}, 30_000);

browserTest('boundary role updates reach existing consumers while local component and old inspector aliases stay usable', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    await page.locator('#next').evaluate(element => {
      const style = (element as HTMLElement).style;
      style.setProperty('--zero-type-modal-title-size', '24px'); style.setProperty('--zero-type-tooltip-size', '18px');
      style.setProperty('--zero-type-analytical-label-size', '20px'); style.setProperty('--zero-type-list-title-size', '16px');
      style.setProperty('--zero-type-technical-leading', '1.9'); style.setProperty('--zero-theme-inspector-size', '13px');
      style.setProperty('--zero-theme-font-body', 'monospace');
    });
    expect(await type(page, '#next .zero-modal__title')).toMatchObject({ size: '24px', family: 'monospace' });
    expect(await type(page, '#next .zero-tooltip')).toMatchObject({ size: '18px', family: 'monospace' });
    expect(await type(page, '#next .zero-native-chart__sub')).toMatchObject({ size: '20px', family: 'monospace' });
    expect(await type(page, '#next .zero-dense-list__title')).toMatchObject({ size: '16px' });
    expect(await type(page, '#next .shiki')).toMatchObject({ leading: '24.7px' });
    expect(await type(page, '#next .zero-native-chart__tooltip')).toMatchObject({ size: '13px' });
    await page.locator('#next').evaluate(element => (element as HTMLElement).style.setProperty('--zero-type-inspector-size', '15px'));
    expect(await type(page, '#next .zero-native-chart__tooltip')).toMatchObject({ size: '15px' });
    await page.locator('#next .zero-tooltip').evaluate(element => (element as HTMLElement).style.setProperty('--zero-tooltip-font-size', '21px'));
    expect(await type(page, '#next .zero-tooltip')).toMatchObject({ size: '21px' });
    expect(await type(page, '#legacy .zero-tooltip')).toMatchObject({ size: '12.5px' });
  } finally { await page.close(); }
}, 30_000);
