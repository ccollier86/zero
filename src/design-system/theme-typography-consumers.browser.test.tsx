/** Actual shared-control computed styles against compiled CSS; synthetic data only, no application/configuration or font network. */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { CardTitle, CardDescription } from '../components/ui/card';
import { StatCard } from '../components/ui/stat-card';
import { Heading, Text } from '../components/typography';
import { renderThemeFoundationCss } from './theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, css = '', markup = '';

function Controls() {
  return <>
    <Button animateIcon={false}>Save</Button><Button animateIcon={false} size="xs">Small</Button>
    <Input aria-label="Name" defaultValue="Example" /><Textarea aria-label="Notes" defaultValue="Notes" />
    <Label htmlFor="example">Label</Label><CardTitle asChild><h3>Section</h3></CardTitle>
    <CardDescription>Description</CardDescription><StatCard label="Requests" value={123} />
  </>;
}

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  markup = renderToStaticMarkup(<>
    <section id="legacy"><Controls /></section>
    <section id="next" data-zero-theme="next" data-zero-mode="light"><p id="plain">Plain inherited text</p><Controls />
      <Heading id="page-title" as="h1" variant="page">Product title</Heading>
      <Heading id="display" as="h2" variant="display">Display title</Heading>
      <Text id="reading" as="p" variant="reading">Comfortable reading text</Text>
      <div id="local"><Button id="local-button" animateIcon={false}>Local</Button></div>
      <Button id="custom-button" animateIcon={false} className="text-lg font-mono font-bold leading-none tracking-wide">Custom</Button>
      <Text id="utility-text" className="text-lg font-mono font-bold leading-none">Custom text</Text>
      <Text id="inline-text" style={{ fontSize: '23px', lineHeight: 2, fontFamily: 'serif' }}>Inline text</Text>
    </section>
    <div id="portal"><Button animateIcon={false}>Owned portal</Button></div>
  </>);
  const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  const candidates = [...new Set([...markup.matchAll(/class="([^"]*)"/gu)].flatMap(match => decode(match[1]!).split(/\s+/u)))];
  const require = createRequire(import.meta.url);
  const { compile } = require('@tailwindcss/node') as typeof import('@tailwindcss/node');
  const url = new URL('../frontend/styles/globals.css', import.meta.url);
  const compiler = await compile(await Bun.file(url).text(), { base: new URL('../frontend/styles/', import.meta.url).pathname, from: url.pathname, onDependency() {} });
  css = compiler.build(candidates);
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount() {
  const page = await lease!.browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
  await page.addStyleTag({ content: css });
  await settle(page);
  return page;
}
async function settle(page: Page) {
  // Existing Button transition-all animates inherited typography changes. Read
  // after its finite native transitions, without suppressing runtime motion.
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}
async function type(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(element => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, leading: style.lineHeight, weight: style.fontWeight, family: style.fontFamily,
      tracking: style.letterSpacing, numeric: style.fontVariantNumeric };
  });
}

browserTest('next body and actual native controls consume roles; unmarked legacy consumers keep their fallback', async () => {
  const page = await mount();
  try {
    const selectors = ['[data-slot="button"]', '[data-slot="input"]', '[data-slot="textarea"]', '[data-slot="label"]', '[data-slot="card-title"]', '[data-slot="card-description"]', '[data-slot="sliding-number"]'];
    const before = await Promise.all(selectors.map(selector => type(page, `#legacy ${selector}`)));
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    await settle(page);
    expect(await Promise.all(selectors.map(selector => type(page, `#legacy ${selector}`)))).toEqual(before);
    expect(await type(page, '#plain')).toMatchObject({ size: '14px', leading: '21px', weight: '400' });
    expect(await type(page, '#next [data-slot="button"]')).toMatchObject({ size: '13px', weight: '500' });
    expect(await type(page, '#next [data-slot="button"][data-size="xs"]')).toMatchObject({ size: '12px' });
    expect(await type(page, '#next [data-slot="label"]')).toMatchObject({ size: '14px', weight: '500' });
    expect(await type(page, '#next [data-slot="card-title"]')).toMatchObject({ size: '16px', weight: '600' });
    expect(await type(page, '#next [data-slot="sliding-number"]')).toMatchObject({ size: '22px', weight: '600', numeric: 'tabular-nums' });
    expect((await type(page, '#page-title')).family).toStartWith('Inter');
    expect(await type(page, '#page-title')).toMatchObject({ size: '28px', weight: '600' });
    expect((await type(page, '#display')).family).toStartWith('Geist');
    expect(await type(page, '#display')).toMatchObject({ size: '36px', weight: '600' });
    expect(await type(page, '#reading')).toMatchObject({ size: '16px', leading: '28.8px' });
  } finally { await page.close(); }
}, 30_000);

