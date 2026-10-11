/** Actual public-entry browser/SSR qualification, not a published release claim. */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { expect, test } from 'bun:test';
import manifest from '../../package.json';
import * as consumer from './arc.package-fixture';
import { ARC_CHART_MOTION_DEFAULTS } from './arc';

test('Arc public math is independent of React, browser, transport and data providers', async () => {
  const result = await Bun.build({ entrypoints: [new URL('./arc.ts', import.meta.url).pathname], target: 'browser', format: 'esm' });
  expect(result.success).toBe(true);
  const code = await result.outputs[0]!.text();
  for (const forbidden of ['react-dom', 'useEffect', 'requestAnimationFrame', 'bun:sqlite', 'zvec-adapter', 'createClient']) expect(code).not.toContain(forbidden);
  expect(manifest.exports['./charts/arc'].import).toBe('./src/charts/arc.ts');
  expect(manifest.exports['./components/charts/arc'].import).toBe('./src/components/charts/arc/index.ts');
  expect(Object.isFrozen(ARC_CHART_MOTION_DEFAULTS)).toBe(true);
  expect(Object.isFrozen(ARC_CHART_MOTION_DEFAULTS.spring.morph)).toBe(true);
  expect(Object.isFrozen(ARC_CHART_MOTION_DEFAULTS.ease.enter)).toBe(true);
});

test('all twelve actual Arc exports browser-build and SSR exposes exact labeled data', async () => {
  expect(consumer.models).toHaveLength(12); expect(consumer.queryHook).toBeFunction();
  const result = await Bun.build({ entrypoints: [new URL('./arc.package-fixture.tsx', import.meta.url).pathname], target: 'browser', format: 'esm' });
  expect(result.success).toBe(true); expect(result.logs.filter(log => log.level === 'error')).toEqual([]);
  const code = await result.outputs[0]!.text();
  for (const forbidden of ['bun:sqlite', 'zvec-adapter', 'postgresql://']) expect(code).not.toContain(forbidden);
  const html = renderToString(React.createElement(consumer.ArcConsumer));
  for (const label of ['Synthetic Line', 'Synthetic Bars', 'Synthetic Donut', 'Synthetic Stream', 'Synthetic Brush',
    'Synthetic Waffle', 'Synthetic Slope', 'Synthetic Sparkline', 'Synthetic Gauge', 'Synthetic Activity',
    'Synthetic Distribution', 'Synthetic Hierarchy']) expect(html).toContain(label);
  expect(html).toContain('Synthetic Alpha'); expect(html).toContain('January'); expect(html).toContain('Before');
  expect(html).toContain('2026-01-02'); // Missing calendar dates are represented, not omitted.
  expect((html.match(/<table/g) ?? []).length).toBeGreaterThanOrEqual(10);
});

test('the Arc skin extends Zero roles without installing upstream global theme or fonts', async () => {
  const css = await Bun.file(new URL('../frontend/styles/globals.css', import.meta.url)).text();
  expect(css).toContain('@import "../../components/charts/arc/arc-charts.css";');
  const skin = await Bun.file(new URL('../components/charts/arc/arc-charts.css', import.meta.url)).text();
  expect((skin.match(/@import/g) ?? []).length).toBe(14);
  const tokens = await Bun.file(new URL('../components/charts/arc/shared/arc-chart-tokens.css', import.meta.url)).text();
  expect(tokens).not.toContain('--foreground:'); expect(tokens).not.toContain('--surface:');
  expect(tokens).not.toContain('@font-face'); expect(tokens).not.toContain('fonts.googleapis');
  expect(tokens).toContain('--zero-arc-ease-spring');
});
