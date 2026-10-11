import { expect, test } from 'bun:test';
import { formatNativeChartNumber } from './native-format';
test('analytical default readouts never turn tiny signed measurements into observed zero', () => {
  expect(formatNativeChartNumber(1e-8)).toBe('1E-8'); expect(formatNativeChartNumber(-1e-8)).not.toBe('0');
  expect(formatNativeChartNumber(0)).toBe('0'); expect(formatNativeChartNumber(1.123456)).toBe('1.123');
  expect(formatNativeChartNumber(12345)).toBe('12,345');
  expect(() => formatNativeChartNumber(NaN)).toThrow(); expect(() => formatNativeChartNumber('1' as never)).toThrow();
});
