import { expect, test } from 'bun:test';
import { symlink, unlink } from 'node:fs/promises';
import { docsFixture } from './test-fixture';
import { compileDocsContent, readDocsAsset } from './index';

test('passive extension aliases never expose classified Markdown or active-file bytes', async () => {
  for (const [target, content] of [['private.md', '---\nvisibility: private\n---\n# PRIVATE_ALIAS_SENTINEL'], ['icon.svg', '<svg onload="alert(1)"></svg>'], ['page.html', '<script>PRIVATE_ALIAS_SENTINEL</script>']] as const) {
    const fixture = await docsFixture({ 'index.md': '# Public\n\n[Alias](leaked.txt)', [target]: content });
    try { await symlink(fixture.root + '/' + target, fixture.root + '/leaked.txt'); await expect(compileDocsContent({ contentDir: fixture.root })).rejects.toMatchObject({ code: 'DOCS_ASSET_INVALID' }); }
    finally { await fixture.close(); }
  }
});

test('previously admitted attachment aliases cannot be rebound to private Markdown before copy or dev readmission', async () => {
  const fixture = await docsFixture({ 'index.md': '# Public\n\n[Alias](attachment.txt)', 'public.txt': 'Public bytes', 'private.md': '---\nvisibility: private\n---\n# PRIVATE_ALIAS_SENTINEL' });
  try {
    await symlink(fixture.root + '/public.txt', fixture.root + '/attachment.txt'); const manifest = await compileDocsContent({ contentDir: fixture.root });
    expect(new TextDecoder().decode(await readDocsAsset(fixture.root, manifest.assets[0]!))).toBe('Public bytes');
    await unlink(fixture.root + '/attachment.txt'); await symlink(fixture.root + '/private.md', fixture.root + '/attachment.txt');
    await expect(readDocsAsset(fixture.root, manifest.assets[0]!)).rejects.toMatchObject({ code: 'DOCS_ASSET_INVALID' });
    await expect(compileDocsContent({ contentDir: fixture.root, mode: 'development' })).rejects.toMatchObject({ code: 'DOCS_ASSET_INVALID' });
  } finally { await fixture.close(); }
});
