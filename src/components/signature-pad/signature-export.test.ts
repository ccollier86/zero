import { describe, expect, test } from 'bun:test';
import {
  resolveSignaturePadFrame, serializeSignaturePad, signaturePadToBlob,
  signaturePadToDataURL, signaturePadToSVG,
} from './signature-export';
import type { SignaturePadExportOptions, SignaturePadFormat, SignaturePadStroke } from './signature-pad.types';
import { validateSignaturePadStrokes } from './signature-model';

const strokes: readonly SignaturePadStroke[] = [{ points: [[10.25, 20.5, 3], [30.75, 40.25, 5]] }];

describe('signature SVG export', () => {
  test('crops by rounding edges outward, including full width and padding', () => {
    expect(resolveSignaturePadFrame(strokes)).toEqual({ x: 0, y: 11, width: 42, height: 40 });
    expect(resolveSignaturePadFrame(strokes, { padding: 0 })).toEqual({ x: 8, y: 19, width: 26, height: 24 });
    const svg = signaturePadToSVG(strokes);
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 11 42 40" width="42" height="40">');
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain('<rect');
  });

  test('can frame the full area instead of cropping', () => {
    expect(resolveSignaturePadFrame(strokes, { crop: false, width: 300, height: 200 })).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(resolveSignaturePadFrame(strokes, { crop: false })).toEqual({ x: 0, y: 0, width: 42, height: 51 });
    expect(resolveSignaturePadFrame(strokes, { crop: false, width: 300 })).toEqual({ x: 0, y: 0, width: 300, height: 51 });
  });

  test('empty and all-negative origin frames retain positive dimensions', () => {
    expect(resolveSignaturePadFrame([])).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(resolveSignaturePadFrame([], { width: 250 })).toEqual({ x: 0, y: 0, width: 250, height: 1 });
    expect(resolveSignaturePadFrame([{ points: [[-50, -60, 2]] }], { crop: false })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(signaturePadToSVG([])).not.toContain('<path');
  });

  test('safe stroke colors override fallback and background uses the resolved frame', () => {
    const svg = signaturePadToSVG([{ points: [[10, 10, 2]], color: '#f00' }, { points: [[30, 30, 4]] }], {
      color: 'rgb(20, 30, 40)', background: '#fff', padding: 0,
    });
    expect(svg).toContain('<rect x="9" y="9" width="23" height="23" fill="#fff"/>');
    expect(svg).toContain('fill="#f00"');
    expect(svg).toContain('fill="rgb(20, 30, 40)"');
  });

  test('round-trip SVG data URL and canonical JSON use the same ink', () => {
    const value = serializeSignaturePad(strokes);
    expect(value).toStartWith('data:image/svg+xml;charset=utf-8,');
    expect(decodeURIComponent(value.split(',')[1])).toBe(signaturePadToSVG(strokes));
    expect(signaturePadToDataURL(strokes)).toBe(value);
    expect(JSON.parse(serializeSignaturePad(strokes, 'json'))).toEqual(strokes);
    const extra: unknown = [{ points: [[1, 2, 3]], notInk: 'private' }];
    validateSignaturePadStrokes(extra);
    expect(serializeSignaturePad(extra, 'json')).not.toContain('private');
  });

  test('empty point arrays serialize as empty required-field values', async () => {
    for (const value of [[], [{ points: [] }]] as readonly SignaturePadStroke[][]) {
      expect(serializeSignaturePad(value, 'svg')).toBe('');
      expect(serializeSignaturePad(value, 'json')).toBe('');
      expect(signaturePadToDataURL(value)).toBe('');
      expect(await signaturePadToBlob(value)).toBeNull();
    }
  });

  test('SVG Blob works without window, document, canvas, or base64', async () => {
    expect(typeof window).toBe('undefined');
    const blob = await signaturePadToBlob(strokes);
    expect(blob?.type).toBe('image/svg+xml');
    expect(await blob?.text()).toBe(signaturePadToSVG(strokes));
  });

  test.each([
    { width: 0 }, { height: -1 }, { width: Infinity }, { height: NaN },
    { width: 3_000_000 }, { padding: -1 }, { padding: Infinity }, { padding: 4_097 },
    { crop: 'yes' }, { color: 'url(https://attacker.test/x)' },
    { background: '"><script>alert(1)</script>' }, { background: 'var(--background)' },
  ])('rejects invalid framing and unsafe SVG paints', (options) => {
    expect(() => signaturePadToSVG(strokes, options as SignaturePadExportOptions)).toThrow();
    expect(() => serializeSignaturePad([], 'json', options as SignaturePadExportOptions)).toThrow();
  });

  test('rejects unsafe stroke colors in both SVG and JSON before output', () => {
    const unsafe: SignaturePadStroke[] = [{ points: [[1, 2, 3]], color: '#000" onload="steal()' }];
    expect(() => signaturePadToSVG(unsafe)).toThrow(TypeError);
    expect(() => serializeSignaturePad(unsafe, 'json')).toThrow(TypeError);
    expect(() => serializeSignaturePad(strokes, 'png' as SignaturePadFormat)).toThrow(TypeError);
  });

  test('handles bounded large-coordinate ink and rejects resource-bomb options', () => {
    const large: SignaturePadStroke[] = [{ points: [[-1_000_000, 0, 256], [1_000_000, 0, 256]] }];
    const svg = signaturePadToSVG(large, { padding: 0 });
    expect(svg).toContain('width="2000256"');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(() => signaturePadToSVG(large, { padding: 4_096 })).toThrow(RangeError);
    expect(() => signaturePadToSVG([{ points: [[1e300, 0, 2]] }])).toThrow(RangeError);
  });

  test('serialization remains stable and leaves source ink unchanged', () => {
    const before = structuredClone(strokes);
    expect(signaturePadToSVG(strokes)).toBe(signaturePadToSVG(structuredClone(strokes)));
    expect(strokes).toEqual(before);
  });
});
