/** Local search correctness and passage targeting over compiled public content. */
import { describe, expect, test } from 'bun:test';
import { compileDocsContent } from '../content/compile';
import { docsFixture } from '../content/test-fixture';
import { searchDocs } from './search';

describe('documentation passage search', () => {
  test('Unicode lowercase expansion cannot shift original excerpts past the match', async () => {
    const fixture = await docsFixture({ 'index.md': '# Unicode\n\n' + 'İ'.repeat(100) + ' needle after' });
    try {
      const result = searchDocs(await compileDocsContent({ contentDir: fixture.root }), 'needle')[0]!;
      expect(result.excerpt).toContain('needle');
      expect(result.matches!.excerpt.map(range => result.excerpt.slice(range.start, range.end))).toContain('needle');
    } finally { await fixture.close(); }
  });

  test('body matches target their nearest section, retain ancestry and distinguish multiple useful section hits', async () => {
    const fixture = await docsFixture({ 'index.md': '# Guide\n\n## Setup\n\nUse a needle during setup.\n\n## Recovery\n\nAnother needle can restore recovery.\n\n## Cleanup\n\nThe needle is discarded here.\n\n## Extra\n\nA fourth needle.' });
    try {
      const result = searchDocs(await compileDocsContent({ contentDir: fixture.root }), 'needle');
      expect(result).toHaveLength(3); expect(new Set(result.map(item => item.route)).size).toBe(3);
      expect(result[0]).toMatchObject({ pageRoute: '/docs', path: '/docs' });
      expect(result.every(item => item.passageId?.startsWith('docs-p-') && item.route.includes('#') && item.sectionPath?.[0] === 'Guide')).toBe(true);
    } finally { await fixture.close(); }
  });

  test('description-only matches work and visible labels do not create concatenated cell matches', async () => {
    const fixture = await docsFixture({ 'index.md': '---\ndescription: Metadata needle description.\n---\n# Home\n\n| ten | ant |\n| --- | --- |\n| a | b |\n\n:::tip[Callouttitle]\nText.\n:::\n\n```ts filename="uniquefile.ts"\nconst x = 1;\n```' });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root });
      expect(searchDocs(manifest, 'needle')[0]!.excerpt).toContain('Metadata needle');
      expect(searchDocs(manifest, 'tenant')).toEqual([]); expect(searchDocs(manifest, 'Callouttitle')).toHaveLength(1);
      expect(searchDocs(manifest, 'uniquefile.ts')[0]!.passageId).toBeDefined();
    } finally { await fixture.close(); }
  });

  test('exact titles, whole words and prefixes rank ahead of arbitrary body substrings', async () => {
    const fixture = await docsFixture({ 'exact.md': '# token', 'prefix.md': '# Tokenizer', 'body.md': '# Reference\n\nUse token here.', 'substring.md': '# Other\n\nA subtokentext.' });
    try {
      const result = searchDocs(await compileDocsContent({ contentDir: fixture.root }), 'token');
      expect(result.map(item => item.pageRoute)).toEqual(['/docs/exact', '/docs/prefix', '/docs/body', '/docs/substring']);
    } finally { await fixture.close(); }
  });

  test('long terms spanning internal windows and terms distributed across blocks retain AND semantics', async () => {
    const term = 'x'.repeat(200), fixture = await docsFixture({ 'index.md': '# Guide\n\n' + '.'.repeat(1_900) + term + '\n\n## Other\n\nsecondkeyword' });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root });
      expect(searchDocs(manifest, term)[0]!.excerpt).toContain(term);
      expect(searchDocs(manifest, 'Guide secondkeyword')[0]!.route).toBe('/docs#other');
      expect(searchDocs(manifest, 'Guide missingkeyword')).toEqual([]);
      expect(searchDocs(manifest, term, 0)).toEqual([]); expect(searchDocs(manifest, term, -1)).toEqual([]);
      expect(searchDocs(manifest, term)[0]!.pageHash).toBe(manifest.pages[0]!.hash);
      expect(Object.isFrozen(searchDocs(manifest, term)[0]!.matches!.excerpt)).toBe(true);
    } finally { await fixture.close(); }
  });

  test('title-only matches do not flood results with unrelated descendant sections', async () => {
    const fixture = await docsFixture({ 'index.md': '# Guide\n\n## First\n\nUnrelated.\n\n## Second\n\nOther text.\n\n## Third\n\nDetails.' });
    try { expect(searchDocs(await compileDocsContent({ contentDir: fixture.root }), 'Guide')).toHaveLength(1); }
    finally { await fixture.close(); }
  });

  test('older admitted AST snapshots can derive passage context without compiler passage metadata', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home\n\n## Section\n\nFallback needle.' });
    try {
      const original = await compileDocsContent({ contentDir: fixture.root });
      const legacy = { ...original, pages: original.pages.map(page => ({ ...page, passages: undefined })) };
      expect(searchDocs(legacy, 'needle')[0]!.route).toBe('/docs#section');
      expect(searchDocs(legacy, 'needle')[0]!.passageId).toBeDefined();
    } finally { await fixture.close(); }
  });

  test('canonically equivalent long Unicode terms remain findable across internal window boundaries', async () => {
    const fixture = await docsFixture({ 'index.md': '# Unicode\n\n' + '.'.repeat(1_700) + 'e\u0301'.repeat(200) });
    try { expect(searchDocs(await compileDocsContent({ contentDir: fixture.root }), 'é'.repeat(200))).toHaveLength(1); }
    finally { await fixture.close(); }
  });
});
