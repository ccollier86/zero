/** Browser qualification against the real SVG/canvas runtime and shared Zero tooltip; only synthetic chart data is mounted. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { renderThemeFoundationCss } from '../../../design-system/theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/sankey-chart';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'sankey-browser-'));
  try {
    const output = join(directory, 'fixture.js');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/sankey-chart.browser-fixture.tsx', '--target=browser', '--format=iife', '--outfile', output],
      { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error('Sankey fixture build failed: ' + (stderr || stdout));
    bundle = await Bun.file(output).text(); css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); await mkdir(artifacts, { recursive: true });
}, 60_000);
afterAll(() => lease?.release());
async function mount(width = 1100, dark = false, reduced = false) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message)); page.setDefaultTimeout(4000);
  await page.setContent(`<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"${dark ? ' class="dark"' : ''}><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Sankey chart fixture' }).waitFor();
  await page.waitForFunction(() => !!window.__sankeyFixture && document.querySelector('.zero-sankey__plot')?.hasAttribute('data-orientation'));
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
async function settled(page: Page) { await page.waitForFunction(() => document.querySelector('.zero-sankey__plot')?.getAttribute('data-settling') === 'false'); }

browserTest('marker-only next palettes and font density retarget paint without retiring Sankey trace or nodes', async () => {
  const page = await mount(1100, false, true);
  try {
    await settled(page); await page.addStyleTag({ content: renderThemeFoundationCss() + '\n[data-zero-density="touch"]{--zero-sankey-label-size:20px;--zero-sankey-value-size:22px}' });
    const node = await page.locator('[data-node-id="organic"]').elementHandle();
    await page.evaluate(() => { const frame = document.querySelector('[data-testid="frame"]')!; frame.setAttribute('data-zero-theme', 'next'); frame.setAttribute('data-zero-mode', 'light');
      window.__sankeyFixture.trace({ kind: 'node', id: 'activated' }); });
    await page.getByRole('tooltip').filter({ hasText: '6,950 people' }).waitFor();
    const ink = () => page.locator('.zero-sankey__back').evaluate(element => (element as SVGSVGElement).style.getPropertyValue('--zero-sankey-neutral-ink-default'));
    expect(await ink()).toContain('--zero-chart-secondary');
    await page.getByTestId('frame').evaluate(element => element.setAttribute('data-zero-mode', 'dark'));
    await page.waitForFunction(() => (document.querySelector('.zero-sankey__back') as SVGSVGElement).style.getPropertyValue('--zero-sankey-neutral-ink-default').includes('--zero-chart-foreground'));
    const geometry = await page.locator('[data-node-id="retained"]').getAttribute('x');
    await page.getByTestId('frame').evaluate(element => element.setAttribute('data-zero-density', 'touch')); await settled(page);
    expect(await page.locator('[data-node-id="retained"]').getAttribute('x')).not.toBe(geometry);
    expect(await page.evaluate(() => window.__sankeyFixture.state().trace)).toEqual({ kind: 'node', id: 'activated' });
    expect(await node!.evaluate(element => element === document.querySelector('[data-node-id="organic"]'))).toBe(true);
    await page.getByTestId('frame').evaluate(element => { element.setAttribute('data-zero-mode', 'system'); element.removeAttribute('data-zero-density'); });
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => (document.querySelector('.zero-sankey__back') as SVGSVGElement).style.getPropertyValue('--zero-sankey-neutral-ink-default').includes('--zero-chart-secondary'));
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => (document.querySelector('.zero-sankey__back') as SVGSVGElement).style.getPropertyValue('--zero-sankey-neutral-ink-default').includes('--zero-chart-foreground'));
    expect(await page.evaluate(() => window.__sankeyFixture.state().trace)).toEqual({ kind: 'node', id: 'activated' });
    await page.evaluate(() => window.__sankeyFixture.unmount()); await page.locator('.zero-sankey').waitFor({ state: 'detached' });
    await page.getByTestId('frame').evaluate(element => element.setAttribute('data-zero-mode', 'light'));
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    expect(await page.locator('.zero-sankey__canvas').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('late font completion remeasures Sankey gutters without changing selected trace or stable paint nodes', async () => {
  const page = await mount(1100, false, true);
  try {
    await settled(page); await page.evaluate(() => window.__sankeyFixture.trace({ kind: 'node', id: 'organic' }));
    const node = await page.locator('[data-node-id="retained"]').elementHandle(), before = await node!.getAttribute('x');
    // Stylesheet insertion is not an attribute mutation: the font lifecycle must invalidate cached canvas metrics.
    await page.addStyleTag({ content: '.zero-sankey{--zero-chart-font-family:monospace;--zero-sankey-label-size:25px}' });
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    await page.waitForFunction(previous => document.querySelector('[data-node-id="retained"]')?.getAttribute('x') !== previous, before);
    expect(await node!.evaluate(element => element === document.querySelector('[data-node-id="retained"]'))).toBe(true);
    expect(await page.evaluate(() => window.__sankeyFixture.state().trace)).toEqual({ kind: 'node', id: 'organic' });
  } finally { await close(page); }
}, 30_000);

browserTest('marker-only palette changes reach Sankey cached canvas particle paint, not just live SVG variables', async () => {
  const page = await mount();
  try {
    await settled(page);
    await page.addStyleTag({ content: '[data-zero-mode="dark"]{' + Array.from({ length: 6 }, (_, index) => `--zero-chart-series-${index + 1}:#ff00aa;`).join('') + '}' });
    const count = await page.locator('.zero-sankey__canvas').getAttribute('data-particle-count');
    await page.getByTestId('frame').evaluate(element => element.setAttribute('data-zero-mode', 'dark'));
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.zero-sankey__canvas')!, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3]! > 80 && pixels[index]! > 245 && pixels[index + 1]! < 10 && Math.abs(pixels[index + 2]! - 170) < 10) return true;
      return false;
    });
    expect(await page.locator('.zero-sankey__canvas').getAttribute('data-particle-count')).toBe(count);
    expect(await page.locator('.zero-sankey__plot').getAttribute('data-running')).toBe('true');
  } finally { await close(page); }
}, 30_000);

for (const [width, dark, name] of [[1100, false, 'light'], [1100, true, 'dark'], [390, false, 'phone-light'], [390, true, 'phone-dark']] as const) {
  browserTest(`reference anatomy and bounded responsive SVG match ${name}`, async () => {
    const page = await mount(width, dark, true);
    try {
      await settled(page); expect(await page.locator('[data-node-id]').count()).toBe(10); expect(await page.locator('[data-link-id]').count()).toBe(15);
      expect(await page.locator('.zero-sankey__plot').getAttribute('data-orientation')).toBe(width < 500 ? 'vertical' : 'horizontal');
      await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const values = await page.locator('.zero-sankey').evaluate(element => {
        const css = getComputedStyle(element); return { enter: css.getPropertyValue('--zero-sankey-motion-enter').trim(),
          morph: css.getPropertyValue('--zero-sankey-motion-morph').trim(), series: css.getPropertyValue('--zero-chart-blue').trim() };
      });
      expect(values).toEqual({ enter: '1000ms', morph: '700ms', series: dark ? '#3987e5' : '#2a78d6' });
      expect(await page.getByRole('table', { name: 'Signup journey' }).count()).toBe(1);
      expect(await page.getByRole('button', { name: 'Pause flow particles' }).count()).toBe(0);
      await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
    } finally { await close(page); }
  }, 30_000);
}
browserTest('initial nodes reveal over time instead of fonts.ready skipping the staged entrance', async () => {
  const page = await mount();
  try {
    const initial = await page.locator('[data-node-id="organic"]').getAttribute('height');
    expect(Number(initial)).toBeLessThan(140); expect(await page.locator('.zero-sankey__plot').getAttribute('data-settling')).toBe('true');
    await settled(page); expect(Number(await page.locator('[data-node-id="organic"]').getAttribute('height'))).toBeGreaterThan(Number(initial));
    const node = await page.locator('[data-node-id="organic"]').elementHandle();
    await page.evaluate(() => { const data = window.__sankeyFixture.reference(); window.__sankeyFixture.data({ ...data, links: data.links.map(link => ({ ...link, value: link.value * 1.5 })) }); });
    expect(await node!.evaluate(element => element === document.querySelector('[data-node-id="organic"]'))).toBe(true);
    await settled(page);
  } finally { await close(page); }
}, 30_000);
browserTest('keyboard and custom inspectors use the shared tokenized tooltip, exact values, and Escape clears the top inspection', async () => {
  const page = await mount(1100, false, true);
  try {
    await page.keyboard.press('Tab'); await page.getByRole('tooltip').filter({ hasText: '5,000 people' }).waitFor();
    expect(await page.evaluate(() => window.__sankeyFixture.state().trace)).toEqual({ kind: 'node', id: 'organic' });
    await page.keyboard.press('ArrowRight'); await page.getByRole('tooltip').filter({ hasText: '6,950 people' }).waitFor();
    const styles = await page.locator('.zero-sankey__tooltip').evaluate(element => {
      const css = getComputedStyle(element); return { radius: css.borderRadius, background: css.backgroundColor,
        expected: getComputedStyle(document.querySelector('.zero-sankey')!).getPropertyValue('--card').trim(), blur: css.getPropertyValue('--zero-tooltip-blur').trim() };
    });
    expect(styles.radius).toBe('10px'); expect(styles.blur).toBe('0px');
    await page.evaluate(() => window.__sankeyFixture.tooltip('custom')); await page.getByTestId('custom-tooltip').filter({ hasText: 'Custom Activated: 6950' }).waitFor();
    await page.screenshot({ path: join(artifacts, 'custom-inspector.png'), fullPage: true });
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => window.__sankeyFixture.state().trace)).toBeNull();
    await page.evaluate(() => { window.__sankeyFixture.tooltip('hidden'); window.__sankeyFixture.trace({ kind: 'node', id: 'paid' }); });
    expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('pointer node/ribbon hit areas produce honest proportional traces and portal inspectors', async () => {
  const page = await mount(1100, true, true);
  try {
    const target = page.locator('.zero-sankey__hit[data-kind="node"][data-target-id="organic"]'); await target.hover();
    await page.getByRole('tooltip').filter({ hasText: '5,000 people' }).waitFor();
    const result = await page.evaluate(() => { const event = window.__sankeyFixture.state().event!;
      return { kind: event.kind, id: event.id, value: event.value, share: event.share, count: event.links.size }; });
    expect(result).toMatchObject({ kind: 'node', id: 'organic', value: 5000, count: 11 }); expect(result.share).toBeCloseTo(5000 / 11200);
    expect(await page.locator('.zero-sankey__tooltip').evaluate(element => !element.closest('figure'))).toBe(true);
    await page.mouse.move(2, 2); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__sankeyFixture.trace({ kind: 'link', id: 'pair:["organic","activated"]' }));
    await page.getByRole('tooltip').filter({ hasText: 'Organic to Activated' }).waitFor();
    await page.screenshot({ path: join(artifacts, 'ribbon-inspector.png'), fullPage: true });
  } finally { await close(page); }
}, 30_000);
browserTest('pinned controlled trace survives reactive data replacement and retires when its target disappears', async () => {
  const page = await mount(390, true, true);
  try {
    await page.keyboard.press('Tab'); await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => window.__sankeyFixture.state().trace)).toEqual({ kind: 'node', id: 'activated' });
    await page.evaluate(() => { const data = window.__sankeyFixture.reference(); window.__sankeyFixture.data({ ...data, links: data.links.map(link => ({ ...link, value: link.value * 2 })) }); });
    await page.getByRole('tooltip').filter({ hasText: '13,900 people' }).waitFor();
    await page.evaluate(() => window.__sankeyFixture.data({ nodes: [{ id: 'fresh' }, { id: 'end' }], links: [{ source: 'fresh', target: 'end', value: 1 }] }));
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await close(page); }
}, 30_000);
browserTest('global particle/canvas budgets, motion opt-out, hidden chart clock and teardown are bounded', async () => {
  const page = await mount();
  try {
    await settled(page); const canvas = page.locator('.zero-sankey__canvas');
    expect(Number(await canvas.getAttribute('data-particle-count'))).toBeLessThanOrEqual(130);
    await page.getByRole('button', { name: 'Pause flow particles' }).click();
    await page.waitForFunction(() => document.querySelector('.zero-sankey__plot')?.getAttribute('data-running') === 'false');
    await page.evaluate(() => { window.__sankeyFixture.motion(false); window.__sankeyFixture.height(10_000); });
    await settled(page);
    expect(await canvas.evaluate(element => { const canvas = element as HTMLCanvasElement; return canvas.width * canvas.height <= 4_000_000 && canvas.width <= 8192 && canvas.height <= 8192; })).toBe(true);
    await page.evaluate(() => { window.__sankeyFixture.motion(true); window.__sankeyFixture.particles(true); document.querySelector<HTMLElement>('[data-testid="frame"]')!.style.marginTop = '15000px'; });
    await page.waitForFunction(() => document.querySelector('.zero-sankey__plot')?.getAttribute('data-running') === 'false');
    await page.evaluate(() => window.__sankeyFixture.unmount()); await page.locator('[data-slot="sankey-chart"]').waitFor({ state: 'detached' });
    expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('global theme tokens reach chart paint, timing, and portalled inspectors without per-chart overrides', async () => {
  const page = await mount(1100, false, true);
  try {
    await page.evaluate(() => { const root = document.documentElement; root.style.setProperty('--zero-chart-series-1', '#ff00aa');
      root.style.setProperty('--zero-sankey-motion-morph', '333ms'); root.style.setProperty('--zero-sankey-inspector-radius', '19px'); });
    await page.keyboard.press('Tab'); await page.getByRole('tooltip').waitFor();
    expect(await page.locator('[data-node-id="organic"]').evaluate(element => getComputedStyle(element).fill)).toBe('rgb(255, 0, 170)');
    expect(await page.locator('.zero-sankey').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-sankey-motion-morph').trim())).toBe('333ms');
    expect(await page.locator('.zero-sankey__tooltip').evaluate(element => getComputedStyle(element).borderRadius)).toBe('19px');
  } finally { await close(page); }
}, 30_000);
browserTest('touch taps pin the trace and inspector, repeated tap clears it, and keyboard skips empty pinned stages', async () => {
  const page = await mount(390, true, true);
  try {
    const node = page.locator('.zero-sankey__hit[data-kind="node"][data-target-id="organic"]');
    await node.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 120, clientY: 195 });
    await page.getByRole('tooltip').filter({ hasText: '5,000 people' }).waitFor();
    await node.dispatchEvent('pointerleave', { pointerType: 'mouse' });
    expect(await page.evaluate(() => window.__sankeyFixture.state().trace)).toEqual({ kind: 'node', id: 'organic' });
    await node.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 120, clientY: 195 });
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__sankeyFixture.data({ nodes: [{ id: 'a', label: 'Start', column: 0 }, { id: 'b', label: 'End', column: 3 }],
      links: [{ source: 'a', target: 'b', value: 10 }] }));
    await page.keyboard.press('Tab'); await page.keyboard.press('ArrowDown');
    await page.getByRole('tooltip').filter({ hasText: 'End' }).waitFor();
    expect(await page.evaluate(() => window.__sankeyFixture.state().trace)).toEqual({ kind: 'node', id: 'b' });
  } finally { await close(page); }
}, 30_000);
browserTest('an interrupted 700ms data morph retargets from painted geometry, retaining node identity', async () => {
  const page = await mount();
  try {
    await settled(page); const node = page.locator('[data-node-id="organic"]'), handle = await node.elementHandle(), initial = Number(await node.getAttribute('height'));
    await page.evaluate(() => { const data = window.__sankeyFixture.reference(); window.__sankeyFixture.data({ ...data,
      links: data.links.map(link => ({ ...link, value: link.source === 'organic' ? link.value * 1.5 : link.value })) }); });
    await page.waitForFunction(previous => Number(document.querySelector('[data-node-id="organic"]')?.getAttribute('height')) > previous + 2, initial);
    const mid = Number(await node.getAttribute('height'));
    await page.evaluate(() => { const data = window.__sankeyFixture.reference(); window.__sankeyFixture.data({ ...data,
      links: data.links.map(link => ({ ...link, value: link.source === 'organic' ? link.value * .5 : link.value })) }); });
    const retargeted = Number(await node.getAttribute('height'));
    expect(retargeted).toBeGreaterThan(initial); expect(retargeted).toBeLessThan(mid + 15);
    expect(await handle!.evaluate(element => element === document.querySelector('[data-node-id="organic"]'))).toBe(true);
    await settled(page); expect(Number(await node.getAttribute('height'))).toBeLessThan(initial);
  } finally { await close(page); }
}, 30_000);
browserTest('finite extreme flows retain weighted particles on every stage and invalid CSS paint numbers are safe', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => {
      window.__sankeyFixture.data({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
        links: [{ source: 'a', target: 'b', value: 1e308 }, { source: 'b', target: 'c', value: 1e308 }, { source: 'c', target: 'd', value: 1e308 }] });
      const chart = document.querySelector<HTMLElement>('.zero-sankey')!;
      chart.style.setProperty('--zero-sankey-particle-radius', 'Infinity'); chart.style.setProperty('--zero-sankey-ribbon-opacity', 'NaN');
    });
    await settled(page);
    expect(await page.locator('.zero-sankey__canvas').getAttribute('data-particle-flow-count')).toBe('3');
    expect(await page.locator('[data-link-id]').evaluateAll(elements => elements.every(element => Number.isFinite(Number(element.getAttribute('fill-opacity')))))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await close(page); }
}, 30_000);
browserTest('normal motion reference preview includes active Flow control and default aligned value/share inspector', async () => {
  const page = await mount(1100, true);
  try {
    await settled(page); await page.locator('.zero-sankey__hit[data-kind="node"][data-target-id="organic"]').hover();
    await page.getByRole('tooltip').filter({ hasText: '5,000 people' }).waitFor(); await settled(page);
    expect(await page.getByRole('button', { name: 'Pause flow particles' }).isVisible()).toBe(true);
    await page.getByTestId('frame').screenshot({ path: join(artifacts, 'preview.png') });
  } finally { await close(page); }
}, 30_000);
