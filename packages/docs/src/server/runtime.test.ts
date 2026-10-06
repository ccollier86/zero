import { describe, expect, test } from 'bun:test';
import { rename } from 'node:fs/promises';
import { createDocsSnapshotRuntime } from './watch';
import { createDocsRequestHandler } from './handler';
import { setupDocs } from './setup';
import { readDocsCompiledSnapshot, admitDocsBuildData } from './artifact';
import { searchDocs } from './search';
import { docsRuntimeFixture } from './test-fixture';

describe('public documentation runtime', () => {
  test('SSR, search, manifest, agent index, sitemap, raw Markdown and attachments share admitted content', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Welcome\n\nRead this public guide.\n\n[Download](report.pdf)\n\n## Configuration\n\nUse these settings.\n\n<script>BODY_SENTINEL</script>',
      'guide.md': '# Guide\n\n## Configuration\n\nDetailed settings.', 'private.md': '---\nvisibility: private\n---\n# PRIVATE_SENTINEL', '_work/notes.md': '# WORK_SENTINEL', 'report.pdf': '%PDF-1.7\nPUBLIC_ATTACHMENT' },
      { title: 'Reader', siteUrl: 'https://docs.example.test', editUrl: 'https://example.test/repo/edit/documentation' });
    const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot });
    try {
      const context = fixture.context(), handler = createDocsRequestHandler(runtime, fixture.options, context);
      const get = (path: string, init?: RequestInit) => handler(new Request('http://localhost' + path, init));
      const page = await get('/docs'), html = await page.text();
      expect(page.status).toBe(200); expect(html).toContain('<div id="zero-docs-root">'); expect(html).toContain('Welcome'); expect(html).toContain('href="/docs/guide"');
      expect(html).toContain('&lt;script&gt;BODY_SENTINEL&lt;/script&gt;'); expect(html).not.toContain('<script>BODY_SENTINEL'); expect(html).not.toContain('Restoring');
      expect(page.headers.get('content-security-policy')).toMatch(/nonce-[A-Za-z0-9+/]{24}/u); expect(page.headers.get('link')).toBe('<https://docs.example.test/docs>; rel="canonical"');
      expect(html).toContain('https://example.test/repo/edit/documentation/index.md');
      const search = await (await get('/docs/_api/search?q=Configuration')).json(); expect(search.results[0]?.route).toContain('#configuration');
      const projections = await Promise.all(['/docs/_api/manifest', '/docs/llms.txt', '/docs/sitemap.xml', '/docs/_api/markdown?path=/docs'].map(async path => (await get(path)).text()));
      const combined = [html, JSON.stringify(search), ...projections].join('\n'); expect(combined).not.toContain('PRIVATE_SENTINEL'); expect(combined).not.toContain('WORK_SENTINEL'); expect(combined).not.toContain(fixture.root);
      expect(projections[2]).toContain('<loc>https://docs.example.test/docs</loc>'); expect(projections[3]).not.toContain('visibility:');
      const publicIndex = JSON.parse(projections[0]!); expect(publicIndex.pages[0]).not.toHaveProperty('body'); expect(publicIndex.pages[0]).not.toHaveProperty('markdown'); expect(publicIndex.pages[0]).not.toHaveProperty('metadata');
      const missing = await get('/docs/private'); expect(missing.status).toBe(404); expect(missing.headers.get('content-type')).toContain('text/html'); expect(await missing.text()).toContain('Return to documentation');
      expect((await get('/docs/_api/markdown?path=/docs/private')).status).toBe(404);
      const asset = fixture.snapshot.data.manifest.assets[0]!; const response = await get(asset.route);
      expect(await response.text()).toContain('PUBLIC_ATTACHMENT'); expect(response.headers.get('content-disposition')).toStartWith('attachment;'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await get('/docs/_assets/unknown/report.pdf')).status).toBe(404);
    } finally { await runtime.dispose(); await fixture.close(); }
  });

  test('conditional reads and HEAD preserve body-free responses, bounded search and explicit sitemap configuration', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Home\n\nSearchable content.' }); const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot });
    try {
      const handler = createDocsRequestHandler(runtime, fixture.options, fixture.context());
      const first = await handler(new Request('http://localhost/docs/_api/manifest')); const etag = first.headers.get('etag')!;
      const cached = await handler(new Request('http://localhost/docs/_api/manifest', { headers: { 'If-None-Match': etag } })); expect(cached.status).toBe(304); expect(await cached.text()).toBe('');
      const head = await handler(new Request('http://localhost/docs', { method: 'HEAD' })); expect(head.status).toBe(200); expect(await head.text()).toBe('');
      expect((await handler(new Request('http://localhost/docs/sitemap.xml'))).status).toBe(404);
      expect((await handler(new Request('http://localhost/docs/_api/search?q=' + 'x'.repeat(201)))).status).toBe(400);
      expect((await handler(new Request('http://localhost/docs/_api/search?q=%00'))).status).toBe(400);
      expect(searchDocs(fixture.snapshot.data.manifest, 'content', 1)).toHaveLength(1); expect(searchDocs(fixture.snapshot.data.manifest, '   ')).toEqual([]);
      expect((await handler(new Request('http://localhost/docs/missing'))).headers.get('cache-control')).toBe('no-store');
    } finally { await runtime.dispose(); await fixture.close(); }
  });

  test('production setup serves compiled pages and private asset copies after its source folder is gone', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Deployment\n\n[File](report.pdf)', 'report.pdf': '%PDF-1.7\nPORTABLE_ASSET' });
    try {
      await rename(fixture.root + '/documentation', fixture.root + '/not-runtime-source');
      const context = fixture.context(); await setupDocs(context, fixture.options);
      const page = await context.app.handle(new Request('http://localhost/docs')); expect(page.status).toBe(200); expect(await page.text()).toContain('Deployment');
      const asset = fixture.snapshot.data.manifest.assets[0]!; expect(await (await context.app.handle(new Request('http://localhost' + asset.route))).text()).toContain('PORTABLE_ASSET');
      expect((await context.app.handle(new Request('http://localhost/docs/_api/search?q=Deployment'))).status).toBe(200);
    } finally { await fixture.close(); }
  });

  test('corrupt/missing artifacts and changed private bytes fail before routes are mounted', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Home\n\n[File](report.pdf)', 'report.pdf': '%PDF-1.7\nORIGINAL' });
    try {
      expect(() => admitDocsBuildData(undefined, fixture.options)).toThrow('Documentation content');
      const context = fixture.context(), data = admitDocsBuildData(context.frontend.plugins[fixture.options.name]!.data, fixture.options);
      await Bun.write(fixture.privateFiles[data.manifest.assets[0]!.id]!, 'CHANGED_SECRET');
      await expect(readDocsCompiledSnapshot(data, fixture.privateFiles)).rejects.toMatchObject({ code: 'DOCS_SOURCE_INVALID' });
      await expect(setupDocs(context, fixture.options)).rejects.toMatchObject({ code: 'DOCS_SOURCE_INVALID' });
      expect(context.app.routes).toHaveLength(0); expect(JSON.stringify(fixture.events)).not.toContain('CHANGED_SECRET');
    } finally { await fixture.close(); }
  });
});
