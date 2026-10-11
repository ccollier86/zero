/** Public-source entry qualification; not a published/archive release assertion. */
import { expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import manifest from '../../package.json';
import { buildSankeyModel, computeSankeyLayout, computeSankeyTrace,
  buildRaceBarModel, computeRaceBarSnapshot, computeRaceBarLayout, inspectRaceBarItem,
  buildFunnelModel, computeFunnelSnapshot, computeFunnelLayout, inspectFunnelStage } from './index';

test('headless facade is browser-independent and supports server-side aggregate math', () => {
  const model = buildSankeyModel({ nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b', value: 7 }] });
  expect(computeSankeyTrace(model, { kind: 'node', id: 'a' })?.value).toBe(7);
  expect(computeSankeyLayout(model, { width: 375 }).upright).toBe(true);
  const race = buildRaceBarModel({ items: [{ id: 'a' }, { id: 'b' }], frames: [
    { period: 'January', values: { a: 3, b: 7 } }, { period: 'February', values: { a: 9, b: 3 } },
  ] });
  const snapshot = computeRaceBarSnapshot(race, 1);
  expect(snapshot.rows[0]!.item.id).toBe('a');
  expect(inspectRaceBarItem(race, snapshot, 'a')?.share).toBe(.75);
  expect(computeRaceBarLayout(race, { width: 375 }).inside).toBe(true);
  const funnel = buildFunnelModel({ stages: [{ id: 'visit', value: 20 }, { id: 'activate', value: 10 }] });
  expect(computeFunnelSnapshot(funnel, { kind: 'total' }).conversionRate).toBe(.5);
  expect(inspectFunnelStage(funnel, { kind: 'total' }, 'activate')?.keptFromPrevious).toBe(.5);
  expect(computeFunnelLayout(funnel.stageCount, { width: 375 }).vertical).toBe(true);
  expect(manifest.exports['./charts'].import).toBe('./src/charts/index.ts');
  expect(manifest.exports['./charts/react'].import).toBe('./src/frontend/client/chart-query.ts');
  expect(manifest.exports['./components/charts'].import).toBe('./src/components/charts/index.ts');
});

test('actual public entries build in a browser and SSR preserves accessible exact data', async () => {
  const consumer = await import('./charts.package-fixture');
  const result = await Bun.build({ entrypoints: [new URL('./charts.package-fixture.tsx', import.meta.url).pathname],
    target: 'browser', format: 'esm', minify: false });
  expect(result.success).toBe(true);
  expect(result.logs.filter(log => log.level === 'error')).toEqual([]);
  const code = await result.outputs[0]!.text();
  expect(code).not.toContain('bun:sqlite');
  expect(code).not.toContain('zvec-adapter');
  expect(code).not.toContain('postgresql://');
  expect(consumer.queryHook).toBeFunction();
  expect(consumer.traced?.value).toBe(24);
  expect(consumer.raceSnapshot.rows[0]!.item.id).toBe('beta');
  expect(consumer.raceSnapshot.total).toBe(16);
  expect(consumer.funnelSnapshot.conversionRate).toBe(.5);
  const html = renderToString(React.createElement(consumer.ChartConsumer));
  expect(html).toContain('Synthetic packaged flow');
  expect(html).toContain('Synthetic source');
  expect(html).toContain('Synthetic target');
  expect(html).toContain('<table');
  expect(html).toContain('24');
  const raceHtml = renderToString(React.createElement(consumer.RaceChartConsumer));
  expect(raceHtml).toContain('Synthetic packaged ranking');
  expect(raceHtml).toContain('Synthetic Alpha');
  expect(raceHtml).toContain('Synthetic Beta');
  expect(raceHtml).toContain('January');
  expect(raceHtml).toContain('February');
  expect(raceHtml).toContain('<table');
  expect(raceHtml).toContain('Period');
  const funnelHtml = renderToString(React.createElement(consumer.FunnelChartConsumer));
  expect(funnelHtml).toContain('Synthetic packaged cohort');
  expect(funnelHtml).toContain('Visited');
  expect(funnelHtml).toContain('Activated');
  expect(funnelHtml).toContain('Direct');
  expect(funnelHtml).toContain('Referral');
  expect(funnelHtml).toContain('Kept from previous');
  expect(funnelHtml).toContain('<table');
  expect(funnelHtml).toContain('50%');
});

test('global stylesheet includes chart skin without replacing legacy chart tokens', async () => {
  const css = await Bun.file(new URL('../frontend/styles/globals.css', import.meta.url)).text();
  expect(css).toContain('@import "../../components/charts/sankey/sankey.css";');
  expect(css).toContain('@import "../../components/charts/race-bar/race-bar.css";');
  expect(css).toContain('@import "../../components/charts/chart-tokens.css";');
  expect(css).toContain('@import "../../components/charts/funnel/funnel.css";');
  expect(css).toContain('--chart-1: oklch(56.6% 0.19 257);');
  expect(css).toContain('--chart-5: oklch(63.4% 0.19 12);');
});
