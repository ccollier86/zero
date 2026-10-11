/** Handmade chart own-data and resource-paint qualification; only synthetic input. */
import { test, expect } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ownArray, ownRecord, numberValue, chartColor, chartId } from './admission';
import { NativeChartLegend } from './native-chart';
test('own records reject indexed or field getters without invocation and detach prototype-like IDs', () => {
  let called = 0; const input = Object.create(null); Object.defineProperty(input, 'value', { get() { called++; return 2; } });
  expect(() => ownRecord(input, 'row')).toThrow(); expect(called).toBe(0);
  const own = Object.create(null); own.__proto__ = 3; own.constructor = 4;
  expect(ownRecord(own, 'row')).toEqual(own); expect(() => ownRecord({ other: 1 }, 'row', ['value'])).toThrow();
  expect(chartId('__proto__', 'id')).toBe('__proto__');
});
test('dense arrays reject extra methods, symbol iterators, sparse and custom prototypes before execution', () => {
  let called = 0; const values = [1, 2]; Object.defineProperty(values, 'map', { get() { called++; return Array.prototype.map; } });
  expect(() => ownArray(values, 'data')).toThrow(); expect(called).toBe(0);
  const symbolic = [1]; Object.defineProperty(symbolic, Symbol.iterator, { get() { called++; return Array.prototype[Symbol.iterator]; } });
  expect(() => ownArray(symbolic, 'data')).toThrow(); expect(called).toBe(0);
  const indexed = [1]; Object.defineProperty(indexed, '0', { get() { called++; return 1; } }); expect(() => ownArray(indexed, 'data')).toThrow();
  expect(() => ownArray(new Array(2), 'data')).toThrow();
  const inherited = [1]; Object.setPrototypeOf(inherited, { map() { called++; return []; } }); expect(() => ownArray(inherited, 'data')).toThrow(); expect(called).toBe(0);
  const frozen = Object.freeze([1, 2]); const copy = ownArray(frozen, 'data'); copy[0] = 8; expect(frozen).toEqual([1, 2]);
});
test('numbers reject coercion and paints reject resource or escaped style execution', () => {
  expect(() => numberValue('12', 'value')).toThrow(); expect(() => numberValue(Infinity, 'value')).toThrow(); expect(() => numberValue(1e12 + 1, 'value')).toThrow();
  expect(numberValue(-5, 'value')).toBe(-5); expect(numberValue(8.64e15, 'epoch', { min: -8.64e15, max: 8.64e15 })).toBe(8.64e15);
  for (const value of ['url(https://example.org)', 'u\\72l(test)', 'u/**/rl(test)', 'red;display:none', '<style>']) expect(() => chartColor(value, 'color')).toThrow();
  expect(chartColor('var(--zero-chart-blue)', 'color')).toBe('var(--zero-chart-blue)');
});

test.each([
  'red', 'ReBeccAPurple', 'currentColor', 'transparent', 'darkslategrey', 'lightgoldenrodyellow',
  '#aBc', '#aBcD', '#123456', '#12345678', '  #123456  ',
  'rgb(1, 2, 3)', 'rgba(1,2,3,.5)', 'RGB(20%, 30%, 40%)', 'rgb(1e2 -2 .3 / 50%)',
  'rgb(none 20% 0 / none)', 'hsl(240, 50%, 60%)', 'hsla(240deg,50%,60%,.5)', 'hsl(.5turn 50% 40% / .6)',
  'hwb(240grad 20% 30%)', 'hwb(none 0% 20% / none)', 'lab(50% -20 30)', 'lch(50 30 20deg / 60%)',
  'oklab(.7 .1 -.1 / .5)', 'oklch(70% .15 120)', 'color(display-p3 1 0 0 / .8)', 'color(xyz-d65 .5 .4 .3)',
  'var(--zero-chart-blue)', 'var(--zero_chart_blue, #abc)', 'var(--chart-color, var(--fallback, red))',
  'rgb(var(--channels))', 'rgb(var(--channels, 1 2 3) / .5)', 'hsl(var(--theme-hsl) / 60%)',
  'rgb(var(--red, 30) 20 10)', 'color(srgb var(--channels, .2 .3 .4))',
  'color-mix(in oklab, var(--zero-chart-blue) 70%, transparent)',
  'color-mix(in oklch longer hue, red 20%, blue 80%)',
  'color-mix(in xyz-d65, #abc 50%, color(display-p3 1 0 0 / .5))',
  'light-dark(#aaa, var(--dark, rgb(0 0 0 / 20%)))',
])('admit complete SSR-safe color syntax: %s', value => {
  expect(chartColor(value, 'color')).toBe(value);
});

