/** Browser response admission tests; malicious values never become links or rendered match ranges. */
import { describe, expect, test } from 'bun:test';
import { readDocsSearchResults } from './read-docs-search-results';

const result = { route: '/docs/guide#setup', pageRoute: '/docs/guide', path: '/docs/guide', title: 'Guide',
  section: 'Setup', sectionPath: ['Guide', 'Setup'], excerpt: 'A needle here.', passageId: 'docs-p-4', pageHash: 'a'.repeat(64),
  matches: { title: [{ start: 0, end: 5 }], section: [{ start: 0, end: 5 }], excerpt: [{ start: 2, end: 8 }] } };
const read = (override: Record<string, unknown> = {}, base = '/docs') => readDocsSearchResults({ results: [{ ...result, ...override }] }, base);

describe('documentation search response admission', () => {
  test('canonical public route context, page hash, ancestry and original match ranges survive admission', () => {
    expect(read()[0]).toEqual(result);
    expect(readDocsSearchResults({ results: [{ ...result, route: '/manual/%E6%96%87#%E5%AD%97', pageRoute: '/manual/%E6%96%87', path: '/manual/%E6%96%87' }] }, '/manual')[0]!.path).toBe('/manual/%E6%96%87');
    expect(readDocsSearchResults({ results: [{ ...result, route: '/guide#setup', pageRoute: '/guide', path: '/guide' }] }, '/')[0]!.pageRoute).toBe('/guide');
  });
  test('legacy plain results derive page context and empty match arrays', () => {
    expect(readDocsSearchResults({ results: [{ route: '/docs/guide#setup', title: 'Guide', excerpt: 'Plain text.' }] }, '/docs')[0]).toEqual({
      route: '/docs/guide#setup', pageRoute: '/docs/guide', path: '/docs/guide', title: 'Guide', excerpt: 'Plain text.', matches: { title: [], section: [], excerpt: [] },
    });
  });
  test('malicious routes, queries, wrong mount and disagreeing page context fail closed', () => {
    for (const route of ['javascript:alert(1)', 'https://outside.test/docs', '//outside.test/docs', '/private/guide', '/documentation/guide', '/docs/guide?token=private', '/docs/a\\b', '/docs/guide\u0000']) {
      expect(() => read({ route }), route).toThrow('Invalid documentation search response.');
    }
    for (const override of [{ pageRoute: '/docs/other' }, { pageRoute: '/docs/guide#setup' }, { path: '/docs/other' }, { path: '/private/guide' }]) expect(() => read(override)).toThrow();
    for (const route of ['/docs/guide#' + 'x'.repeat(257), '/docs/guide#%ZZ']) expect(() => read({ route })).toThrow();
  });
  test('dot-segment aliases are not canonical manifest links even when URL normalization stays in the mount', () => {
    for (const route of ['/docs/a/../guide#setup', '/docs/a/%2e%2e/guide#setup', '/docs/./guide#setup']) {
      expect(() => read({ route }), route).toThrow();
    }
  });
  test('valid bounded public paths plus non-ASCII heading fragments retain their full encoded target', () => {
    const pageRoute = '/docs/' + encodeURIComponent('界'.repeat(440)), route = pageRoute + '#' + encodeURIComponent('章'.repeat(256));
    expect(pageRoute.length).toBeLessThanOrEqual(4096);
    expect(read({ route, pageRoute, path: pageRoute })[0]!.route).toBe(route);
  });
  test('result, text, ancestry, identity and duplicate budgets cannot be exceeded', () => {
    for (const value of [null, [], { results: null }, { results: {} }, { results: Array.from({ length: 21 }, () => result) }]) expect(() => readDocsSearchResults(value, '/docs')).toThrow();
    for (const override of [{ title: 'x'.repeat(257) }, { section: 'x'.repeat(257) }, { excerpt: 'x'.repeat(241) },
      { pageHash: 'x'.repeat(129) }, { passageId: 'not-a-passage' }, { passageId: 'x'.repeat(65) },
      { sectionPath: Array.from({ length: 7 }, () => 'Section') }, { sectionPath: ['x'.repeat(257)] }, { sectionPath: [1] }]) expect(() => read(override)).toThrow();
    expect(() => readDocsSearchResults({ results: [result, result] }, '/docs')).toThrow();
    expect(readDocsSearchResults({ results: [result, { ...result, passageId: 'docs-p-5' }] }, '/docs')).toHaveLength(2);
    expect(readDocsSearchResults({ results: Array.from({ length: 20 }, (_, index) => ({ ...result, passageId: `docs-p-${index}` })) }, '/docs')).toHaveLength(20);
  });
  test('negative, overlapping, unordered, excessive and out-of-bounds ranges are rejected', () => {
    for (const ranges of [[{ start: -1, end: 1 }], [{ start: 1, end: 1 }], [{ start: 0, end: 20 }], [{ start: 0.5, end: 1 }],
      [{ start: 0, end: 4 }, { start: 2, end: 5 }], [{ start: 2, end: 3 }, { start: 0, end: 1 }],
      Array.from({ length: 17 }, () => ({ start: 0, end: 1 })), [null]]) expect(() => read({ matches: { title: ranges } })).toThrow();
    expect(() => read({ section: undefined, matches: { section: [{ start: 0, end: 1 }] } })).toThrow();
  });
  test('astral and decomposed original Unicode ranges remain intact, never splitting surrogate pairs', () => {
    expect(read({ title: 'A😃B', matches: { title: [{ start: 1, end: 3 }] } })[0]!.matches!.title).toEqual([{ start: 1, end: 3 }]);
    for (const range of [{ start: 2, end: 3 }, { start: 1, end: 2 }]) expect(() => read({ title: 'A😃B', matches: { title: [range] } })).toThrow();
    expect(read({ title: 'cafe\u0301', matches: { title: [{ start: 0, end: 5 }] } })[0]!.title).toBe('cafe\u0301');
  });
});
