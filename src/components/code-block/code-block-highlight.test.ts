/**
 * code-block-highlight.test.ts
 *
 * Guards CodeBlock highlight HTML normalization. These tests own output shape
 * only; visual rendering remains covered by browser-level checks.
 */

import { describe, expect, test } from 'bun:test';

import {
  buildFallbackCodeBlockHtml,
  highlightCodeBlockHtml,
  normalizeCodeBlockLineHtml,
} from './code-block-highlight';

describe('CodeBlock highlight output', () => {
  test('removes preserved newline text nodes between Shiki line spans', () => {
    const html = '<pre><code><span class="line">one</span>\n<span class="line">two</span></code></pre>';

    expect(normalizeCodeBlockLineHtml(html)).toBe(
      '<pre><code><span class="line">one</span><span class="line">two</span></code></pre>',
    );
  });

  test('fallback HTML renders adjacent line spans', () => {
    const html = buildFallbackCodeBlockHtml('one\ntwo');

    expect(html).toContain('<span class="line" data-line-number="1">one</span><span class="line" data-line-number="2">two</span>');
    expect(html).not.toContain('</span>\n<span class="line">');
  });

  test('Shiki output renders adjacent line spans', async () => {
    const html = await highlightCodeBlockHtml('const one = 1;\nconst two = 2;', 'ts');

    expect(html).toContain('class="line"');
    expect(html).not.toContain('</span>\n<span class="line">');
  });
});
