/** Pure SSR previews share SVG ink admission and never render arbitrary imported documents. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignaturePadPreview } from './signature-pad-overlays';

test('preview omits both absent and point-free ink', () => {
  expect(renderToStaticMarkup(<SignaturePadPreview strokes={[]} />)).toBe('');
  expect(renderToStaticMarkup(<SignaturePadPreview strokes={[{ points: [] }]} />)).toBe('');
});

test('preview derives a labeled SVG path from validated strokes', () => {
  const html = renderToStaticMarkup(<SignaturePadPreview strokes={[{ points: [[10, 20, 2]] }]} color="#102030" />);
  expect(html).toContain('role="img"');
  expect(html).toContain('aria-label="Signature"');
  expect(html).toContain('fill="#102030"');
  expect(html).toContain('<path');
});

test('preview rejects unsafe paint references before rendering', () => {
  expect(() => renderToStaticMarkup(<SignaturePadPreview strokes={[{ points: [[10, 20, 2]] }]} color="url(https://example.test/paint)" />)).toThrow();
});
