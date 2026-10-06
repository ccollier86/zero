import { describe, expect, test } from 'bun:test';
import { docs } from '../index';
import { applyDocsAppDefaults, resolveDocsOptions } from '../options';
import { docsRuntimeFixture } from './test-fixture';
import { prepareDocsBuild, compileDocsSnapshot } from './build';
import { OBS_CODES } from '@zero/framework/server';

describe('declared docs content build', () => {
  test('one required declaration prepares safe public UI contributions and only admitted PRIVATE attachment copies', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Public\n\n[Attachment](public.pdf)\n\n```ts filename="client.ts" {1}\nconst safe = "<script>not executable</script>";\n```\n\n```unknown-xyz\nReadable fallback\n```',
      'private.md': '---\nvisibility: private\n---\n# DO_NOT_PACKAGE', 'public.pdf': '%PDF-1.7\nADMITTED', 'unused.pdf': '%PDF-1.7\nUNREFERENCED' });
    try {
      const plugin = docs({ contentDir: './documentation', watch: false }); expect(plugin.kind).toBe('plugin'); expect(plugin.build?.required).toBe(true);
      const result = await prepareDocsBuild(fixture.build, fixture.options);
      expect(result.browserEntries).toHaveLength(1); expect(result.styles).toHaveLength(1); expect(result.styleSources).toHaveLength(1); expect(result.assets).toBeUndefined(); expect(result.privateAssets).toHaveLength(1);
      expect(result.privateAssets?.[0]?.path).toStartWith(fixture.build.generatedDir); expect(await Bun.file(result.privateAssets![0]!.path).text()).toContain('ADMITTED');
      const serialized = JSON.stringify(result.data); expect(serialized).not.toContain(fixture.root); expect(serialized).not.toContain('DO_NOT_PACKAGE'); expect(serialized).not.toContain('UNREFERENCED');
      const data = result.data as unknown as { highlights: Record<string, readonly { html: string; key: string }[]> };
      expect(data.highlights['/docs']![0]!.html).toContain('zero:docs:code:1-l1'); expect(data.highlights['/docs']![1]!.html).toContain('Readable fallback'); expect(data.highlights['/docs']![1]!.html).toContain('zero-code-block-fallback');
    } finally { await fixture.close(); }
  });

  test('options are progressive, immutable, source-root explicit and fail clearly on unsupported modes or unsafe URLs', () => {
    const options = resolveDocsOptions({ contentDir: './docs', title: 'Reader', breadcrumbs: true, include: ['**/*.md'] });
    expect(options.basePath).toBe('/docs'); expect(options.search).toBe(true); expect(options.breadcrumbs).toBe(true); expect(Object.isFrozen(options.include)).toBe(true);
    expect(docs({ contentDir: './docs' }).build?.identity).toBe(docs({ contentDir: './docs' }).build?.identity);
    expect(docs({ contentDir: './docs', basePath: '/manual' }).build?.identity).not.toBe(docs({ contentDir: './docs' }).build?.identity);
    expect(applyDocsAppDefaults(options, { name: 'App', publicUrl: 'https://app.example.test' }, true).title).toBe('Reader');
    expect(applyDocsAppDefaults(options, { name: 'App', publicUrl: 'https://app.example.test' }, false)).toMatchObject({ title: 'App Documentation', siteUrl: 'https://app.example.test' });
    for (const input of [{ contentDir: '' }, { contentDir: './docs', siteUrl: 'javascript:alert(1)' }, { contentDir: './docs', editUrl: 'https://user:secret@example.test' },
      { contentDir: './docs', headerLinks: [{ label: 'Bad', href: '//example.test' }] }, { contentDir: './docs', search: 'yes' }, { contentDir: './docs', access: 'private' }]) {
      expect(() => resolveDocsOptions(input as never)).toThrow();
    }
  });

  test('a root docs reader rejects authored platform route ownership without hiding system APIs', async () => {
    for (const source of ['---\nslug: api/custom\n---\n# Wrong ownership', '---\nredirects: [auth/custom]\n---\n# Wrong redirect']) {
      const fixture = await docsRuntimeFixture({ 'index.md': source });
      try { const options = resolveDocsOptions({ contentDir: './documentation', basePath: '/' }); await expect(prepareDocsBuild(fixture.build, options)).rejects.toMatchObject({ code: 'DOCS_ROUTE_CONFLICT' }); }
      finally { await fixture.close(); }
    }
  });

  test('publication changes after parse but before asset/highlight preparation cannot be committed', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Home', 'guide.md': '# Initially public\n\n```ts\nconst safe = true;\n```' }); let changed = false;
    try {
      await expect(compileDocsSnapshot(fixture.root, fixture.options, 'production', (code, event) => {
        if (!changed && code === OBS_CODES.DOCS_CONTENT_COMPILED) {
          changed = true;
          const write = Bun.spawnSync({ cmd: ['bun', '-e', 'await Bun.write(process.argv[1], "---\\nvisibility: private\\n---\\n# NOW_PRIVATE")', fixture.root + '/documentation/guide.md'], stdout: 'ignore', stderr: 'pipe' });
          expect(write.exitCode).toBe(0);
        }
        return fixture.build.emitCode(code, event);
      })).rejects.toMatchObject({ code: 'DOCS_SOURCE_INVALID' });
      expect(changed).toBe(true); expect(JSON.stringify(fixture.events)).not.toContain('NOW_PRIVATE');
    } finally { await fixture.close(); }
  });
});
