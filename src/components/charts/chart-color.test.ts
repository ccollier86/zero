/** Uniform data-color admission and color-only swatch paints across native and Arc chart families. Synthetic input only. */
import { expect, test } from 'bun:test';
import { isChartCssColor } from './chart-color';
import { buildLineChartModel } from './arc/line-chart/line-chart-model';
import { buildStreamgraphModel } from './arc/streamgraph/streamgraph-model';
import { buildDonutModel } from './arc/donut-chart/donut-chart-model';
import { buildWaffleModel } from './arc/waffle-chart/waffle-chart-model';
import { buildPieModel } from './native/polar/polar-model';
import { buildCartesianModel } from './native/cartesian/cartesian-model';

const admissions = [
  (color: string) => buildLineChartModel([], [{ id: 'a', label: 'A', color }]),
  (color: string) => buildStreamgraphModel([], [{ id: 'a', label: 'A', color }]),
  (color: string) => buildDonutModel([{ id: 'a', label: 'A', value: 1, color }]),
  (color: string) => buildWaffleModel([{ id: 'a', label: 'A', value: 1, color }]),
  (color: string) => buildPieModel([{ id: 'a', label: 'A', value: 1, color }]),
  (color: string) => buildCartesianModel([], [{ id: 'a', label: 'A', color }]),
];

test('every data-driven native/Arc color boundary rejects resources and malformed color properties', () => {
  for (const color of [
    'image-set("https://example.invalid/track.png" 1x)', 'linear-gradient(red,blue)',
    'var(--series, image-set("https://example.invalid/track.png" 1x))',
    'var(--series, url(#paint))', 'color-mix(in oklab, red, url(#paint))', 'red; fill:blue',
    'unknowncolor', 'rgb(1 2)', 'oklch(60% .2 40 / nope)',
  ]) {
    expect(isChartCssColor(color)).toBe(false);
    for (const admit of admissions) expect(() => admit(color)).toThrow(TypeError);
  }
});

test('the same token/absolute CSS color syntax is admitted by every native/Arc color boundary', () => {
  for (const color of ['#abcdef', 'rgb(20 40 60 / .5)', 'oklch(60% .2 40)',
    'color(display-p3 1 0 0)', 'var(--series, var(--zero-chart-blue, #abc))',
    'color-mix(in oklab, var(--zero-chart-blue) 70%, transparent)', 'light-dark(#123, #abc)']) {
    expect(isChartCssColor(color)).toBe(true);
    for (const admit of admissions) expect(() => admit(color)).not.toThrow();
  }
});

test('Arc raw-color swatches never use a resource-capable CSS background shorthand', async () => {
  for (const [file, token] of [
    ['arc/donut-chart/donut-chart.css', '--zero-arc-slice'],
    ['arc/waffle-chart/waffle-chart.css', '--zero-arc-cell'],
    ['arc/line-chart/line-chart.css', '--zero-arc-series'],
    ['arc/streamgraph/streamgraph.css', '--series'],
  ]) {
    const css = await Bun.file(new URL(file!, import.meta.url)).text();
    expect(css).not.toContain(`background: var(${token})`);
    expect(css).toContain(`background-color: var(${token})`);
  }
});
