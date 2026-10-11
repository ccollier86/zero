/** Reversible DatePicker facade, original byte preservation and SSR naming/field behavior. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatePicker } from './date-picker-scroll';
import { DatePicker as NativeDatePicker } from './date-picker';
import * as Public from '../../ui/date-picker';
import * as Family from './index';

test('new DatePicker facade keeps native and Arc server anatomy identical and does not execute value callbacks', () => {
  let calls = 0;
  const props = { value: new Date(2026, 1, 3), inputProps: { name: 'dueDate', 'aria-label': 'Due date' },
    onChange: () => { calls++; }, onInputValueChange: () => { calls++; } };
  const normalized = (markup: string) => markup.replace(/_R_[^" ]*_/gu, 'SSR-ID');
  const native = normalized(renderToStaticMarkup(<NativeDatePicker {...props} />));
  for (const scrollTreatment of ['arc', 'native'] as const) {
    const markup = normalized(renderToStaticMarkup(<DatePicker {...props} scrollTreatment={scrollTreatment} />));
    expect(markup).toBe(native);
    expect(markup).toContain('name="dueDate"');
    expect(markup).not.toContain('scrollTreatment=');
    expect(markup).not.toContain('zero-scroll-decoration');
  }
  expect(calls).toBe(0);
});
test('live Arc/native choices retain the same provider and original engine position instead of remounting picker state', () => {
  const calendarProps = { startMonth: new Date(2000, 0), endMonth: new Date(2100, 11) };
  const arc = DatePicker({ scrollTreatment: 'arc', calendarProps });
  const native = DatePicker({ scrollTreatment: 'native', calendarProps });
  expect(arc.type).toBe(native.type);
  expect(arc.props.children.type).toBe(native.props.children.type);
  expect(native.props.children.type).toBe(NativeDatePicker);
  expect(native.props.children.props.calendarProps).toBe(calendarProps);
  expect(arc.props.children.props.calendarProps.components.Root).toBeDefined();
});

test('public shim and family share the new facade while the original engine and calendar remain byte-identical', async () => {
  expect(Public.DatePicker).toBe(DatePicker); expect(Family.DatePicker).toBe(DatePicker);
  expect(DatePicker).not.toBe(NativeDatePicker);
  for (const [file, hash] of [
    ['date-picker.tsx', '1ce7fd94485db70e992c37a79107a8ed15501d32b640bc03a568240e93b08787'],
    ['calendar.tsx', 'f4bda65ee93e083ccb4361afddbff10f500dc048b83898e7c15db0935cd5095c'],
    ['calendar-view-context.tsx', 'b0921a5c3d803c26b60eb2d2771257f5194898836ce08496167c104ce9a1eb2e'],
  ]) expect(new Bun.CryptoHasher('sha256').update(await Bun.file(import.meta.dir + '/' + file).arrayBuffer()).digest('hex'), file).toBe(hash);
});
