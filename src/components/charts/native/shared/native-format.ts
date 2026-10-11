/** Shared compact analytical readouts; exact data companions retain unrounded raw values. */
const ordinary = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const scientific = new Intl.NumberFormat('en-US', { notation: 'scientific', maximumSignificantDigits: 4 });
/** Tiny nonzero observations must not appear to be measured zero; caller formatters remain explicit presentation choices. */
export function formatNativeChartNumber(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Chart readouts require finite numbers');
  return value !== 0 && Math.abs(value) < .001 ? scientific.format(value) : ordinary.format(value);
}
