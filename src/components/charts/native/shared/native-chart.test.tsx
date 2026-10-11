/** Shared analytical frame accessibility and swatch SSR contracts; no browser or data provider. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeChartFrame } from './native-chart';

test('opted-in native summaries reserve a persistent atomic live node before inspection begins', () => {
  const empty = renderToStaticMarkup(<NativeChartFrame label="Before inspection" summary={undefined}><div>Plot</div></NativeChartFrame>);
  const reading = renderToStaticMarkup(<NativeChartFrame label="During inspection" summary="Alpha: 1.25"><div>Plot</div></NativeChartFrame>);
  expect(empty).toContain('aria-live="polite" aria-atomic="true"></div>');
  expect(reading).toContain('aria-live="polite" aria-atomic="true">Alpha: 1.25</div>');
  expect(empty.match(/aria-live=/g)).toHaveLength(1); expect(reading.match(/aria-live=/g)).toHaveLength(1);
});
test('organisms owning a described readout do not receive a duplicate frame announcement region', () => {
  const html = renderToStaticMarkup(<NativeChartFrame label="Own readout"><div aria-live="polite">Exact value</div></NativeChartFrame>);
  expect(html.match(/aria-live=/g)).toHaveLength(1);
});
