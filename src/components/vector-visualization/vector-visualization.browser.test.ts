/** Full-style isolated organism qualification; only synthetic DTOs, no app bootstrap, provider or database. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'; // Bun has no direct temp-directory/removal API.
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/vector-visualization';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'vector-visualization-browser-'));
  try {
    const output = join(directory, 'fixture.js');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/vector-visualization.browser-fixture.tsx',
      '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error('Visualization fixture build failed: ' + (stderr || stdout));
    bundle = await Bun.file(output).text();
    css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); await mkdir(artifacts, { recursive: true });
}, 60_000);
afterAll(() => lease?.release());

async function mount(width = 1200, dark = false, reduced = false) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  page.setDefaultTimeout(4000);
  await page.setContent(`<!doctype html><html${dark ? ' class="dark"' : ''}><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Vector visualization fixture', exact: true }).waitFor();
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}

for (const [width, dark, name] of [[1200, false, 'light'], [1200, true, 'dark'], [375, false, 'phone-light'], [375, true, 'phone-dark']] as const) {
  browserTest(`both reference organisms preserve compact anatomy and no horizontal overflow at ${name}`, async () => {
    const page = await mount(width, dark, true);
    try {
      expect(await page.locator('[data-slot="vector-map"]').count()).toBe(2);
      expect(await page.getByRole('region', { name: 'Query embedding' }).count()).toBe(1);
      expect(await page.getByRole('list', { name: 'Ranked records' }).count()).toBe(1);
      expect(await page.getByRole('list', { name: 'Accepted document chunks' }).count()).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const styles = await page.locator('[data-slot="vector-search-visualization"]').evaluate(element => {
        const css = getComputedStyle(element); return { foreground: css.color, expected: css.getPropertyValue('--foreground').trim(),
          move: css.getPropertyValue('--zero-viz-motion-rank-move').trim(), rows: getComputedStyle(element.querySelector('.zero-viz__result')!).minHeight,
          body: getComputedStyle(element.querySelector('.zero-viz__body')!).gridTemplateColumns };
      });
      expect(styles.move).toBe('700ms'); expect(styles.rows).toBe('32px');
      expect(styles.body.split(' ').length).toBe(width > 720 ? 2 : 1);
      await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
    } finally { await close(page); }
  }, 30_000);
}

browserTest('result rank updates reuse row nodes, retain score provenance, and FLIP with exact 700ms/70ms rank timing', async () => {
  const page = await mount();
  try {
    await settle(page);
    const row = await page.locator('.zero-viz__result[data-record-id="record-1"]').elementHandle();
    await page.evaluate(() => {
      const snapshot = window.__vectorVisualization.searchState();
      const results = [snapshot.results![2]!, snapshot.results![0]!, snapshot.results![1]!].map((item, index) => ({ ...item, rank: index + 1 }));
      window.__vectorVisualization.search({ ...snapshot, revision: snapshot.revision + 1, results });
    });
    await page.waitForFunction(() => document.querySelector('.zero-viz__result-list > li')?.getAttribute('data-record-id') === 'record-7');
    expect(await row!.evaluate(element => element === document.querySelector('.zero-viz__result[data-record-id="record-1"]'))).toBe(true);
    const timing = await page.locator('.zero-viz__result[data-record-id="record-1"]').evaluate(element => element.getAnimations()
      .map(animation => ({ duration: animation.effect!.getTiming().duration, delay: animation.effect!.getTiming().delay })));
    expect(timing).toContainEqual({ duration: 700, delay: 70 });
    expect(await page.getByLabel('Moved 1 place down', { exact: true }).count()).toBeGreaterThanOrEqual(1);
    await settle(page);
    expect(await page.locator('.zero-viz__result[data-record-id="record-1"]').evaluate(element => getComputedStyle(element).transform)).toBe('none');
  } finally { await close(page); }
}, 30_000);

browserTest('scrolling the surrounding page does not turn a score-only update into false row movement', async () => {
  const page = await mount();
  try {
    await settle(page);
    await page.evaluate(() => {
      scrollTo(0, 200);
      const snapshot = window.__vectorVisualization.searchState();
      window.__vectorVisualization.search({ ...snapshot, revision: snapshot.revision + 1,
        results: snapshot.results!.map(item => ({ ...item, score: { ...item.score, value: item.score.value + .01 } })) });
    });
    await page.waitForFunction(() => document.querySelector('.zero-viz__result[data-record-id="record-1"] .zero-viz__score-value')?.textContent === '0.92');
    expect(await page.locator('.zero-viz__result[data-record-id="record-1"]').evaluate(element => element.getAnimations().length)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('keyboard tooltips/record selection work through shared primitives and chunks do not imply unacknowledged storage', async () => {
  const page = await mount(1200, false, true);
  try {
    const search = page.locator('[data-slot="vector-search-visualization"]');
    const record = search.locator('.zero-viz__map-overlay').getByRole('button', { name: 'Inspect Rotate access keys 1', exact: true });
    await record.focus(); await page.getByRole('tooltip').filter({ hasText: 'Rotate access keys 1' }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__vectorVisualization.selected())).toBe('record-1');
    const ingestion = page.locator('[data-slot="ingestion-pipeline-visualization"]');
    expect(await ingestion.getByText('Storage acknowledged', { exact: true }).count()).toBe(0);
    await ingestion.getByRole('button', { name: 'Inspect chunk 1', exact: true }).click();
    expect(await ingestion.getByRole('region', { name: 'Current chunk inspection' }).getByText('C1 of 3', { exact: true }).count()).toBe(1);
    expect(await ingestion.locator('.zero-viz__metadata').textContent()).toContain('1 · chars 0–108');
    await page.evaluate(() => {
      const snapshot = window.__vectorVisualization.ingestionState(), ingestion = snapshot.ingestion!;
      window.__vectorVisualization.ingestion({ ...snapshot, revision: snapshot.revision + 1, ingestion: { ...ingestion, completedChunks: 1,
        chunks: ingestion.chunks.map(chunk => chunk.index === 0 ? { ...chunk, storedAt: '2026-10-08T00:01:00Z' } : chunk) } });
    });
    await ingestion.getByText('Storage acknowledged', { exact: true }).waitFor();
  } finally { await close(page); }
}, 30_000);

browserTest('finishing visual animations never advances waiting ingestion or turns an embedding into a storage receipt', async () => {
  const page = await mount();
  try {
    await settle(page);
    const state = await page.evaluate(() => window.__vectorVisualization.ingestionState());
    expect(state.status).toBe('waiting'); expect(state.revision).toBe(2); expect(state.ingestion!.completedChunks).toBe(0);
    expect(await page.locator('[data-slot="ingestion-pipeline-visualization"] [data-stage="embed"]').getAttribute('aria-current')).toBe('step');
    expect(await page.locator('[data-slot="ingestion-pipeline-visualization"]').getByText('Storage acknowledged', { exact: true }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

for (const reduced of [true, false]) browserTest(`${reduced ? 'reduced motion' : 'motion opt-out'} preserves data while removing all organism animations`, async () => {
  const page = await mount(375, true, reduced);
  try {
    if (!reduced) { await page.evaluate(() => window.__vectorVisualization.motion(false)); await page.waitForFunction(() => document.querySelector('.zero-viz')?.getAttribute('data-motion') === 'off'); }
    await page.evaluate(() => {
      const snapshot = window.__vectorVisualization.searchState();
      window.__vectorVisualization.search({ ...snapshot, revision: snapshot.revision + 1, results: [...snapshot.results!].reverse() });
    });
    await settle(page);
    expect(await page.evaluate(() => document.getAnimations().filter(animation => (animation.effect as KeyframeEffect)?.target instanceof Element
      && ((animation.effect as KeyframeEffect).target as Element).closest('.zero-viz')).length)).toBe(0);
    expect(await page.getByRole('region', { name: 'Search results' }).isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await close(page); }
}, 30_000);

browserTest('inspector-only and caller token overrides affect both organisms without remounting transport', async () => {
  const page = await mount(1200, true, true);
  try {
    await page.evaluate(() => window.__vectorVisualization.presentation('inspector'));
    await page.waitForFunction(() => document.querySelectorAll('[data-slot="vector-map"]').length === 0);
    expect(await page.getByRole('region', { name: 'Query embedding' }).isVisible()).toBe(true);
    await page.locator('[data-slot="vector-search-visualization"]').evaluate(element => (element as HTMLElement).style.setProperty('--zero-viz-row-height', '44px'));
    expect(await page.locator('.zero-viz__result[data-record-id="record-1"]').evaluate(element => getComputedStyle(element).minHeight)).toBe('44px');
  } finally { await close(page); }
}, 30_000);

browserTest('paused motion keeps newly accepted rows and completion/error text immediately visible', async () => {
  const page = await mount();
  try {
    await settle(page);
    await page.evaluate(() => {
      const snapshot = window.__vectorVisualization.searchState();
      window.__vectorVisualization.search({ ...snapshot, status: 'waiting', revision: snapshot.revision + 1,
        stages: [{ id: 'query', label: 'Searching', status: 'waiting' }] });
    });
    await page.getByRole('status').filter({ hasText: 'Searching' }).waitFor();
    await page.getByRole('button', { name: 'Pause visualization motion', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-slot="vector-search-visualization"]')?.hasAttribute('data-paused'));
    await page.evaluate(() => {
      const snapshot = window.__vectorVisualization.searchState();
      const result = { ...snapshot.results![0]!, id: 'fresh-record', title: 'Newly delivered paused result', rank: 1, foundRank: 1 };
      window.__vectorVisualization.search({ ...snapshot, status: 'completed', revision: snapshot.revision + 1,
        candidates: [result], results: [result], stages: [{ id: 'query', label: 'Searching', status: 'completed' }] });
    });
    await page.getByRole('button', { name: 'Inspect Newly delivered paused result', exact: true }).waitFor();
    const state = await page.locator('[data-slot="vector-search-visualization"]').evaluate(element => ({
      rowOpacity: getComputedStyle(element.querySelector('.zero-viz__result')!).opacity,
      captionOpacity: getComputedStyle(element.querySelector('.zero-viz__caption-message')!).opacity,
      rowMotion: element.querySelector('.zero-viz__result')!.getAnimations().length,
      status: element.querySelector('.zero-viz__caption-message')!.textContent,
    }));
    expect(state).toEqual({ rowOpacity: '1', captionOpacity: '1', rowMotion: 0, status: 'Completed' });
    await page.evaluate(() => {
      const snapshot = window.__vectorVisualization.searchState();
      window.__vectorVisualization.search({ ...snapshot, status: 'failed', revision: snapshot.revision + 1,
        error: { code: 'SYNTHETIC', message: 'Safe failure received while paused' } });
    });
    await page.getByRole('alert').filter({ hasText: 'Safe failure received while paused' }).waitFor();
    expect(await page.locator('.zero-viz__caption-message').filter({ hasText: 'Safe failure received while paused' })
      .evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await page.screenshot({ path: join(artifacts, 'paused-live-results.png'), fullPage: true });
  } finally { await close(page); }
}, 30_000);

browserTest('cluster circles and record dots expose truthful tooltips with keyboard, pointer and selection behavior', async () => {
  const page = await mount(1200, false, true);
  try {
    const search = page.locator('[data-slot="vector-search-visualization"]');
    const cluster = search.locator('.zero-viz__cluster-target[data-cluster-id="billing"]');
    await cluster.focus();
    await page.getByRole('tooltip').filter({ hasText: '7 sampled records' }).waitFor();
    expect(await page.getByRole('tooltip').filter({ hasText: 'derived neighbor links' }).count()).toBe(1);
    expect(await cluster.evaluate(element => getComputedStyle(element).stroke !== 'rgba(0, 0, 0, 0)')).toBe(true);
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__vectorVisualization.selectedCluster())).toBe('billing');
    await cluster.press(' '); expect(await cluster.getAttribute('aria-pressed')).toBe('true');
    await search.getByRole('button', { name: 'Inspect Rotate leaked API keys', exact: true }).focus();
    await page.keyboard.press('Escape');
    const target = await cluster.evaluate(element => {
      const circle = element as SVGCircleElement, matrix = circle.getScreenCTM()!;
      const probes = Array.from({ length: 16 }, (_, index) => {
        const angle = index * Math.PI / 8, point = new DOMPoint(circle.cx.baseVal.value + Math.cos(angle) * circle.r.baseVal.value * .9,
          circle.cy.baseVal.value + Math.sin(angle) * circle.r.baseVal.value * .9).matrixTransform(matrix);
        return { x: point.x, y: point.y, hit: document.elementFromPoint(point.x, point.y) === circle };
      });
      return probes.find(point => point.hit) ?? null;
    });
    expect(target).not.toBeNull();
    await page.mouse.move(target!.x, target!.y);
    await page.getByRole('tooltip').filter({ hasText: '7 sampled records' }).waitFor();
    await page.mouse.move(5, 5);
    await page.getByRole('tooltip').filter({ hasText: '7 sampled records' }).waitFor({ state: 'hidden' });
    const record = search.locator('.zero-viz__point[data-record-id="record-1"]');
    await record.focus();
    await page.getByRole('tooltip').filter({ hasText: 'Result rank 1' }).waitFor();
    expect(await page.getByRole('tooltip').filter({ hasText: 'cosine 0.91' }).count()).toBe(1);
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await search.locator('.zero-viz__cluster-label[data-cluster-id="access"]').hover();
    await page.getByRole('tooltip').filter({ hasText: 'Access' }).waitFor();
    await search.locator('.zero-viz__cluster-label[data-cluster-id="access"]').click();
    expect(await page.evaluate(() => window.__vectorVisualization.selectedCluster())).toBe('access');
  } finally { await close(page); }
}, 30_000);

browserTest('custom per-record and per-cluster tooltip renderers reach both search and ingestion map targets', async () => {
  const page = await mount(1200, true, true);
  try {
    await page.evaluate(() => window.__vectorVisualization.customTooltips(true));
    for (const slot of ['ingestion-pipeline-visualization', 'vector-search-visualization']) {
      const organism = page.locator(`[data-slot="${slot}"]`);
      await organism.locator('.zero-viz__point[data-record-id="record-1"]').focus();
      const tooltip = page.getByRole('tooltip').filter({ hasText: 'Custom record: Rotate access keys 1' });
      await tooltip.waitFor(); expect(await tooltip.textContent()).toContain('384 dims');
      if (slot === 'vector-search-visualization') expect(await tooltip.textContent()).toContain('rank 1');
      else expect(await tooltip.textContent()).not.toContain('rank');
      await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
      await organism.locator('.zero-viz__point[data-record-id="record-1"]').press('Enter');
      expect(await page.evaluate(() => window.__vectorVisualization.selected())).toBe('record-1');
      await organism.locator('.zero-viz__cluster-target[data-cluster-id="billing"]').focus();
      await page.getByRole('tooltip').filter({ hasText: 'Custom cluster: Billing · 7 sampled records' }).waitFor();
      await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
      await organism.locator('.zero-viz__cluster-target[data-cluster-id="billing"]').press('Enter');
      expect(await page.evaluate(() => window.__vectorVisualization.selectedCluster())).toBe('billing');
    }
    const search = page.locator('[data-slot="vector-search-visualization"]');
    await search.locator('.zero-viz__cluster-target[data-cluster-id="access"]').focus();
    await page.getByRole('tooltip').filter({ hasText: '7 sampled records' }).waitFor();
    expect(await page.getByRole('tooltip').filter({ hasText: 'Custom cluster' }).count()).toBe(0);
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__vectorVisualization.customTooltips('hidden'));
    await search.locator('.zero-viz__cluster-target[data-cluster-id="billing"]').focus();
    await search.locator('.zero-viz__point[data-record-id="record-1"]').focus();
    expect(await page.getByRole('tooltip').count()).toBe(0);
    expect(await search.locator('.zero-viz__point[data-record-id="record-1"]').getAttribute('aria-describedby')).toBeNull();
    await page.screenshot({ path: join(artifacts, 'inspection-wiring.png'), fullPage: true });
  } finally { await close(page); }
}, 30_000);

browserTest('query marker exposes keyboard/default/custom inspection without pretending to select an indexed record', async () => {
  const page = await mount(1200, true, true);
  try {
    const search = page.locator('[data-slot="vector-search-visualization"]'), marker = search.getByRole('img', { name: 'Query marker', exact: true });
    await marker.focus();
    const defaults = page.getByRole('tooltip').filter({ hasText: 'How do I rotate a leaked API key?' });
    await defaults.waitFor(); expect(await defaults.textContent()).toContain('Vector retrieval');
    expect(await defaults.textContent()).toContain('requested top'); expect(await defaults.textContent()).toContain('384');
    expect(await defaults.textContent()).toContain('Reranking');
    expect(await marker.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    await page.keyboard.press('Escape'); await defaults.waitFor({ state: 'hidden' });
    await marker.press('Enter'); expect(await page.evaluate(() => window.__vectorVisualization.selected())).toBeUndefined();
    await search.getByRole('button', { name: 'Inspect Rotate leaked API keys', exact: true }).focus();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__vectorVisualization.customTooltips(true));
    await marker.focus();
    const custom = page.getByRole('tooltip').filter({ hasText: 'Custom query: How do I rotate a leaked API key? · vector · 384 dims' });
    await custom.waitFor(); expect(await custom.count()).toBe(1);
    await page.keyboard.press('Escape'); await custom.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__vectorVisualization.customTooltips('hidden'));
    await search.getByRole('button', { name: 'Inspect Rotate leaked API keys', exact: true }).focus();
    await page.keyboard.press('Escape');
    await marker.focus();
    expect(await marker.getAttribute('aria-describedby')).toBeNull(); expect(await page.getByRole('tooltip').count()).toBe(0);
    expect(await page.locator('[data-slot="ingestion-pipeline-visualization"] [data-slot="vector-query-inspection"]').count()).toBe(0);
    await page.screenshot({ path: join(artifacts, 'query-inspection.png'), fullPage: true });
  } finally { await close(page); }
}, 30_000);
