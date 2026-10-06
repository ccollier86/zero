import { describe, expect, test } from 'bun:test';
import { compileDocsContent } from './index';
import { docsFixture } from './test-fixture';
import { parseDocsMarkdown } from './markdown';
import type { DocsNode } from './types';

const flatten = (node: DocsNode): DocsNode[] => [node, ...(node.children ?? []).flatMap(flatten)];
describe('canonical published Markdown', () => {
  test('copy/download links and images use admitted runtime URLs rather than unavailable source paths', async () => {
    const fixture = await docsFixture({ 'index.md': '---\ntitle: Home\n---\n# Home\n\n[Guide](guides/start.md?mode=full#details) ![Diagram](images/example.png)\n', 'guides/start.md': '# Start\n\n## Details', 'images/example.png': new Uint8Array([137, 80, 78, 71]) });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root }), markdown = manifest.pages.find(page => page.sourcePath === 'index.md')!.markdown;
      expect(markdown).toContain('/docs/guides/start?mode=full#details'); expect(markdown).toContain(manifest.assets[0]!.route);
      expect(markdown).not.toContain('guides/start.md'); expect(markdown).not.toContain('![Diagram](images/example.png)'); expect(markdown).not.toContain('title: Home');
    } finally { await fixture.close(); }
  });

  test('safe HTML text, raw code/fence metadata, callouts, GFM and footnotes survive semantic roundtrip', async () => {
    const code = 'const value = "<script>not executable</script>";\n// ``` inner fence';
    const fixture = await docsFixture({ 'index.md': '# Example\n\n<script>alert("literal")</script>\n\n````ts filename="client.ts" {1} showLineNumbers\n' + code + '\n````\n\n:::tip[Helpful]\nUse **carefully**.\n:::\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n- [x] Complete\n\n~~Old~~ with note.[^one]\n\n[^one]: Note text.' });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root }), markdown = manifest.pages.find(page => !page.generated)!.markdown;
      expect(markdown).not.toContain('\n<script>alert'); expect(markdown).toContain('filename="client.ts" {1} showLineNumbers');
      const nodes = flatten(parseDocsMarkdown(markdown, 'published.md').body);
      expect(nodes.find(node => node.type === 'code')?.value).toBe(code); expect(nodes.some(node => node.type === 'text' && node.value === '<script>alert("literal")</script>')).toBe(true);
      expect(nodes.find(node => node.type === 'callout')).toMatchObject({ tone: 'tip', title: 'Helpful' });
      expect(nodes.some(node => node.type === 'table')).toBe(true); expect(nodes.some(node => node.type === 'listItem' && node.checked)).toBe(true); expect(nodes.some(node => node.type === 'delete')).toBe(true);
      expect(nodes.some(node => node.type === 'footnoteReference' && node.identifier === 'one')).toBe(true);
    } finally { await fixture.close(); }
  });
});
