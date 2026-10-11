/** Race Bar SSR contracts and pure React inspection bodies; no browser globals or data clients are required. */
import { expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RaceBarChart, RaceBarHistoryTable } from './race-bar-chart';
import { RaceBarItemTooltip } from './race-bar-inspection';
import { buildRaceBarModel, computeRaceBarSnapshot, inspectRaceBarItem } from './race-bar-model';
import { RACE_BAR_DEFAULTS, RACE_BAR_MOTION_DEFAULTS } from './race-bar-math';
const data = { items: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], frames: [{ period: 'January', values: { a: 100, b: 200 } }, { period: 'February', values: { a: 200, b: 100 } }] };
test('reference organism is SSR safe, with exact history fallback and native accessible timeline', () => {
  const html = renderToStaticMarkup(<RaceBarChart data={data} label="Revenue" title="Revenue by item" />);
  expect(html).toContain('data-slot="race-bar-chart"'); expect(html).toContain('<caption>Revenue</caption>'); expect(html).toContain('type="range"');
  expect(html).toContain('aria-label="Period"'); expect(html).toContain('Values between periods are interpolated.'); expect(html).not.toContain('<canvas'); expect(html).not.toContain('<script');
});
test('all supplied pacing and motion defaults remain explicit', () => {
  expect(RACE_BAR_DEFAULTS).toMatchObject({ bars: 8, frameDuration: 1400, autoPlay: true, loop: false, defaultFrame: 0 });
  expect(RACE_BAR_MOTION_DEFAULTS).toEqual({ clock: 9, scrub: 22, row: 11, opacity: 13, tick: 14, periodEnterMs: 420, periodExitMs: 300 });
});
test('real interpolated inspection does not mislabel its exact-period comparison', () => {
  const model = buildRaceBarModel(data), snapshot = computeRaceBarSnapshot(model, .8), context = inspectRaceBarItem(model, snapshot, 'a')!;
  const html = renderToStaticMarkup(<RaceBarItemTooltip {...context} model={model} formatValue={String} totalLabel="Total" />);
  expect(html).toContain('Rank 1 of 2'); expect(html).toContain('100.0% (February) vs January'); expect(context.value).not.toBe(context.frameValue);
});
test('options can hide chrome without hiding accessible history', () => {
  const html = renderToStaticMarkup(<RaceBarChart data={data} label="Compact" showControls={false} showLegend={false} showTotal={false} />);
  expect(html).not.toContain('type="range"'); expect(html).not.toContain('aria-label="Play"'); expect(html).toContain('<caption>Compact</caption>');
});
test('empty and single-period inputs remain truthful and safe', () => {
  expect(renderToStaticMarkup(<RaceBarChart data={{ items: [], frames: [] }} label="Empty" />)).toContain('No rankings yet');
  const html = renderToStaticMarkup(<RaceBarChart data={{ ...data, frames: data.frames.slice(0, 1) }} label="Once" />);
  expect(html).toContain('disabled=""'); expect(html).toContain('max="0"');
});
test('history labels and custom content are escaped rather than treated as trusted HTML', () => {
  const model = buildRaceBarModel({ items: [{ id: 'x', label: '<img onerror=oops>' }], frames: [{ period: '<script>alert(1)</script>', values: { x: 1 } }] });
  const html = renderToStaticMarkup(<RaceBarHistoryTable model={model} label="Safe" />);
  expect(html).toContain('&lt;img onerror=oops&gt;'); expect(html).not.toContain('<img'); expect(html).not.toContain('<script>');
});
test('invalid configuration fails explicitly before allocating browser paint', () => {
  for (const options of [{ bars: 65 }, { bars: 0 }, { frameDuration: Infinity }, { frameDuration: 0 }, { frame: NaN }])
    expect(() => renderToStaticMarkup(<RaceBarChart data={data} label="Invalid" {...options} />)).toThrow('Race Bar');
});
test('extreme finite comparison percentages remain readable rather than overflowing to Infinity', () => {
  const model = buildRaceBarModel({ items: [{ id: 'a' }], frames: [{ period: 'Before', values: { a: 1 } }, { period: 'After', values: { a: 1e308 } }] });
  const context = inspectRaceBarItem(model, computeRaceBarSnapshot(model, 1), 'a')!;
  const html = renderToStaticMarkup(<RaceBarItemTooltip {...context} model={model} formatValue={String} totalLabel="Total" />);
  expect(html).not.toContain('Infinity'); expect(html).toContain('1.0e+310% vs Before');
});
