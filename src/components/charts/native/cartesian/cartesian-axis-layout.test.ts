/** Caption reservation and text budgets are independent of exact domain/measurement values. */
import { expect, test } from 'bun:test';
import { buildCartesianModel } from './cartesian-model';
import { computeCartesianLayout } from './cartesian-layout';
import { fitChartText, sampleChartTicks, horizontalChartAxisText } from '../shared/chart-text-layout';
const data = [{ id: 'negative', label: 'Expense', values: { net: -50 } }, { id: 'zero', label: 'No transactions', values: { net: 0 } }, { id: 'positive', label: 'Payment', values: { net: 50 } }];
test('captions own reserved lanes and both numeric sides use real gutters', () => {
  for (const layout of ['vertical', 'horizontal'] as const) for (const side of ['left', 'right'] as const) for (const fontSize of [11.5, 18]) {
    const model = buildCartesianModel(data, [{ id: 'net', label: 'Net cash' }], { layout, xAxis: { label: 'Billing period' }, yAxes: [{ id: 'primary', label: 'USD', side }] });
    for (const width of [120, 340, 640]) {
      const geometry = computeCartesianLayout(model, width, 210, { fontSize, formatYTick: value => `USD ${value.toFixed(2)}` });
      expect(geometry.plotHeight).toBeGreaterThan(0); expect(geometry.plotWidth).toBeGreaterThan(0); expect(geometry.independentCaption?.fullText).toBe('Billing period');
      const axis = geometry.axes[0]!; expect(axis.caption?.fullText).toBe('USD');
      for (const tick of axis.ticks) {
        expect(tick.position).toBe(geometry.mapY(tick.value)); expect(tick.textLayout.maxWidth).toBeGreaterThanOrEqual(0);
        if (layout === 'vertical') expect(Math.abs(axis.caption!.y - tick.textLayout.y)).toBeGreaterThan(fontSize + 6);
      }
      expect(model.data.map(row => row.cells.net!.value)).toEqual([-50, 0, 50]);
    }
  }
});
test('bottom tick descenders retain a font-relative lane without an independent caption', () => {
  for (const fontSize of [11.5, 18, 26, 48]) for (const width of [340, 640]) {
    const model = buildCartesianModel(data, [{ id: 'net', label: 'Net cash' }], { yAxes: [{ id: 'primary', label: 'USD' }] });
    const geometry = computeCartesianLayout(model, width, 300, { fontSize });
    expect(geometry.independentCaption).toBeNull();
    for (const tick of geometry.independentTicks) expect(geometry.top + tick.textLayout.y + fontSize * .35).toBeLessThanOrEqual(geometry.height);
    expect(model.data.map(row => row.cells.net!.value)).toEqual([-50, 0, 50]);
  }
});
test('shortening preserves graphemes, full formats and deterministic fallback measurements', () => {
  expect(fitChartText('👩‍💻👩‍💻👩‍💻', 2, { fontSize: 1, measureText: text => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length })).toBe('👩‍💻…');
  expect(fitChartText('123456789', 20, { fontSize: 10, measureText: () => NaN })).toBe('12…');
  expect(fitChartText('full', 0, { fontSize: 11.5 })).toBe('');
  expect(sampleChartTicks([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4]);
  const texts = horizontalChartAxisText([{ position: 0, label: 'long value' }, { position: 100, label: 'another long value' }], 100, 10, { fontSize: 11.5 });
  expect(texts[0]!.textLayout.maxWidth).toBe(47); expect(texts[1]!.textLayout.maxWidth).toBe(47);
});
