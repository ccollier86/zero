/** Pure public style rendering: no provider/browser/chart data. */
import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartStyle } from './chart';

test('chart theme colors have separate default/light and dark selectors', () => {
  const html = renderToStaticMarkup(<ChartStyle id="synthetic" config={{
    usage: { theme: { light: 'var(--chart-1)', dark: 'var(--chart-2)' } },
  }} />);
  expect(html).toContain('[data-chart="synthetic"]');
  expect(html).toContain('--color-usage: var(--chart-1);');
  expect(html).toContain('.dark [data-chart="synthetic"]');
  expect(html).toContain('--color-usage: var(--chart-2);');
});

test('shared explicit colors preserve precedence in both theme modes', () => {
  const html = renderToStaticMarkup(<ChartStyle id="synthetic" config={{
    usage: { color: 'var(--chart-3)', theme: { light: 'red', dark: 'blue' } },
  }} />);
  expect(html).toContain('--color-usage: var(--chart-3);');
  expect(html).not.toContain('--color-usage: red;');
  expect(html).not.toContain('--color-usage: blue;');
});

test('a config without colors creates no style rule', () => {
  expect(renderToStaticMarkup(<ChartStyle id="synthetic" config={{ usage: { label: 'Usage' } }} />)).toBe('');
});
