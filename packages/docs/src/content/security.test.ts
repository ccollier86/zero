import { describe, expect, test } from 'bun:test';
import { symlink } from 'node:fs/promises';
import { compileDocsContent, DocsContentError } from './index';
import { docsFixture } from './test-fixture';

describe('documentation compiler security and diagnostics', () => {
  test('unsafe schemes, encoded traversal, missing pages, missing anchors and active assets fail admission', async () => {
    for (const [link, code] of [['[Bad](javascript:alert)', 'DOCS_LINK_INVALID'], ['[Bad](data:text/html,hello)', 'DOCS_LINK_INVALID'],
      ['[Bad](%2e%2e/outside.md)', 'DOCS_LINK_INVALID'], ['[Bad](absent.md)', 'DOCS_LINK_INVALID'],
      ['[Bad](#absent)', 'DOCS_LINK_INVALID'], ['![Bad](icon.svg)', 'DOCS_ASSET_INVALID']] as const) {
      const fixture = await docsFixture({ 'index.md': '# Home\n\n' + link, 'icon.svg': '<svg onload="alert(1)"></svg>' });
      try { await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toMatchObject({ code }); }
      finally { await fixture.close(); }
    }
  });

  test('external links are validated as data and never fetched while compiling', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home\n\n[External](https://example.invalid/docs) ![Remote](https://example.invalid/image.png)' });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root });
      expect(result.assets).toHaveLength(0); expect(JSON.stringify(result)).toContain('https://example.invalid/docs');
    } finally { await fixture.close(); }
  });

  test('symlink escape and directory cycles are rejected without exposing absolute source paths', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home' }), external = await docsFixture({ 'outside.md': '# OUTSIDE_SENTINEL' });
    try {
      await symlink(external.root + '/outside.md', fixture.root + '/escaped.md');
      let error: unknown; try { await compileDocsContent({ contentDir: fixture.root }); } catch (cause) { error = cause; }
      expect(error).toBeInstanceOf(DocsContentError); expect((error as DocsContentError).code).toBe('DOCS_SOURCE_INVALID');
      expect(JSON.stringify(error)).not.toContain(external.root); expect(JSON.stringify(error)).not.toContain('OUTSIDE_SENTINEL');
    } finally { await fixture.close(); await external.close(); }
    const cyclic = await docsFixture({ 'index.md': '# Home' });
    try { await symlink(cyclic.root, cyclic.root + '/cycle'); await expect(compileDocsContent({ contentDir: cyclic.root })).rejects.toMatchObject({ code: 'DOCS_SOURCE_INVALID' }); }
    finally { await cyclic.close(); }
  });

  test('route/ID/redirect collisions and invalid recognized metadata never silently choose a winner', async () => {
    for (const files of [
      { 'one.md': '---\nslug: same\n---\n# One', 'two.md': '---\nslug: same\n---\n# Two' },
      { 'one.md': '---\nid: same\n---\n# One', 'two.md': '---\nid: same\n---\n# Two' },
      { 'one.md': '---\nredirects: [two]\n---\n# One', 'two.md': '# Two' },
    ]) {
      const fixture = await docsFixture(files);
      try { await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toMatchObject({ code: 'DOCS_ROUTE_CONFLICT' }); }
      finally { await fixture.close(); }
    }
    for (const yaml of ['visibility: secretly-public', 'title: false', 'search: yes', 'navigation:\n  hidden: "false"', 'constructor: unsafe', 'extra: &loop [*loop]']) {
      const fixture = await docsFixture({ 'index.md': `---\n${yaml}\n---\n# Home` });
      try { await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toMatchObject({ code: 'DOCS_METADATA_INVALID' }); }
      finally { await fixture.close(); }
    }
  });

  test('budgets, unsupported directives and invalid source configuration produce actionable stable codes', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home\n\nLong content' });
    try {
      await expect(compileDocsContent({ contentDir: fixture.root, limits: { maxDocumentBytes: 8 } })).rejects.toMatchObject({ code: 'DOCS_LIMIT_EXCEEDED' });
      await expect(compileDocsContent({ contentDir: './relative' })).rejects.toMatchObject({ code: 'DOCS_CONFIG_INVALID' });
      await expect(compileDocsContent({ contentDir: fixture.root, exclusions: ['!restore.md'] })).rejects.toMatchObject({ code: 'DOCS_CONFIG_INVALID' });
      await Bun.write(fixture.root + '/index.md', '# Home\n\n:::execute\nrun me\n:::');
      await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toMatchObject({ code: 'DOCS_MARKDOWN_INVALID' });
    } finally { await fixture.close(); }
  });

  test('safe namespaced metadata is retained while compiler events contain only bounded counts', async () => {
    const fixture = await docsFixture({ 'index.md': '---\nx-editor:\n  enabled: true\n  hint: PRIVATE_METADATA_VALUE\n---\n# A private-looking title\n\nPrivate-looking content.' });
    const events: unknown[] = [];
    try {
      const result = await compileDocsContent({ contentDir: fixture.root, emit: event => { events.push(event); } });
      expect(result.pages[0]?.metadata['x-editor']).toEqual({ enabled: true, hint: 'PRIVATE_METADATA_VALUE' });
      expect(events).toEqual([{ code: 'DOCS_CONTENT_COMPILED', metadata: { pages: 1, assets: 0, diagnostics: 0 } }]);
      expect(JSON.stringify(events)).not.toContain('private'); expect(JSON.stringify(events)).not.toContain('PRIVATE');
      await expect(compileDocsContent({ contentDir: fixture.root + '/missing', emit: event => { events.push(event); } })).rejects.toMatchObject({ code: 'DOCS_CONFIG_INVALID' });
      expect(events.at(-1)).toEqual({ code: 'DOCS_CONTENT_FAILED', metadata: { pages: 0, assets: 0, diagnostics: 1 } });
    } finally { await fixture.close(); }
  });
});
