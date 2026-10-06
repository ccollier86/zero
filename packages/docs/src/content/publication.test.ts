import { describe, expect, test } from 'bun:test';
import { symlink } from 'node:fs/promises';
import { compileDocsContent, DocsContentError } from './index';
import { docsFixture } from './test-fixture';

describe('documentation publication admission', () => {
  test('verified public documents are supported without admitting verified internal or draft content', async () => {
    const fixture = await docsFixture({ 'index.md': '---\nstatus: verified\n---\n# Verified public', 'internal.md': '---\nstatus: verified\nvisibility: internal\n---\n# INTERNAL_VERIFIED_SENTINEL', 'draft.md': '---\nstatus: verified\ndraft: true\n---\n# DRAFT_VERIFIED_SENTINEL' });
    try { const manifest = await compileDocsContent({ contentDir: fixture.root }); expect(manifest.pages[0]?.title).toBe('Verified public'); expect(JSON.stringify(manifest)).not.toContain('VERIFIED_SENTINEL'); }
    finally { await fixture.close(); }
  });
  test('private/internal/draft/in-review/dot/working/build content is absent from every serializable projection', async () => {
    const fixture = await docsFixture({ 'index.md': '# Public', '_work/secret.md': '# WORK_SENTINEL', '.secret.md': '# DOT_SENTINEL',
      'node_modules/readme.md': '# DEPENDENCY_SENTINEL', 'build/readme.md': '# BUILD_SENTINEL',
      'private.md': '---\nvisibility: private\n---\n# PRIVATE_SENTINEL', 'internal.md': '---\nvisibility: internal\n---\n# INTERNAL_SENTINEL',
      'draft.md': '---\ndraft: true\n---\n# DRAFT_SENTINEL', 'review.md': '---\nstatus: in-review\n---\n# REVIEW_SENTINEL',
      'protected.md': '---\naccess: protected\n---\n# PROTECTED_SENTINEL' });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root });
      expect(result.pages).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('SENTINEL');
      expect(JSON.stringify(result)).not.toContain('private.md'); expect(JSON.stringify(result)).not.toContain('_work');
    } finally { await fixture.close(); }
  });

  test('navigation hiding and search omission are separate from publication exclusion', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home', 'hidden.md': '---\nnavigation:\n  hidden: true\n---\n# Hidden',
      'unsearchable.md': '---\nsearch: false\n---\n# No search', 'secret.md': '---\nvisibility: private\n---\n# Not public' });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root });
      expect(result.pages.find(page => page.sourcePath === 'hidden.md')?.searchable).toBe(true);
      expect(result.pages.find(page => page.sourcePath === 'unsearchable.md')?.searchable).toBe(false);
      expect(result.navigation.map(entry => entry.route)).not.toContain('/docs/hidden');
      expect(result.navigation.map(entry => entry.route)).toContain('/docs/unsearchable');
      expect(result.pages.some(page => page.sourcePath === 'secret.md')).toBe(false);
    } finally { await fixture.close(); }
  });

  test('Git ignore comments, CRLF, escaping, recursive patterns and ordered negation match expected paths', async () => {
    const fixture = await docsFixture({ '.docsignore': '# Comment\r\n**/*.draft.md\r\nkeep.md\r\n!keep.md\r\n\\#literal.md\r\n',
      'index.md': '# Home', 'keep.md': '# Kept', '#literal.md': '# ESCAPED_SENTINEL', 'nested/file.draft.md': '# DRAFT_SENTINEL', 'nested/normal.md': '# Normal' });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root });
      expect(result.pages.some(page => page.sourcePath === 'keep.md')).toBe(true);
      expect(result.pages.some(page => page.sourcePath === 'nested/normal.md')).toBe(true);
      expect(JSON.stringify(result)).not.toContain('SENTINEL'); expect(JSON.stringify(result)).not.toContain('.docsignore');
    } finally { await fixture.close(); }
  });

  test('an excluded parent cannot be rescued by a file negation, and config denies cannot be undone', async () => {
    const fixture = await docsFixture({ '.docsignore': '/private/\n!private/open.md\nblocked.md\n!blocked.md\n', 'index.md': '# Home',
      'private/open.md': '# PARENT_SENTINEL', 'blocked.md': '# CONFIG_SENTINEL' });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root, exclusions: ['blocked.md'] });
      expect(JSON.stringify(result)).not.toContain('SENTINEL'); expect(result.pages).toHaveLength(1);
    } finally { await fixture.close(); }
  });

  test('positive allowlists govern documents and assets without granting internal classification', async () => {
    const fixture = await docsFixture({ 'public/start.md': '# Start\n\n![Image](../images/icon.png)', 'private.md': '# OMITTED_SENTINEL',
      'public/internal.md': '---\nvisibility: internal\n---\n# CLASSIFICATION_SENTINEL', 'images/icon.png': new Uint8Array([137, 80, 78, 71]) });
    try {
      const result = await compileDocsContent({ contentDir: fixture.root, include: ['public/*.md', 'images/*.png'] });
      expect(result.assets).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('SENTINEL');
      await expect(compileDocsContent({ contentDir: fixture.root, include: ['public/*.md'] })).rejects.toMatchObject({ code: 'DOCS_LINK_INVALID' });
    } finally { await fixture.close(); }
  });

  test('ignore is applied before malformed YAML or unsupported Markdown extensions are parsed', async () => {
    const fixture = await docsFixture({ '.docsignore': 'ignored.md\n', 'index.md': '# Home', 'ignored.md': '---\nunclosed: [\n---\n:::execute\n<script>bad</script>\n:::' });
    try { expect((await compileDocsContent({ contentDir: fixture.root })).pages).toHaveLength(1); }
    finally { await fixture.close(); }
  });

  test('ignore input changes replace the complete snapshot and affect deterministic build identity', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home', 'extra.md': '# Extra' });
    try {
      const before = await compileDocsContent({ contentDir: fixture.root });
      await Bun.write(fixture.root + '/.docsignore', 'extra.md\n');
      const after = await compileDocsContent({ contentDir: fixture.root });
      expect(after.hash).not.toBe(before.hash); expect(after.pages.some(page => page.sourcePath === 'extra.md')).toBe(false);
      expect(JSON.stringify(after.navigation)).not.toContain('Extra'); expect(JSON.stringify(after)).not.toContain('extra.md');
    } finally { await fixture.close(); }
  });

  test('missing/unreadable selected ignore files fail closed while a missing optional default is normal', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home' });
    try {
      expect((await compileDocsContent({ contentDir: fixture.root })).pages).toHaveLength(1);
      await expect(compileDocsContent({ contentDir: fixture.root, ignoreFile: 'missing.ignore' })).rejects.toMatchObject({ code: 'DOCS_IGNORE_INVALID' });
      await Bun.write(fixture.root + '/.docsignore', new Uint8Array([255, 255]));
      await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toBeInstanceOf(DocsContentError);
      expect((await compileDocsContent({ contentDir: fixture.root, ignoreFile: false })).pages).toHaveLength(1);
    } finally { await fixture.close(); }
  });

  test('symlink aliases cannot bypass canonical-target ignores or working-directory exclusions', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home', '_work/private.md': '# ALIAS_SENTINEL', 'blocked.md': '# BLOCKED_SENTINEL', '.docsignore': 'blocked.md\n' });
    try {
      await symlink(fixture.root + '/_work/private.md', fixture.root + '/alias.md');
      await symlink(fixture.root + '/blocked.md', fixture.root + '/other.md');
      const result = await compileDocsContent({ contentDir: fixture.root });
      expect(result.pages).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('SENTINEL');
    } finally { await fixture.close(); }
  });
});