test.each([
  'image-set("https://example.invalid/track.png" 1x)', 'image-set(url(x) 1x)', '-webkit-image-set("x" 1x)',
  'linear-gradient(red,blue)', 'radial-gradient(red,blue)', 'conic-gradient(red,blue)', 'cross-fade(red,blue,50%)',
  'paint(tracker)', 'element(#tracker)', 'image(red)', 'url(#paint)',
  'var(--color, image-set("https://example.invalid/track.png" 1x))', 'var(--color, linear-gradient(red,blue))',
  'var(--color, url(x))', 'color-mix(in oklab, red, image-set(x 1x))', 'light-dark(red, url(x))',
  'var(--a, var(--b, radial-gradient(red,blue)))', 'var(--a, red; background-image: none)',
  'none', 'context-fill', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'definitelynotacolor', 'lawn',
  '#12345', '#1234567', '#ggg', 'rgb()', 'rgb(1 2)', 'rgb(1 2 3 4)', 'rgb(1 2 3 / 1 / 1)', 'rgb(10px 2 3)',
  'rgb(1, 2%, 3)', 'rgba(1,2,3,1,1)', 'rgb(1,2,none)', 'hsl(20 30 40)', 'hwb(20,30%,40%)',
  'lab(20 30)', 'oklch(.7 .1 20%)', 'color(custom-profile 1 0 0)', 'color(srgb 1 0)',
  'color-mix(in unknown, red, blue)', 'color-mix(in oklab shorter hue, red, blue)',
  'color-mix(in oklab, red -1%, blue)', 'color-mix(in oklab, red 101%, blue)', 'color-mix(in oklab, red 0%, blue 0%)',
  'light-dark(red)', 'light-dark(red,blue,green)', 'var(--a,)', 'var(color)', 'var(--a, red,blue)',
  'rgb(from red r g b)', 'rgb(calc(1 + 2) 0 0)', 'rgb(1e999 2 3)', 'rgb(1 2 3))', 'rgb(1 2 3) red',
  'red/*comment*/', 'r\\65d', 'red\v', 'red\0',
])('reject images, arbitrary properties and unsupported/malformed colors: %s', value => {
  expect(() => chartColor(value, 'color')).toThrow(TypeError);
});

test('color expression budgets bound nested token fallback work and reject non-string coercion', () => {
  const nested = (depth: number) => Array.from({ length: depth }, () => 'var(--a,').join('') + 'red' + ')'.repeat(depth);
  expect(() => chartColor(nested(12), 'color')).not.toThrow();
  expect(() => chartColor(nested(13), 'color')).toThrow(TypeError);
  expect(() => chartColor(' '.repeat(256) + 'red', 'color')).toThrow(TypeError);
  let coerced = false;
  expect(() => chartColor({ toString() { coerced = true; return 'red'; } }, 'color')).toThrow(TypeError);
  expect(coerced).toBe(false);
});

test('all native legend branches paint a color-only property, never a resource-capable background shorthand', () => {
  for (const onToggle of [undefined, (_id: string) => undefined]) {
    const html = renderToStaticMarkup(React.createElement(NativeChartLegend, { items: [{ id: 'a', label: 'A', color: '#123456' }], onToggle }));
    expect(html).toContain('background-color:#123456');
    expect(html).not.toContain('background:');
  }
});
