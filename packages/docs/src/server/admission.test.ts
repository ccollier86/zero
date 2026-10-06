import { describe, expect, test } from 'bun:test';
import { compileDocsContent } from '../content';
import { docsFixture } from '../content/test-fixture';
import { searchDocs } from './search';
import { resolveDocsOptions } from '../options';
import { docsAgentIndex } from './projections';

describe('documentation query and route admission', () => {
  test('large query results are capped and hidden navigation differs from omitted search and denied publication', async () => {
    const fixture = await docsFixture({ 'index.md': '# Start', ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`item-${index}.md`, `# Searchable ${index}\n\nNeedle content.`])),
      'hidden.md': '---\nnavigation:\n  hidden: true\n---\n# Hidden\n\nNeedle content.', 'omit.md': '---\nsearch: false\n---\n# Omit\n\nNeedle content.',
      'private.md': '---\nvisibility: private\n---\n# PRIVATE_SEARCH_SENTINEL\n\nNeedle content.' });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root });
      expect(searchDocs(manifest, 'Needle', 100)).toHaveLength(20); expect(searchDocs(manifest, 'Hidden')[0]?.route).toBe('/docs/hidden#hidden'); expect(searchDocs(manifest, 'Omit')).toEqual([]);
      expect(searchDocs(manifest, 'PRIVATE_SEARCH_SENTINEL')).toEqual([]); expect(docsAgentIndex(manifest, 'Reader')).not.toContain('PRIVATE_SEARCH_SENTINEL');
    } finally { await fixture.close(); }
  });

  test('encoded route punctuation and non-ASCII mounts are canonical, stable and linkable', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home\n\n[Exact](special.md)', 'special.md': '---\nslug: "value(1)*"\n---\n# Special' });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root, basePath: '/文档' });
      expect(manifest.basePath).toBe('/%E6%96%87%E6%A1%A3'); expect(manifest.pages.find(page => page.sourcePath === 'special.md')?.route).toBe('/%E6%96%87%E6%A1%A3/value%281%29%2A');
      expect(JSON.stringify(manifest.pages.find(page => page.sourcePath === 'index.md')?.body)).toContain('/%E6%96%87%E6%A1%A3/value%281%29%2A');
    } finally { await fixture.close(); }
  });

  test('factory option validation rejects mistaken patterns and limits synchronously', () => {
    for (const options of [{ include: '*.md' }, { include: ['!private.md'] }, { limits: { maxDocumnts: 10 } }, { limits: { maxDocuments: 0 } }, { basePath: 4 }]) {
      expect(() => resolveDocsOptions({ contentDir: './docs', ...options } as never)).toThrow();
    }
    expect(resolveDocsOptions({ contentDir: './docs', headerLinks: [{ label: 'Source', href: 'https://example.test/?tab=docs#readme' }] }).headerLinks[0]?.href).toBe('https://example.test/?tab=docs#readme');
  });

  test('authored pages and redirects cannot silently shadow reserved reader projections', async () => {
    for (const metadata of ['slug: llms.txt', 'slug: sitemap.xml', 'redirects: [llms.txt]']) {
      const fixture = await docsFixture({ 'index.md': `---\n${metadata}\n---\n# Home` });
      try { await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toMatchObject({ code: 'DOCS_ROUTE_CONFLICT' }); }
      finally { await fixture.close(); }
    }
  });
});