browserTest('responsive input values and rem roles survive viewport/root-font changes', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    await settle(page);
    for (const slot of ['input', 'textarea']) expect(await type(page, `#next [data-slot="${slot}"]`)).toMatchObject({ size: '14px', leading: '21px' });
    await page.setViewportSize({ width: 600, height: 900 });
    for (const slot of ['input', 'textarea']) expect(await type(page, `#next [data-slot="${slot}"]`)).toMatchObject({ size: '16px', leading: '24px' });
    await page.locator('html').evaluate(element => { element.style.fontSize = '20px'; });
    expect(await type(page, '#next [data-slot="input"]')).toMatchObject({ size: '20px', leading: '30px' });
    expect(await type(page, '#page-title')).toMatchObject({ size: '35px' });
    expect(await type(page, '#reading')).toMatchObject({ size: '20px', leading: '36px' });
    await page.setViewportSize({ width: 1000, height: 900 });
    expect(await type(page, '#next [data-slot="input"]')).toMatchObject({ size: '17.5px', leading: '26.25px' });
  } finally { await page.close(); }
}, 30_000);

browserTest('local roles/families, caller utilities/styles and legacy Tailwind overrides remain effective', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    await settle(page);
    await page.locator('#local').evaluate(element => {
      (element as HTMLElement).style.setProperty('--zero-theme-font-body', 'monospace');
      (element as HTMLElement).style.setProperty('--zero-type-control-size', '19px');
      (element as HTMLElement).style.setProperty('--zero-type-control-weight', '600');
    });
    await settle(page);
    expect(await type(page, '#local-button')).toMatchObject({ size: '19px', family: 'monospace', weight: '600' });
    await page.locator('#local').evaluate(element => (element as HTMLElement).style.setProperty('--zero-type-control-size', '21px'));
    await settle(page);
    expect(await type(page, '#local-button')).toMatchObject({ size: '21px' });
    await page.locator('#next').evaluate(element => {
      (element as HTMLElement).style.setProperty('--zero-theme-weight-medium', '600');
      (element as HTMLElement).style.setProperty('--zero-theme-leading-label', '1.6');
    });
    await settle(page);
    expect(await type(page, '#next > [data-slot="button"]')).toMatchObject({ size: '13px', leading: '20.8px', weight: '600' });
    expect(await type(page, '#custom-button')).toMatchObject({ size: '18px', leading: '18px', weight: '700', tracking: '0.45px' });
    expect(await type(page, '#utility-text')).toMatchObject({ size: '18px', leading: '18px', weight: '700' });
    expect(await type(page, '#inline-text')).toMatchObject({ size: '23px', leading: '46px', family: 'serif' });
    await page.locator('#legacy').evaluate(element => {
      (element as HTMLElement).style.setProperty('--text-sm', '23px');
      (element as HTMLElement).style.setProperty('--text-sm--line-height', '1.6');
      (element as HTMLElement).style.setProperty('--font-weight-medium', '600');
    });
    await settle(page);
    expect(await type(page, '#legacy [data-slot="button"]')).toMatchObject({ size: '23px', leading: '36.8px', weight: '600' });
  } finally { await page.close(); }
}, 30_000);

browserTest('an actual out-of-tree control consumes projected roles without a wrapper/provider or remount', async () => {
  const page = await mount();
  try {
    await page.addStyleTag({ content: renderThemeFoundationCss() });
    await settle(page);
    await page.evaluate(() => {
      const source = document.querySelector('#next')!, portal = document.querySelector<HTMLElement>('#portal')!, style = getComputedStyle(source);
      for (let i = 0; i < style.length; i++) { const name = style.item(i); if (name.startsWith('--')) portal.style.setProperty(name, style.getPropertyValue(name)); }
      (window as any).originalControl = portal.querySelector('button');
    });
    await settle(page);
    expect(await type(page, '#portal button')).toMatchObject({ size: '13px', weight: '500' });
    await page.locator('#portal').evaluate(element => (element as HTMLElement).style.setProperty('--zero-type-control-size', '17px'));
    await settle(page);
    expect(await type(page, '#portal button')).toMatchObject({ size: '17px' });
    expect(await page.evaluate(() => (window as any).originalControl === document.querySelector('#portal button'))).toBe(true);
  } finally { await page.close(); }
}, 30_000);
