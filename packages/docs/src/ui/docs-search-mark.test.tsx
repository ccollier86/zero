/** Result highlights preserve original Unicode and escape authored text through React. */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocsSearchMark } from './docs-search-mark';
import { docsMatchRanges, docsSearchTerms } from '../search/text';

const render = (text: string, query: string) => renderToStaticMarkup(createElement(DocsSearchMark, { text, ranges: docsMatchRanges(text, docsSearchTerms(query)) }));
describe('safe documentation result highlights', () => {
  test('ranges select original lowercase-expansion, decomposed and astral text, not normalized replacements', () => {
    expect(render('İstanbul cafe\u0301 😃', 'İSTANBUL café 😃')).toBe('<mark>İstanbul</mark> <mark>cafe\u0301</mark> <mark>😃</mark>');
  });
  test('HTML-looking matches render as escaped text without executable markup', () => {
    const html = render('Before <script>alert("x")</script> after', '<script>');
    expect(html).toContain('<mark>&lt;script&gt;</mark>'); expect(html).not.toContain('<script>');
    expect(html).toContain('alert(&quot;x&quot;)&lt;/script&gt;');
    expect(render('<img src=x onerror=attack()>', 'absent')).toBe('&lt;img src=x onerror=attack()&gt;');
  });
  test('disjoint and overlapping query terms preserve every unmarked character exactly once', () => {
    expect(render('prefix needle middle suffix', 'needle suffix')).toBe('prefix <mark>needle</mark> middle <mark>suffix</mark>');
    expect(render('needle', 'need needle')).toBe('<mark>needle</mark>');
    expect(render('ordinary text', '')).toBe('ordinary text');
  });
});
