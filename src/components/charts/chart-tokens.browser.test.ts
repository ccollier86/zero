/** Real computed-style/portal checks for shared analytical tokens with synthetic data only. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'chart-family-browser-'));
  try {
    const output = join(directory, 'fixture.js');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/chart-tokens.browser-fixture.tsx',
      '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error('Chart-family fixture build failed: ' + (stderr || stdout));
    bundle = await Bun.file(output).text(); css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(theme: 'light' | 'dark' | null = 'light', scheme: 'light' | 'dark' = 'light', reduced = true): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 1000, height: 1100 }, reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: scheme });
  await page.setContent(`<!doctype html><html${theme ? ` data-theme="${theme}"` : ''}><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Chart family fixture' }).waitFor();
  await page.locator('.zero-sankey__tooltip').waitFor(); await page.locator('.zero-race-bar__tooltip').waitFor(); await page.locator('.zero-funnel__tooltip').waitFor();
  return page;
}
async function shell(page: Page, name: 'sankey' | 'race-bar' | 'funnel') {
  return page.locator(`.zero-${name}__tooltip`).evaluate(element => {
    const style = getComputedStyle(element), body = getComputedStyle(element.querySelector(`[class$="__inspection"]`)!);
    return { radius: style.borderRadius, shadow: style.boxShadow, background: style.backgroundColor, color: style.color, maxWidth: style.maxWidth,
      padding: body.padding, fontSize: body.fontSize, lineHeight: body.lineHeight };
  });
}
async function waitForParticleColor(page: Page, color: readonly [number, number, number]) {
  await page.waitForFunction(expected => {
    const canvas = document.querySelector<HTMLCanvasElement>('.zero-sankey__canvas')!, context = canvas.getContext('2d')!;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < pixels.length; index += 4)
      if (pixels[index + 3]! > 30 && Math.abs(pixels[index]! - expected[0]) < 4 && Math.abs(pixels[index + 1]! - expected[1]) < 4 && Math.abs(pixels[index + 2]! - expected[2]) < 4) return true;
    return false;
  }, color);
}

for (const [theme, scheme, expected] of [['light', 'dark', 'rgb(42, 120, 214)'], ['dark', 'light', 'rgb(57, 135, 229)'], [null, 'dark', 'rgb(57, 135, 229)']] as const) {
  browserTest(`shared inspector/palette applies to all three charts in ${theme ?? 'system'} theme`, async () => {
    const page = await mount(theme, scheme);
    try {
      expect(await page.locator('[data-node-id="source"]').evaluate(element => getComputedStyle(element).fill)).toBe(expected);
      expect(await page.locator('.zero-race-bar__bar').evaluate(element => getComputedStyle(element, '::after').backgroundColor)).toBe(expected);
      expect(await page.locator('.zero-funnel__inspection-row i').evaluateAll(elements => getComputedStyle(elements[0]!).backgroundColor)).toBe(expected);
      expect(await shell(page, 'sankey')).toEqual(await shell(page, 'race-bar'));
      expect(await shell(page, 'sankey')).toEqual(await shell(page, 'funnel'));
      expect(await shell(page, 'sankey')).toMatchObject({ radius: '10px', padding: '9px 12px', fontSize: '12px', lineHeight: '17.4px' });
      expect(await page.locator('.zero-sankey__value').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize))).toEqual(['14px', '14px']);
      expect(await page.locator('.zero-race-bar__value').evaluate(element => getComputedStyle(element).fontSize)).toBe('12.5px');
    } finally { await page.close(); }
  }, 30_000);
}

browserTest('live scoped common overrides reach SVG, DOM, measurement and portalled inspectors with local precedence', async () => {
  const page = await mount();
  try {
    const originalDestinationX = Number(await page.locator('[data-node-id="end"]').getAttribute('x'));
    const originalBarLeft = await page.locator('.zero-race-bar__bar').evaluate(element => Number.parseFloat((element as HTMLElement).style.left));
    await page.getByTestId('family-scope').evaluate(element => {
      const style = (element as HTMLElement).style;
      for (const [name, value] of Object.entries({ blue: '#cc2266', 'label-size': '18px', 'row-value-size': '19px',
        'inspector-radius': '16px', 'inspector-padding': '13px 18px', 'inspector-font-size': '14px',
        'inspector-line-height': '1.6', 'inspector-value-size': '21px', 'inspector-max-width': '300px', surface: '#faf0e0', muted: '#554433', feedback: '190ms' }))
        style.setProperty('--zero-chart-' + name, value);
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.zero-sankey__tooltip')!).borderRadius === '16px' &&
      getComputedStyle(document.querySelector('.zero-race-bar__tooltip')!).borderRadius === '16px' &&
      getComputedStyle(document.querySelector('.zero-funnel__tooltip')!).borderRadius === '16px');
    expect(await shell(page, 'sankey')).toEqual(await shell(page, 'race-bar'));
    expect(await shell(page, 'sankey')).toEqual(await shell(page, 'funnel'));
    expect(await shell(page, 'sankey')).toMatchObject({ background: 'rgb(250, 240, 224)', color: 'rgb(85, 68, 51)', padding: '13px 18px', fontSize: '14px', lineHeight: '22.4px', maxWidth: '300px' });
    expect(await page.locator('[data-node-id="source"]').evaluate(element => getComputedStyle(element).fill)).toBe('rgb(204, 34, 102)');
    expect(await page.locator('.zero-race-bar__bar').evaluate(element => getComputedStyle(element, '::after').backgroundColor)).toBe('rgb(204, 34, 102)');
    expect(await page.locator('.zero-funnel__inspection-row i').evaluateAll(elements => getComputedStyle(elements[0]!).backgroundColor)).toBe('rgb(204, 34, 102)');
    expect(await page.locator('.zero-sankey__label').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize))).toEqual(['18px', '18px']);
    expect(await page.locator('.zero-race-bar__name').evaluate(element => getComputedStyle(element).fontSize)).toBe('18px');
    expect(await page.locator('.zero-funnel__label').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize))).toEqual(['18px', '18px']);
    expect(Number(await page.locator('[data-node-id="end"]').getAttribute('x'))).toBeLessThan(originalDestinationX);
    expect(await page.locator('.zero-race-bar__bar').evaluate(element => Number.parseFloat((element as HTMLElement).style.left))).toBeGreaterThan(originalBarLeft);
    for (const chart of ['sankey', 'race-bar']) {
      expect(await page.locator(`.zero-${chart}__inspection-value`).evaluate(element => getComputedStyle(element).fontSize)).toBe('21px');
      expect(await page.locator(`.zero-${chart}`).evaluate(element => getComputedStyle(element).getPropertyValue('--zero-tooltip-motion-blur-enter').trim())).toBe('190ms');
    }
    await page.locator('.zero-sankey').evaluate(element => {
      const style = (element as HTMLElement).style; style.setProperty('--zero-chart-series-1', '#1122ee');
      style.setProperty('--zero-sankey-inspector-radius', '23px'); style.setProperty('--zero-sankey-label-size', '20px');
    });
    await page.locator('.zero-race-bar').evaluate(element => {
      const style = (element as HTMLElement).style; style.setProperty('--zero-race-bar-series-1', '#eeaa11');
      style.setProperty('--zero-race-bar-inspector-radius', '25px'); style.setProperty('--zero-race-bar-name-size', '22px');
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.zero-sankey__tooltip')!).borderRadius === '23px' &&
      getComputedStyle(document.querySelector('.zero-race-bar__tooltip')!).borderRadius === '25px');
    expect(await page.locator('[data-node-id="source"]').evaluate(element => getComputedStyle(element).fill)).toBe('rgb(17, 34, 238)');
    expect(await page.locator('.zero-race-bar__bar').evaluate(element => getComputedStyle(element, '::after').backgroundColor)).toBe('rgb(238, 170, 17)');
    expect(await page.locator('.zero-sankey__label').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize))).toEqual(['20px', '20px']);
    expect(await page.locator('.zero-race-bar__name').evaluate(element => getComputedStyle(element).fontSize)).toBe('22px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

browserTest('named palette stays scoped and legacy Recharts colors remain untouched', async () => {
  const page = await mount();
  try {
    const before = await page.evaluate(() => Array.from({ length: 5 }, (_, i) => getComputedStyle(document.documentElement).getPropertyValue('--chart-' + (i + 1))));
    await page.getByTestId('family-scope').evaluate(element => (element as HTMLElement).style.setProperty('--zero-chart-blue', '#cc2266'));
    expect(await page.evaluate(() => Array.from({ length: 5 }, (_, i) => getComputedStyle(document.documentElement).getPropertyValue('--chart-' + (i + 1))))).toEqual(before);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zero-chart-blue').trim())).toBe('#2a78d6');
    await page.getByTestId('family-scope').evaluate(element => { (element as HTMLElement).style.removeProperty('--zero-chart-blue'); element.setAttribute('data-theme', 'dark'); });
    expect(await page.locator('[data-node-id="source"]').evaluate(element => getComputedStyle(element).fill)).toBe('rgb(57, 135, 229)');
    expect(await page.locator('.zero-race-bar__bar').evaluate(element => getComputedStyle(element, '::after').backgroundColor)).toBe('rgb(57, 135, 229)');
    expect(await page.locator('.zero-funnel__inspection-row i').evaluateAll(elements => getComputedStyle(elements[0]!).backgroundColor)).toBe('rgb(57, 135, 229)');
  } finally { await page.close(); }
}, 30_000);

browserTest('scoped named colors update Sankey canvas particles and SVG together', async () => {
  const page = await mount('light', 'light', false);
  try {
    await page.waitForFunction(() => document.querySelector('.zero-sankey__plot')?.getAttribute('data-settling') === 'false');
    await page.getByTestId('family-scope').evaluate(element => (element as HTMLElement).style.setProperty('--zero-chart-blue', '#cc2266'));
    await waitForParticleColor(page, [204, 34, 102]);
    expect(await page.locator('[data-node-id="source"]').evaluate(element => getComputedStyle(element).fill)).toBe('rgb(204, 34, 102)');
    expect(await page.locator('.zero-sankey__canvas').getAttribute('data-particle-count')).not.toBe('0');
  } finally { await page.close(); }
}, 30_000);

for (const theme of ['light', 'dark'] as const) {
  browserTest(`neutral ${theme} traces keep their semantic contrast with scoped text tokens and local ink precedence`, async () => {
    const page = await mount(theme, 'light', false);
    try {
      await page.waitForFunction(() => document.querySelector('.zero-sankey__plot')?.getAttribute('data-settling') === 'false');
      await page.getByTestId('family-scope').evaluate(element => {
        const style = (element as HTMLElement).style; style.setProperty('--zero-chart-foreground', '#cc2266');
        style.setProperty('--zero-chart-secondary', '#228877');
      });
      await page.locator('.zero-sankey__hit[data-kind="node"][data-target-id="end"]').hover();
      await page.locator('.zero-sankey__tooltip').filter({ hasText: 'Destination label' }).waitFor();
      await page.waitForFunction(() => document.querySelector('.zero-sankey__plot')?.getAttribute('data-settling') === 'false');
      const expected = theme === 'dark' ? 'rgb(204, 34, 102)' : 'rgb(34, 136, 119)';
      expect(await page.locator('.zero-sankey__back path:not([data-link-id])').evaluateAll(elements => [...new Set(elements.filter(element => Number(element.getAttribute('opacity')) > 0).map(element => getComputedStyle(element).fill))])).toEqual([expected]);
      await waitForParticleColor(page, theme === 'dark' ? [204, 34, 102] : [34, 136, 119]);
      await page.locator('.zero-sankey').evaluate(element => (element as HTMLElement).style.setProperty('--zero-sankey-ink', '#11aa77'));
      expect(await page.locator('.zero-sankey__back path:not([data-link-id])').evaluateAll(elements => [...new Set(elements.filter(element => Number(element.getAttribute('opacity')) > 0).map(element => getComputedStyle(element).fill))])).toEqual(['rgb(17, 170, 119)']);
      await waitForParticleColor(page, [17, 170, 119]);
    } finally { await page.close(); }
  }, 30_000);
}

browserTest('shared focus width, offset, color and plot radius are uniform without coupling chart clocks', async () => {
  const page = await mount();
  try {
    await page.getByTestId('family-scope').evaluate(element => {
      const style = (element as HTMLElement).style; style.setProperty('--zero-chart-focus-width', '3px');
      style.setProperty('--zero-chart-focus-offset', '5px'); style.setProperty('--zero-chart-focus-color', '#cc2266');
      style.setProperty('--zero-chart-plot-radius', '14px');
    });
    await page.keyboard.press('Tab');
    const sankey = await page.locator('.zero-sankey__plot').evaluate(element => ({ radius: getComputedStyle(element).borderRadius, shadow: getComputedStyle(element).boxShadow }));
    await page.keyboard.press('Tab');
    const race = await page.locator('.zero-race-bar__plot').evaluate(element => ({ radius: getComputedStyle(element).borderRadius, shadow: getComputedStyle(element).boxShadow }));
    await page.keyboard.press('Tab');
    const funnel = await page.locator('.zero-funnel__plot').evaluate(element => ({ radius: getComputedStyle(element).borderRadius, shadow: getComputedStyle(element).boxShadow }));
    expect(sankey).toEqual(race); expect(sankey.radius).toBe('14px'); expect(sankey.shadow).toContain('rgb(204, 34, 102) 0px 0px 0px 8px');
    expect(sankey).toEqual(funnel);
    expect(await page.locator('.zero-sankey').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-sankey-motion-morph').trim())).toBe('700ms');
    expect(await page.locator('.zero-race-bar').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-race-bar-period-enter').trim())).toBe('420ms');
  } finally { await page.close(); }
}, 30_000);
