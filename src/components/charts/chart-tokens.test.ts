/** Shared chart role/mapping contracts; these checks never start app config, data providers or transports. */
import { expect, test } from 'bun:test';
import { chartSeriesPaint, CHART_CATEGORICAL_COLORS, CHART_FLOW_COLORS } from './chart-tokens';

test('named palette preserves stable categorical and flow order without overwriting legacy series', async () => {
  expect(CHART_CATEGORICAL_COLORS).toEqual(['blue', 'orange', 'green', 'amber']);
  expect(CHART_FLOW_COLORS).toEqual(['blue', 'purple', 'amber', 'teal', 'rose', 'olive']);
  expect(chartSeriesPaint(1, CHART_FLOW_COLORS, '--zero-chart-series-')).toBe('var(--zero-chart-series-1, var(--zero-chart-blue))');
  expect(chartSeriesPaint(3, CHART_FLOW_COLORS, '--zero-chart-series-')).toBe('var(--zero-chart-series-3, var(--zero-chart-amber))');
  expect(chartSeriesPaint(4, CHART_CATEGORICAL_COLORS, '--zero-race-bar-series-')).toBe('var(--zero-race-bar-series-4, var(--zero-chart-amber))');
  expect(chartSeriesPaint(5, CHART_CATEGORICAL_COLORS, '--zero-funnel-series-')).toBe('var(--zero-funnel-series-5, var(--zero-chart-blue))');
  const css = await Bun.file(new URL('./chart-tokens.css', import.meta.url)).text();
  expect(css).toContain('--zero-chart-blue: #2a78d6;'); expect(css).toContain('--zero-chart-blue: #3987e5;');
  expect(css).toContain('--zero-chart-amber: #eda100;'); expect(css).toContain('--zero-chart-amber: #c98500;');
  expect(css).not.toMatch(/--chart-[1-5]\s*:/u);
  expect(css).not.toMatch(/--zero-(?:chart|race-bar|funnel)-series-\d+\s*:/u);
});

test('shared analytical inspector roles replace competing defaults, not local override contracts', async () => {
  const css = await Bun.file(new URL('./chart-tokens.css', import.meta.url)).text();
  for (const [role, value] of Object.entries({
    'title-size': '14px', 'label-size': '12.5px', 'row-value-size': '12.5px', 'readout-size': '14px', 'metadata-size': '11.5px',
    'plot-radius': '10px', 'focus-width': '2px', 'focus-offset': '2px', feedback: '120ms', 'inspector-radius': '10px',
    'inspector-padding': '9px 12px', 'inspector-font-size': '12px', 'inspector-line-height': '1.45',
    'inspector-value-size': '17px', 'inspector-value-line-height': '1.3', 'inspector-max-width': '260px',
  })) expect(css).toContain(`--zero-chart-${role}: ${value};`);
  for (const name of ['sankey/sankey.css', 'race-bar/race-bar.css']) {
    const skin = await Bun.file(new URL(name, import.meta.url)).text();
    expect(skin).toContain('var(--zero-chart-inspector-radius, 10px)');
    expect(skin).toContain('var(--zero-chart-inspector-padding, 9px 12px)');
    expect(skin).toContain('var(--zero-chart-inspector-font-size, 12px)');
    expect(skin).toContain('var(--zero-chart-inspector-line-height, 1.45)');
    expect(skin).toContain('var(--zero-chart-inspector-shadow)');
    expect(skin).not.toMatch(/--zero-(?:sankey|race-bar)-inspector-(?:radius|padding|shadow|value-size)\s*:/u);
  }
});

test('shared palette expressions are SSR-safe and invalid indices cannot inject CSS token names', () => {
  for (const index of [NaN, Infinity, -1, 0, 1.5, 1e20, Number.MAX_VALUE])
    expect(chartSeriesPaint(index, CHART_CATEGORICAL_COLORS, '--zero-race-bar-series-')).toBe('var(--zero-race-bar-series-1, var(--zero-chart-blue))');
  expect(chartSeriesPaint(1, [], '--zero-chart-series-')).toBe('var(--zero-chart-series-1, var(--zero-chart-blue))');
});
