/**
 * Qualifies the managed legacy/next stylesheet pipeline in a real browser.
 * Owns synthetic computed-style checks only: no application boot, service setup,
 * font download or manually appended foundation CSS is involved.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { Button } from '../../components/ui/button';
import { Heading } from '../../components/typography';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';
import { buildPlatformStyles } from './style-bundle';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
let lease: PlaywrightTestBrowserLease | undefined;
let root: string | undefined;
let legacyCss = '', nextCss = '', markup = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  await mkdir(SCRATCH, { recursive: true });
  root = await mkdtemp(join(SCRATCH, 'style-foundation-browser-'));
  const output = join(root, 'out'), absentApp = join(root, 'absent-app');
  const legacy = await buildPlatformStyles(output, absentApp, [], { themeFoundation: 'legacy' });
  legacyCss = await Bun.file(legacy.cssPath).text();
  const next = await buildPlatformStyles(output, absentApp);
  nextCss = await Bun.file(next.cssPath).text();
  // Both public hashes remain usable after the later managed build. The browser
  // receives the generated files verbatim, rather than an isolated supplement.
  expect(next.publicPath).not.toBe(legacy.publicPath);
  expect(await Bun.file(legacy.cssPath).text()).toBe(legacyCss);
  expect(await Bun.file(next.cssPath).text()).toBe(nextCss);
  expect(legacyCss).not.toContain('[data-zero-theme="next"]');
  expect(nextCss).toContain('[data-zero-theme="next"]');

  const node = React.createElement;
  markup = renderToStaticMarkup(node('main', null,
    node('section', { id: 'legacy', className: 'bg-background text-foreground' },
      node('p', { id: 'legacy-body' }, 'Legacy body'),
      node(Button, { id: 'legacy-control', animateIcon: false }, 'Legacy action'),
      node('h2', { id: 'legacy-heading' }, 'Legacy heading')),
    node('section', { id: 'next', 'data-zero-theme': 'next', 'data-zero-mode': 'light', className: 'bg-background text-foreground' },
      node('p', { id: 'next-body' }, 'Scoped body'),
      node(Button, { id: 'next-control', animateIcon: false }, 'Scoped action'),
      node(Heading, { id: 'next-heading', as: 'h1', variant: 'page' }, 'Scoped heading'),
      node('div', { id: 'local' }, node(Button, { id: 'local-control', animateIcon: false }, 'Local action')),
      node(Button, { id: 'utility-control', animateIcon: false, className: 'text-lg font-mono font-bold leading-none tracking-wide' }, 'Caller utilities'),
      node(Button, { id: 'inline-control', animateIcon: false, style: { fontSize: '23px', lineHeight: 2, fontWeight: 700, fontFamily: 'serif' } }, 'Caller style'),
      node('section', { id: 'dark', 'data-zero-theme': 'next', 'data-zero-mode': 'dark', className: 'bg-background text-foreground' },
        node('p', { id: 'dark-body' }, 'Nested dark body'),
        node(Button, { id: 'dark-control', animateIcon: false }, 'Dark action'),
        node(Heading, { id: 'dark-heading', variant: 'section' }, 'Dark heading'),
        node('section', { id: 'nested-light', 'data-zero-theme': 'next', 'data-zero-mode': 'light', className: 'bg-background text-foreground' },
          node('p', null, 'Nested light body'))))));
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);

afterAll(async () => {
  lease?.release();
  if (root) await rm(root, { recursive: true, force: true });
});

async function mount(css: string) {
  const page = await lease!.browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: 'light', reducedMotion: 'reduce' });
  // Fail closed on any unexpected external resource; all markup and CSS are
  // synthetic/in-memory and there is no font acquisition in this workflow.
  await page.route('**/*', route => route.abort());
  await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
  const stylesheet = await page.addStyleTag({ content: css });
  await settle(page);
  return { page, stylesheet };
}

async function settle(page: Page) {
  // Keep the Button's existing motion intact, then sample its completed native
  // transition rather than an intermediate inherited typography value.
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}

async function computed(page: Page, selector: string) {
  return page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, leading: style.lineHeight, weight: style.fontWeight, family: style.fontFamily,
      tracking: style.letterSpacing, numeric: style.fontVariantNumeric,
      background: style.backgroundColor, color: style.color, scheme: style.colorScheme,
      foundationCanvas: style.getPropertyValue('--zero-theme-canvas').trim() };
  });
}

