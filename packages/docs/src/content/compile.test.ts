import { describe, expect, test } from 'bun:test';
import type { DocsNode } from './types';
import { compileDocsContent, DocsContentError, readDocsAsset } from './index';
import { docsFixture } from './test-fixture';

function flatten(node: DocsNode): DocsNode[] { return [node, ...(node.children ?? []).flatMap(flatten)]; }
describe('public documentation compilation', () => {
  test('ordinary folded YAML descriptions retain readable text without treating trailing scalar newlines as unsafe', async () => {
    const fixture = await docsFixture({ 'index.md': '---\ndescription: >\n  A readable description\n  over two source lines.\n---\n# Home' });
    try { expect((await compileDocsContent({ contentDir: fixture.root })).pages[0]?.description).toBe('A readable description over two source lines.'); }
    finally { await fixture.close(); }
  });
  test('ordinary Markdown infers titles and creates deterministic folder navigation and generated landings', async () => {
    const fixture = await docsFixture({ 'guides/step-10.md': '# Tenth step\n\nRead this.', 'guides/step-2.md': 'Plain paragraph.' });
    try {
      const first = await compileDocsContent({ contentDir: fixture.root }), second = await compileDocsContent({ contentDir: fixture.root });
      expect(first.hash).toBe(second.hash); expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.pages.map(page => page.route)).toEqual(['/docs', '/docs/guides', '/docs/guides/step-2', '/docs/guides/step-10']);
      expect(first.pages.find(page => page.route.endsWith('step-2'))?.title).toBe('Step 2');
      expect(first.pages.find(page => page.route.endsWith('step-10'))?.title).toBe('Tenth step');
      expect(first.navigation[1]?.children?.map(entry => entry.route)).toEqual(['/docs/guides/step-2', '/docs/guides/step-10']);
      expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.pages[0]?.body.children)).toBe(true);
      expect(JSON.stringify(first)).not.toContain(fixture.root);
    } finally { await fixture.close(); }
  });

  test('index owns landing, README is an ordinary page when both exist, and frontmatter wins over H1', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home', 'README.md': '# Read me', 'api/index.md': '---\ntitle: API reference\nnavigation:\n  order: 2\n---\n# Lower precedence', 'api/item.md': '# Item' });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root, basePath: '/manual' });
      expect(result.pages.find(page => page.sourcePath === 'README.md')?.route).toBe('/manual/readme');
      expect(result.pages.find(page => page.sourcePath === 'api/index.md')?.route).toBe('/manual/api');
      expect(result.pages.find(page => page.route === '/manual/api')?.title).toBe('API reference');
      expect(result.pages.filter(page => page.route === '/manual/api')).toHaveLength(1);
    } finally { await fixture.close(); }
  });

  test('GFM, footnotes, callouts, escaped HTML and code metadata share one safe AST and exact heading IDs', async () => {
    const fixture = await docsFixture({ 'index.md': '# Hello\n\n## Repeat\n\n## Repeat\n\n## 你好\n\n:::note[Helpful]\nRead **carefully**.\n:::\n\n> [!WARNING]\n> Be careful.\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n- [x] Done\n- [ ] Next\n\n~~Old~~ text with a footnote.[^one]\n\n[^one]: Extra detail.\n\n```ts filename="client.ts" showLineNumbers {1-100000}\nconst value = 1;\n```\n\n<script>alert("not executable")</script>\n' });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root });
      const page = result.pages.find(page => !page.generated)!, nodes = flatten(page.body);
      expect(page.headings.map(heading => heading.id)).toEqual(['hello', 'repeat', 'repeat-1', '你好']);
      expect(page.titleHeadingId).toBe('hello'); expect(nodes.filter(node => node.type === 'callout').map(node => node.tone)).toEqual(['note', 'warning']);
      expect(nodes.find(node => node.type === 'callout')?.title).toBe('Helpful');
      expect(nodes.some(node => node.type === 'table')).toBe(true); expect(nodes.some(node => node.type === 'delete')).toBe(true);
      expect(nodes.some(node => node.type === 'listItem' && node.checked === true)).toBe(true);
      expect(nodes.some(node => node.type === 'footnoteReference' && node.id === 'fn-one')).toBe(true);
      expect(nodes.find(node => node.type === 'code')?.code).toMatchObject({ title: 'client.ts', language: 'ts', lineNumbers: true, highlightLines: [1] });
      expect(nodes.some(node => node.type === 'text' && node.value?.startsWith('<script>'))).toBe(true);
      expect(nodes.every(node => !('attributes' in node) && !('data' in node))).toBe(true);
    } finally { await fixture.close(); }
  });

  test('relative source, folder, canonical route and heading references preserve query/fragment on admitted targets', async () => {
    const fixture = await docsFixture({ 'README.md': '# Home\n\n[Guide](guides/start.md?mode=full#你好) [Folder](guides/) [Route](/docs/guides/start#你好)', 'guides/start.md': '# Start\n\n## 你好\n' });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root });
      const links = flatten(result.pages.find(page => page.sourcePath === 'README.md')!.body).filter(node => node.type === 'link');
      expect(links.map(node => node.url)).toEqual(['/docs/guides/start?mode=full#你好', '/docs/guides', '/docs/guides/start#你好']);
    } finally { await fixture.close(); }
  });

  test('only referenced passive assets are admitted, packaged reads verify their digest, and asset links use manifest routes', async () => {
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const fixture = await docsFixture({ 'index.md': '# Home\n\n![Diagram](images/diagram.png)\n\n[Download](report.pdf)', 'images/diagram.png': image, 'report.pdf': '%PDF-1.7\nfixture', 'unused.png': image });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root });
      expect(result.assets.map(asset => asset.sourcePath)).toEqual(['images/diagram.png', 'report.pdf']);
      expect(result.assets.every(asset => asset.route.startsWith('/docs/_assets/'))).toBe(true);
      expect(result.pages.find(page => !page.generated)?.assets).toHaveLength(2);
      expect(await readDocsAsset(fixture.root, result.assets[0]!)).toEqual(image);
      await Bun.write(fixture.root + '/images/diagram.png', 'changed');
      await expect(readDocsAsset(fixture.root, result.assets[0]!)).rejects.toBeInstanceOf(DocsContentError);
    } finally { await fixture.close(); }
  });

  test('empty development collections get guidance, production emptiness needs deliberate admission', async () => {
    const fixture = await docsFixture({});
    try {
      const dev = await compileDocsContent({ contentDir: fixture.root, mode: 'development' });
      expect(dev.pages[0]?.generated).toBe(true); expect(dev.pages[0]?.text).toContain('Add a Markdown document');
      await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toMatchObject({ code: 'DOCS_COLLECTION_EMPTY' });
      expect((await compileDocsContent({ contentDir: fixture.root, allowEmpty: true })).pages).toHaveLength(1);
    } finally { await fixture.close(); }
  });
});
