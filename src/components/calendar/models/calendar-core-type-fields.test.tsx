/** Memory markup only; native browser focus, animation and layout remain separate qualification gates. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarCoreTypeFields } from '../components/calendar-core-type-fields';
const type = { id: 'type-a', revision: 2, label: 'PRIVATE_SYNTHETIC_TYPE', durationMinutes: 37, bufferBeforeMinutes: 3, bufferAfterMinutes: 9, colorKey: 'type:blue' };
const page = { items: [{ ...type, active: true }], truncated: false, nextAfter: null };
test('current supplied native type renders its exact duration/buffers without exposing identity or color metadata', () => {
  const html = renderToStaticMarkup(<CalendarCoreTypeFields value={{ appointmentType: type }} types={page} status="ready" onChange={() => {}} />);
  expect(html).toContain(type.label); expect(html).toContain('37 minutes'); expect(html).toContain('3 before / 9 after'); expect(html).not.toContain(type.colorKey);
  expect(html).not.toContain('accepted version');
});
for (const status of ['idle', 'loading', 'error'] as const) test(`${status} withdraws all stale selected/catalog/accepted labels and typed policy presentation`, () => {
  const html = renderToStaticMarkup(<CalendarCoreTypeFields value={{ appointmentType: type }} types={page} acceptedType={type} status={status} onChange={() => {}} onRetry={() => {}} />);
  expect(html).not.toContain(type.label); expect(html).not.toContain('37 minutes'); expect(html).not.toContain('3 before');
  if (status === 'error') expect(html).toContain('Retry types');
});
test('only a record accepted historical snapshot stays named when the authorized current page updates its version', () => {
  const current = { ...page, items: [{ ...type, revision: 3, label: 'PRIVATE_NEW_LABEL', active: true }] };
  const retained = renderToStaticMarkup(<CalendarCoreTypeFields value={{}} types={current} acceptedType={type} status="ready" onChange={() => { throw new Error('Render cannot change a draft.'); }} />);
  expect(retained).toContain(type.label); expect(retained).toContain('accepted version'); expect(retained).not.toContain('The draft type is not');
  const pending = renderToStaticMarkup(<CalendarCoreTypeFields value={{ appointmentType: type }} types={current} status="ready" onChange={() => {}} />);
  expect(pending).not.toContain(type.label); expect(pending).not.toContain('37 minutes'); expect(pending).toContain('The draft type is not on this authorized page');
});
test('an empty bounded page never claims all resources allow untyped booking or silently changes an old draft choice', () => {
  const html = renderToStaticMarkup(<CalendarCoreTypeFields value={{ appointmentType: type }} types={{ items: [], truncated: true, nextAfter: 'opaque-next' }}
    status="ready" canGoBack onChange={() => { throw new Error('Render cannot change a draft.'); }} onPrevious={() => {}} onNext={() => {}} />);
  expect(html).not.toContain(type.label); expect(html).toContain('The server decides whether an untyped booking is permitted');
  expect(html).toContain('Previous types'); expect(html).toContain('Next types'); expect(html).not.toContain('opaque-next');
});
test('explicit clear is shown independently from retained accepted type history', () => {
  const html = renderToStaticMarkup(<CalendarCoreTypeFields value={{ appointmentType: null }} types={page} acceptedType={type} status="ready" onChange={() => {}} />);
  expect(html).toContain('No type · explicitly clear binding'); expect(html).not.toContain('37 minutes'); expect(html).not.toContain('accepted type version');
});
