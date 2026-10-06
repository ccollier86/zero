/** Synthetic HTTP cache/CSP contracts; no application or live content is opened. */
import { describe, expect, test } from 'bun:test';
import type { ZeroPluginSetupContext } from '@zero/framework/server';
import { docsHash } from '../content/identity';
import { createDocsRequestHandler } from './handler';
import { docsReadResponse } from './responses';
import { docsRuntimeFixture } from './test-fixture';
import { createDocsSnapshotRuntime } from './watch';

describe('documentation HTTP representation caching', () => {
  test('unchanged Markdown cannot retain obsolete frontend assets after deployment', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Unchanged content' });
    const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot });
    try {
      const first = createDocsRequestHandler(runtime, fixture.options, deployment(fixture.context(), fixture.options.name, 'old'));
      const second = createDocsRequestHandler(runtime, fixture.options, deployment(fixture.context(), fixture.options.name, 'new'));
      const original = await first(request('/docs'));
      const originalHtml = await original.text();
      expect(originalHtml).toContain('/reader-old.js');
      expect(originalHtml).toContain('/reader-old.css');
      const replacement = await second(request('/docs', 'GET', original.headers.get('etag')!));
      const replacementHtml = await replacement.text();
      expect(replacement.status).toBe(200);
      expect(replacementHtml).toContain('/reader-new.js');
      expect(replacementHtml).toContain('/reader-new.css');
      expect(replacementHtml).toContain('/platform-new.css');
      expect(replacementHtml).not.toContain('/reader-old.js');
      expect(replacement.headers.get('etag')).toBe('"' + docsHash(new TextEncoder().encode(replacementHtml)) + '"');
      expect(replacement.headers.get('etag')).not.toBe(original.headers.get('etag'));
      expect(replacement.headers.get('cache-control')).toBe('private, no-store');
    } finally { await runtime.dispose(); await fixture.close(); }
  });

  test('nonce-bearing HTML never returns 304, and each CSP authorizes its own markup', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Fresh nonce' });
    const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot });
    try {
      const handler = createDocsRequestHandler(runtime, fixture.options, deployment(fixture.context(), fixture.options.name, 'nonce'));
      const first = await handler(request('/docs'));
      const html = await first.text();
      const initialNonce = cspNonce(first);
      expect(html).toContain(`nonce="${initialNonce}"`);
      for (const validator of [first.headers.get('etag')!, 'W/' + first.headers.get('etag')!, '*']) {
        const next = await handler(request('/docs', 'GET', validator));
        const nextHtml = await next.text();
        expect(next.status).toBe(200);
        expect(cspNonce(next)).not.toBe(initialNonce);
        expect(nextHtml).toContain(`nonce="${cspNonce(next)}"`);
        expect(next.headers.get('cache-control')).toBe('private, no-store');
      }
    } finally { await runtime.dispose(); await fixture.close(); }
  });

  test('GET and HEAD share HTML security/status/representation headers, including public 404s', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Head parity' }, { siteUrl: 'https://docs.example.test' });
    const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot });
    try {
      const handler = createDocsRequestHandler(runtime, fixture.options, deployment(fixture.context(), fixture.options.name, 'head'));
      for (const path of ['/docs', '/docs/missing']) {
        const get = await handler(request(path));
        const body = await get.arrayBuffer();
        const head = await handler(request(path, 'HEAD', '*'));
        expect(head.status).toBe(get.status);
        expect(await head.text()).toBe('');
        for (const header of ['content-type', 'cache-control', 'x-content-type-options', 'referrer-policy', 'link']) {
          expect(head.headers.get(header)).toBe(get.headers.get(header));
        }
        expect(head.headers.get('content-length')).toBe(String(body.byteLength));
        expect(head.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/u);
        expect(head.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
        expect(cspNonce(head)).not.toBe(cspNonce(get));
      }
      for (const path of ['/docs/_api/missing', '/docs/_api/search?q=%00', '/docs/sitemap.xml']) {
        const get = await handler(request(path));
        const head = await handler(request(path, 'HEAD'));
        expect(head.status).toBe(get.status);
        expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
        expect(await head.text()).toBe('');
      }
    } finally { await runtime.dispose(); await fixture.close(); }
  });

  test('public projection validators belong to their exact body, not a shared manifest stamp', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Public representations' }, { siteUrl: 'https://docs.example.test' });
    const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot });
    try {
      const handler = createDocsRequestHandler(runtime, fixture.options, fixture.context());
      const responses = await Promise.all(['/docs/_api/manifest', '/docs/llms.txt', '/docs/sitemap.xml', '/docs/_api/markdown?path=/docs'].map(path => handler(request(path))));
      expect(new Set(responses.map(response => response.headers.get('etag'))).size).toBe(4);
      const manifestTag = responses[0]!.headers.get('etag')!;
      expect((await handler(request('/docs/llms.txt', 'GET', manifestTag))).status).toBe(200);
      for (const method of ['GET', 'HEAD']) {
        const same = await handler(request('/docs/_api/manifest', method, '"different", W/' + manifestTag));
        expect(same.status).toBe(304);
        expect(await same.text()).toBe('');
        expect(same.headers.get('etag')).toBe(manifestTag);
        expect(same.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      }
    } finally { await runtime.dispose(); await fixture.close(); }
  });

  test('If-None-Match uses valid weak entity-tag comparison, not comma splitting or wildcard list membership', async () => {
    for (const method of ['GET', 'HEAD']) {
      for (const value of ['"tag,with,commas"', 'W/"tag,with,commas"', '"other", W/"tag,with,commas"', '*']) {
        const response = docsReadResponse(request('/docs/read', method, value), 'body', 'text/plain', '"tag,with,commas"');
        expect(response.status).toBe(304);
        expect(await response.text()).toBe('');
      }
      for (const value of ['"tag,with,commas", junk', '"other", *', 'w/"tag,with,commas"', 'tag,with,commas', '"other"']) {
        const response = docsReadResponse(request('/docs/read', method, value), 'body', 'text/plain', '"tag,with,commas"');
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(method === 'HEAD' ? '' : 'body');
      }
    }
  });

  test('GET and newly rendered HEAD cannot publish a snapshot retired while SSR is pending', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# RETIRED_RENDER_SENTINEL' });
    try {
      for (const method of ['GET', 'HEAD']) {
        let current: typeof fixture.snapshot | null = fixture.snapshot, generation = 0;
        const handler = createDocsRequestHandler({
          current: () => current, generation: () => generation, dispose: async () => { current = null; generation++; },
        }, fixture.options, fixture.context());
        const pending = handler(request('/docs', method));
        current = null; generation++;
        const response = await pending;
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const body = await response.text();
        expect(body).not.toContain('RETIRED_RENDER_SENTINEL');
        if (method === 'HEAD') expect(body).toBe('');
      }
    } finally { await fixture.close(); }
  });
});

function request(path: string, method = 'GET', etag?: string): Request {
  return new Request('http://docs.example.test' + path, { method, ...(etag ? { headers: { 'If-None-Match': etag } } : {}) });
}
function cspNonce(response: Response): string {
  const nonce = response.headers.get('content-security-policy')?.match(/'nonce-([A-Za-z0-9+/]{24})'/u)?.[1];
  expect(nonce).toBeDefined();
  return nonce!;
}
function deployment(context: ZeroPluginSetupContext, name: string, version: string): ZeroPluginSetupContext {
  return { ...context, frontend: { ...context.frontend, cssPath: '/_build/platform-' + version + '.css',
    plugins: { ...context.frontend.plugins, [name]: { ...context.frontend.plugins[name]!, assets: {
      enhancement: { kind: 'script', publicPath: '/_build/reader-' + version + '.js' },
      styles: { kind: 'style', publicPath: '/_build/reader-' + version + '.css' },
    } } } } };
}
