/** Exact observed-time and SSR stream qualification, with no fabricated generator or provider. */
import * as React from 'react';
import { test, expect } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { RealtimeChart } from './realtime-chart';
import { buildRealtimeModel, computeRealtimeWindow, computeRealtimePaths } from './realtime-model';
const data = Object.freeze([{ id: 'a', time: 1000, value: 10 }, { id: 'b', time: 2000, value: null }, { id: 'c', time: 10000, value: 20, anomaly: { label: 'Latency threshold', severity: 'warning' as const } }, { id: 'd', time: 13000, value: -5 }]);
test('stream uses latest observed epoch, retains exact values and splits genuine null gaps', () => {
  const model = buildRealtimeModel(data); const view = computeRealtimeWindow(model, 12000);
  expect(view.start).toBe(1000); expect(view.end).toBe(13000); expect(view.data).toHaveLength(4);
  expect(view.domain).toEqual([-5, 20]); const paths = computeRealtimePaths(view);
  expect(paths).toHaveLength(2); expect(paths[0]!.id).toBe('a'); expect(paths[1]!.id).toBe('c'); expect(paths.every(path => !/NaN|Infinity/.test(path.d))).toBe(true);
  const held = computeRealtimeWindow(model, 12000, 10000); expect(held.data.at(-1)?.id).toBe('c');
  expect(model.data[2]!.anomaly?.label).toBe('Latency threshold'); expect(Object.isFrozen(model.data)).toBe(true);
});
test('stream rejects unsorted or duplicate observations, coercion, getters and oversized snapshots', () => {
  expect(() => buildRealtimeModel([data[2]!, data[0]!])).toThrow(); expect(() => buildRealtimeModel([data[0]!, data[0]!])).toThrow();
  expect(() => buildRealtimeModel([{ id: 'x', time: 1, value: '2' } as never])).toThrow();
  let called = 0; const bad = { id: 'x', time: 1, get value() { called++; return 2; } }; expect(() => buildRealtimeModel([bad])).toThrow(); expect(called).toBe(0);
  expect(() => buildRealtimeModel(Array.from({ length: 4097 }, (_, index) => ({ id: String(index), time: index, value: index })))).toThrow();
  expect(() => computeRealtimeWindow(buildRealtimeModel([]), 0)).toThrow();
});
test('public stream geometry consumes only detached admitted data and handles high-offset domains', () => {
  let called = 0; const bad = { get data() { called++; return []; }, latestTime: 1 };
  expect(() => computeRealtimeWindow(bad)).toThrow(); expect(called).toBe(0);
  const model = buildRealtimeModel([{ id: 'a', time: 1, value: 999999999999.9999 }, { id: 'b', time: 2, value: 1e12 }]);
  const view = computeRealtimeWindow(model, 1); expect(view.ticks.every(Number.isFinite)).toBe(true); expect(new Set(view.ticks).size).toBe(view.ticks.length);
  expect(computeRealtimePaths(view).every(path => !/NaN|Infinity/.test(path.d))).toBe(true);
});
test('SSR keeps every exact retained measurement, anomaly and missing record accessible', () => {
  const html = renderToString(<RealtimeChart label="Actual stream" data={data} motion={false} />);
  expect(html).toContain('Actual stream'); expect(html).toContain('Missing'); expect(html).toContain('Latency threshold'); expect(html).toContain('-5'); expect(html).toContain('1970-01-01T00:00:13.000Z'); expect(html).toContain('<table'); expect(html).toContain('Hold view');
  const empty = renderToString(<RealtimeChart label="Empty" data={[]} motion={false} />); expect(empty).toContain('No observed samples');
});
test('irregular stream vertices retain narrow measured spikes and exact SSR ignores rounded presentation', () => {
  const samples = [{ id: 'start', time: 0, value: 0 }, { id: 'spike', time: 1, value: 1e6 }, { id: 'return', time: 2, value: 0 }, { id: 'late', time: 1e6, value: 0 }];
  const view = computeRealtimeWindow(buildRealtimeModel(samples), 1e6);
  const path = computeRealtimePaths(view)[0]!.d;
  expect(path.split('L')).toHaveLength(4); expect(path).toContain(',12L');
  const exact = renderToString(<RealtimeChart label="Precision" data={[{ id: 'exact', time: 1.25, value: 1.123456789 }]} formatValue={() => '1'} formatTime={() => 'Today'} motion={false} />);
  expect(exact).toContain('1.123456789'); expect(exact).toContain('1970-01-01T00:00:00.001Z'); expect(exact).toContain('Sample ID');
  expect(exact).toContain('Epoch (ms)'); expect(exact).toContain('1.25');
});
