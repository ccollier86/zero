/** Documentation-standard metadata remains safe data; it cannot override publication admission. */
import { describe, expect, test } from 'bun:test';
import { admitDocsFrontmatter } from './frontmatter';
import { compileDocsContent } from './compile';
import { docsFixture } from './test-fixture';

const standard = `---
id: zero.sample.integration
type: reference
audience: [developer, agent]
owner: sample
status: published
visibility: public
system: sample
feature: integration
maturity: supported
applies_to: ["2.5.0"]
modes: [single-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "0123456789012345678901234567890123456789"
  snapshot: clean
  date: "2026-10-06"
  evidence_level: package-qualified
related_packages:
  - package: "@zero/plugin-docs"
    version: "0.1.0"
    maturity: supported
---
# Public integration
`;

describe('documentation standards frontmatter', () => {
  test('all exact standard feature metadata keys are retained when deliberately published', () => {
    const admitted = admitDocsFrontmatter(standard, 'integration.md', 32768);
    expect(admitted.admitted).toBe(true);
    if (!admitted.admitted) throw new Error('Expected an admitted public standard page.');
    expect(admitted.metadata.extra.modes).toEqual(['single-simple', 'multi-advanced']);
    expect(admitted.metadata.extra.related_packages).toEqual([{ package: '@zero/plugin-docs', version: '0.1.0', maturity: 'supported' }]);
    expect(Object.isFrozen(admitted.metadata.extra.related_packages)).toBe(true);
  });
  test('the actual Guardian guide metadata can be deliberately published without rewriting standard fields', async () => {
    const original = await Bun.file(new URL('../../../../docs-next/backend/guardian/index.md', import.meta.url)).text();
    expect(admitDocsFrontmatter(original, 'guardian.md', 32768)).toEqual({ admitted: false });
    const publicSource = original.replace(/^status: draft$/mu, 'status: published').replace(/^visibility: internal$/mu, 'visibility: public');
    const admitted = admitDocsFrontmatter(publicSource, 'guardian.md', 32768);
    expect(admitted.admitted).toBe(true);
    if (!admitted.admitted) throw new Error('Expected deliberately public metadata.');
    expect(admitted.metadata.extra.modes).toEqual(['single-simple', 'single-advanced', 'multi-simple', 'multi-advanced']);
  });
  test('standard keys cannot admit internal, draft or working content into the public projection', async () => {
    const fixture = await docsFixture({ 'index.md': standard,
      'internal.md': standard.replace('visibility: public', 'visibility: internal').replace('Public integration', 'INTERNAL_SENTINEL'),
      'draft.md': standard.replace('status: published', 'status: draft').replace('Public integration', 'DRAFT_SENTINEL'),
      '_work/public.md': standard.replace('Public integration', 'WORKING_SENTINEL') });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root });
      expect(manifest.pages).toHaveLength(1); expect(JSON.stringify(manifest)).not.toContain('SENTINEL');
      expect(manifest.pages[0]!.metadata.modes).toEqual(['single-simple', 'multi-advanced']);
    } finally { await fixture.close(); }
  });
  test('the new standard keys retain generic value bounds while arbitrary unnamed metadata stays rejected', () => {
    for (const key of ['modes_extra', 'related_docs', 'runtimeProviders']) {
      expect(() => admitDocsFrontmatter(standard.replace('---\n#', `${key}: arbitrary\n---\n#`), 'example.md', 32768)).toThrow();
    }
    const entries = 'modes: [' + Array.from({ length: 257 }, () => 'single-simple').join(', ') + ']';
    let failure: unknown;
    try { admitDocsFrontmatter(standard.replace('modes: [single-simple, multi-advanced]', entries), 'example.md', 32768); }
    catch (cause) { failure = cause; }
    expect(failure).toMatchObject({ code: 'DOCS_LIMIT_EXCEEDED' });
  });
});
