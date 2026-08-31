/** Verifies full-document preservation and fragment wrapping for PDF input. */

import { describe, expect, test } from 'bun:test';

import { composePdfDocument } from './pdf-document';
import { PdfError } from './pdf-error';

describe('composePdfDocument', () => {
  test('wraps fragments with metadata, base URL, and supplemental CSS', () => {
    const result = composePdfDocument({
      html: '<main>Consent</main>',
      css: '@media print { main { break-after: page; } }',
      baseUrl: 'https://assets.example.com/forms/',
      document: { title: 'Patient Consent', lang: 'en-US' },
    });

    expect(result.html).toContain('<!doctype html>');
    expect(result.html).toContain('<html lang="en-US">');
    expect(result.html).toContain('<base href="https://assets.example.com/forms/">');
    expect(result.html).toContain('<title>Patient Consent</title>');
    expect(result.html).toContain('@media print');
  });

  test('preserves full documents and does not duplicate an existing title', () => {
    const result = composePdfDocument({
      html: '<!doctype html><html><head><title>Existing</title></head><body>Body</body></html>',
      css: 'body { color: black; }',
      document: { title: 'Replacement', lang: 'en' },
    });

    expect(result.html.match(/<title>/g)?.length).toBe(1);
    expect(result.html).toContain('<html lang="en">');
    expect(result.html).toContain('data-zero-pdf');
  });

  test('inserts a head after a standalone doctype instead of before it', () => {
    const result = composePdfDocument({
      html: '<!doctype html><body>Body</body>',
      css: 'body { color: black; }',
    });

    expect(result.html.startsWith('<!doctype html>\n<head>')).toBe(true);
    expect(result.html.indexOf('</head>')).toBeLessThan(result.html.indexOf('<body>'));
  });

  test('rejects non-http base URLs and closing style injection', () => {
    expect(() => composePdfDocument({ html: 'ok', baseUrl: 'file:///etc/' })).toThrow(PdfError);
    expect(() => composePdfDocument({ html: 'ok', css: '</style><script>bad()</script>' })).toThrow(PdfError);
    expect(() => composePdfDocument({ html: 'ok', css: '</style/><script>bad()</script>' })).toThrow(PdfError);
  });
});