browserTest('managed next CSS computes scoped typography and nested modes without activating legacy siblings', async () => {
  const { page, stylesheet } = await mount(legacyCss);
  try {
    const untouched = ['html', 'body', '#legacy', '#legacy-body', '#legacy-control', '#legacy-heading'];
    const before = await Promise.all(untouched.map(selector => computed(page, selector)));
    expect(await computed(page, '#legacy-control')).toMatchObject({ size: '14px', leading: '20px', weight: '500' });
    expect(await computed(page, '#next-body')).toMatchObject({ size: '16px', leading: '24px' });

    await stylesheet.evaluate((element, css) => { element.textContent = css; }, nextCss);
    await settle(page);
    expect(await Promise.all(untouched.map(selector => computed(page, selector)))).toEqual(before);
    expect(await page.locator('html').getAttribute('data-zero-theme')).toBeNull();
    expect(await page.locator('body').getAttribute('data-zero-theme')).toBeNull();
    expect(await computed(page, '#next-body')).toMatchObject({ size: '14px', leading: '21px', weight: '400', numeric: 'normal' });
    expect(await computed(page, '#next-control')).toMatchObject({ size: '13px', leading: '18.2px', weight: '500' });
    expect((await computed(page, '#next-control')).family).toStartWith('Inter');
    expect(await computed(page, '#next-heading')).toMatchObject({ size: '28px', leading: '33.6px', weight: '600' });
    expect(await computed(page, '#dark-heading')).toMatchObject({ size: '16px', leading: '22.4px', weight: '600' });
    expect(await computed(page, '#next')).toMatchObject({ background: 'rgb(255, 255, 255)', color: 'rgb(29, 29, 29)', scheme: 'light' });
    expect(await computed(page, '#dark')).toMatchObject({ background: 'rgb(20, 20, 20)', color: 'rgb(242, 242, 242)', scheme: 'dark' });
    expect(await computed(page, '#nested-light')).toMatchObject({ background: 'rgb(255, 255, 255)', color: 'rgb(29, 29, 29)', scheme: 'light' });
    expect(await computed(page, '#utility-control')).toMatchObject({ size: '18px', leading: '18px', weight: '700', tracking: '0.45px' });
    expect(await computed(page, '#inline-control')).toMatchObject({ size: '23px', leading: '46px', weight: '700', family: 'serif' });
  } finally { await page.close(); }
}, 30_000);

browserTest('managed next output permits live local roles and direct token overrides while explicit modes stay scoped', async () => {
  const { page } = await mount(nextCss);
  try {
    await page.evaluate(() => {
      (window as Window & { originalControl?: Element | null }).originalControl = document.querySelector('#local-control');
      const local = document.querySelector<HTMLElement>('#local')!;
      local.style.setProperty('--zero-type-control-size', '19px');
      local.style.setProperty('--zero-type-control-weight', '600');
      local.style.setProperty('--zero-theme-font-body', 'monospace');
    });
    await settle(page);
    expect(await computed(page, '#local-control')).toMatchObject({ size: '19px', leading: '26.6px', weight: '600', family: 'monospace' });
    await page.locator('#local').evaluate(element => (element as HTMLElement).style.setProperty('--zero-type-control-size', '21px'));
    await page.locator('#nested-light').evaluate(element => (element as HTMLElement).style.setProperty('--zero-theme-canvas', '#224466'));
    await page.locator('html').evaluate(element => element.classList.add('dark'));
    await settle(page);
    expect(await computed(page, '#local-control')).toMatchObject({ size: '21px', leading: '29.4px', weight: '600', family: 'monospace' });
    expect(await page.evaluate(() => (window as Window & { originalControl?: Element | null }).originalControl === document.querySelector('#local-control'))).toBe(true);
    expect(await computed(page, '#next')).toMatchObject({ background: 'rgb(255, 255, 255)', color: 'rgb(29, 29, 29)', scheme: 'light' });
    expect(await computed(page, '#dark')).toMatchObject({ background: 'rgb(20, 20, 20)', color: 'rgb(242, 242, 242)', scheme: 'dark' });
    expect(await computed(page, '#nested-light')).toMatchObject({ background: 'rgb(34, 68, 102)', color: 'rgb(29, 29, 29)', scheme: 'light' });
    expect(await computed(page, 'body')).toMatchObject({ foundationCanvas: '' });
  } finally { await page.close(); }
}, 30_000);
