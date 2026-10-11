/** Chromium native refs and Slot event/cleanup behavior over synthetic markup. */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { renderTypographyCss } from '../../design-system/theme-typography';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/typography.browser-fixture.tsx`],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
}, 60_000);

afterAll(() => lease?.release());

async function open(): Promise<Page> {
  const page = await browser!.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.locator('#slotted-title').waitFor();
  return page;
}

browserTest('native and Slot refs point at the real semantic elements without wrappers', async () => {
  const page = await open();
  try {
    expect(await page.evaluate(() => (window as any).typographyTest.snapshot())).toEqual({
      paragraphTag: 'P',
      headingTag: 'H4',
      parentLabelTag: 'LABEL',
      childLabelTag: 'LABEL',
      labelRefMatches: true,
      parentHeadingTag: 'H3',
      childHeadingTag: 'H3',
      headingRefMatches: true,
      events: [],
    });
    expect(await page.locator('#root > *').count()).toBe(5);
    expect(await page.locator('#title').getAttribute('data-zero-typography')).toBe('page');
    expect(await page.locator('#slotted-title').getAttribute('data-zero-typography')).toBe('caption');
    expect(await page.locator('#label').getAttribute('for')).toBe('field');
    await page.locator('#label').click();
    expect(await page.evaluate(() => (window as any).typographyTest.snapshot().events)).toEqual(['child', 'parent']);
    expect(await page.locator('#field').evaluate(element => element === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

browserTest('unmount clears forwarded and child refs without retained component state', async () => {
  const page = await open();
  try {
    await page.evaluate(() => (window as any).typographyTest.unmount());
    expect(await page.locator('#root').innerHTML()).toBe('');
    expect(await page.evaluate(() => (window as any).typographyTest.snapshot())).toEqual({
      paragraphTag: null,
      headingTag: null,
      parentLabelTag: null,
      childLabelTag: null,
      labelRefMatches: true,
      parentHeadingTag: null,
      childHeadingTag: null,
      headingRefMatches: true,
      events: [],
    });
  } finally { await page.close(); }
}, 30_000);

browserTest('real components consume recipes and live local families while utility and inline styles win', async () => {
  const page = await open();
  try {
    await page.addStyleTag({ content: `
      @layer base, utilities;
      body { font-size: 16px; font-family: serif; }
      ${renderTypographyCss()}
      @layer utilities {
        .app-type-override { font-size: 25px; font-family: serif; line-height: 2; font-weight: 700; letter-spacing: .2em; }
      }
    ` });
    await page.evaluate(() => {
      const root = document.getElementById('root')!;
      root.dataset.zeroTheme = 'next';
      root.style.setProperty('--zero-theme-font-body', 'monospace');
      const legacy = document.createElement('p');
      legacy.id = 'legacy-unmarked';
      legacy.textContent = 'Legacy text';
      document.body.append(legacy);
    });
    expect(await page.locator('#body').evaluate(element => ({
      size: getComputedStyle(element).fontSize,
      family: getComputedStyle(element).fontFamily,
    }))).toEqual({ size: '13px', family: 'monospace' });
    expect(await page.locator('#title').evaluate(element => getComputedStyle(element).fontSize)).toBe('28px');
    expect(await page.locator('#legacy-unmarked').evaluate(element => getComputedStyle(element).fontSize)).toBe('16px');
    await page.locator('#title').evaluate(element => {
      const title = element as HTMLElement;
      title.style.setProperty('--zero-theme-font-body', 'serif');
      title.style.setProperty('--zero-type-page-size', '2rem');
    });
    expect(await page.locator('#title').evaluate(element => ({
      size: getComputedStyle(element).fontSize,
      family: getComputedStyle(element).fontFamily,
    }))).toEqual({ size: '32px', family: 'serif' });
    await page.locator('#body').evaluate(element => element.classList.add('app-type-override'));
    expect(await page.locator('#body').evaluate(element => ({
      size: getComputedStyle(element).fontSize,
      family: getComputedStyle(element).fontFamily,
      leading: getComputedStyle(element).lineHeight,
      weight: getComputedStyle(element).fontWeight,
    }))).toEqual({ size: '25px', family: 'serif', leading: '50px', weight: '700' });
    await page.locator('#body').evaluate(element => (element as HTMLElement).style.fontSize = '31px');
    expect(await page.locator('#body').evaluate(element => getComputedStyle(element).fontSize)).toBe('31px');
  } finally { await page.close(); }
}, 30_000);
