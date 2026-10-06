/** Regressions for visible Markdown text, bounded identities and admitted search passages. */
import { describe, expect, test } from 'bun:test';
import { compileDocsContent } from './compile';
import { parseDocsMarkdown } from './markdown';
import { docsFixture } from './test-fixture';

describe('documentation search projection', () => {
  test('inline formatting stays contiguous in headings and their canonical anchors', () => {
    const parsed = parseDocsMarkdown('# get**User**\n\n## auth**Role** and `key`\n\nLine one  \nline two.', 'example.md');
    expect(parsed.headings).toEqual([{ id: 'getuser', text: 'getUser', depth: 1 }, { id: 'authrole-and-key', text: 'authRole and key', depth: 2 }]);
    expect(parsed.text).toContain('Line one\nline two.');
  });

  test('table cells and nested blocks remain separate; displayed callout and code labels are searchable', () => {
    const parsed = parseDocsMarkdown('# Example\n\n| ten | ant |\n| --- | --- |\n| first | second |\n\n- First paragraph.\n\n  Nested paragraph.\n\n:::tip[Visible label]\nBody text.\n:::\n\n```ts filename="client.ts"\nconst value = 1;\n```', 'example.md');
    expect(parsed.text).not.toContain('tenant'); expect(parsed.text).toContain('ten ant');
    expect(parsed.text).toContain('First paragraph.\nNested paragraph.');
    expect(parsed.text).toContain('Visible label\nBody text.'); expect(parsed.text).toContain('client.ts\nconst value = 1;');
    expect(parseDocsMarkdown('> [!WARNING]\n> Be careful.', 'example.md').text).toContain('warning\nBe careful.');
  });

  test('all inferred heading text and anchor identities are bounded before publishing', async () => {
    const fixture = await docsFixture({ 'index.md': '# ' + 'x'.repeat(240_000) });
    try { await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toMatchObject({ code: 'DOCS_LIMIT_EXCEEDED' }); }
    finally { await fixture.close(); }
  });

  test('compiler builds deterministic frozen passages with nearest heading ancestry from public AST only', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home\n\n## Guardian\n\n### Membership\n\nAn explicitly granted builder can edit records.', 'private.md': '---\nvisibility: private\n---\n# PRIVATE_SENTINEL' });
    try {
      const first = await compileDocsContent({ contentDir: fixture.root }), second = await compileDocsContent({ contentDir: fixture.root });
      const page = first.pages.find(page => !page.generated)!;
      const passage = page.passages!.find(item => item.text.includes('explicitly granted'))!;
      expect(passage).toMatchObject({ headingId: 'membership', sectionPath: ['Home', 'Guardian', 'Membership'] });
      expect(page.body.children!.some(node => node.searchId === passage.id)).toBe(true);
      expect(new Set(page.passages!.map(item => item.id)).size).toBe(page.passages!.length);
      expect(Object.isFrozen(page.passages)).toBe(true); expect(Object.isFrozen(passage.sectionPath)).toBe(true);
      expect(first.hash).toBe(second.hash); expect(JSON.stringify(first)).not.toContain('PRIVATE_SENTINEL');
    } finally { await fixture.close(); }
  });

  test('escaped root HTML remains a literal searchable passage, not executable markup', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home\n\n<script>literal_sentinel</script>' });
    try {
      const page = (await compileDocsContent({ contentDir: fixture.root })).pages[0]!;
      const passage = page.passages!.find(item => item.text.includes('literal_sentinel'))!;
      expect(passage.text).toBe('<script>literal_sentinel</script>');
      expect(page.body.children!.find(node => node.type === 'text')!.searchId).toBe(passage.id);
    } finally { await fixture.close(); }
  });

  test('long whitespace inside a normal visible heading cannot escape ancestry label bounds', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home\n\n## One' + ' '.repeat(1_000) + 'two\n\nParagraph.' });
    try { const page = (await compileDocsContent({ contentDir: fixture.root })).pages[0]!; expect(page.passages!.at(-1)!.sectionPath).toEqual(['Home', 'One two']); }
    finally { await fixture.close(); }
  });

  test('visible fence labels and footnote anchors use the same bounded identity contract', () => {
    expect(() => parseDocsMarkdown('```ts filename="' + 'x'.repeat(257) + '"\nx\n```', 'example.md')).toThrow();
    expect(() => parseDocsMarkdown('[^' + 'x'.repeat(257) + ']: Note.', 'example.md')).toThrow();
  });
});
