/** Qualify SSR reuse, HTML-only hydration roots, escaped metadata and request-local nonces. */
import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderServerPage } from './server-page-renderer';
import { wrapWithHtmlShell } from '../router/renderer';
import { OBS_CODES, configureObservability, emitPlatformCodeTo } from '../../observability';

const frontend = Object.freeze({ cssPath: '/_build/platform.css', plugins: {
  reader: { publicBasePath: '/_build/plugins/reader', assets: { reader: { kind: 'script' as const, publicPath: '/_build/plugins/reader/enhance.js' }, style: { kind: 'style' as const, publicPath: '/_build/plugins/reader/reader.css' } }, data: { private: 'NOT_IN_PUBLIC_HEAD' } },
  unrelated: { publicBasePath: '/_build/plugins/other', assets: { other: { kind: 'script' as const, publicPath: '/_build/plugins/other/other.js' } } },
} });
function Article({ text }: { text: string }) { const id = React.useId(); return <article><h1 id={id}>{text}</h1><a href="#next">Useful without JavaScript</a></article>; }

describe('native server plugin pages', () => {
  test('renders an SSR article without auth restoration/hydration gates and includes actual selected assets', async () => {
    const response = await renderServerPage({ component: Article, props: { text: 'Complete documentation' }, request: new Request('http://localhost/docs'), appDir: './app', frontend, pluginName: 'reader', rootId: 'docs-reader', nonce: 'request-nonce', meta: { title: '<Readable title>', description: 'Text "quoted" safely.' } });
    const html = await response.text();
    expect(response.status).toBe(200); expect(html).toContain('<div id="docs-reader"><article>'); expect(html).toContain('Complete documentation'); expect(html).toContain('Useful without JavaScript');
    expect(html).toContain('&lt;Readable title&gt;'); expect(html).toContain('Text &quot;quoted&quot; safely.'); expect(html).toContain('src="/_build/plugins/reader/enhance.js" nonce="request-nonce"');
    expect(html).toContain('href="/_build/platform.css"'); expect(html).toContain('href="/_build/plugins/reader/reader.css"');
    expect(html).not.toContain('NOT_IN_PUBLIC_HEAD'); expect(html).not.toContain('other.js'); expect(html).not.toContain('__ROUTE_DATA__'); expect(html).not.toContain('Restoring');
  });

  test('root/nonce values are escaped and cannot create script attributes', async () => {
    const response = await renderServerPage({ component: Article, props: { text: 'Safe' }, request: new Request('http://localhost/docs'), appDir: './app', frontend, pluginName: 'reader', rootId: 'docs"><script>attack()</script>', nonce: 'nonce" onload="attack()' });
    const html = await response.text(); expect(html).toContain('id="docs&quot;&gt;&lt;script&gt;attack()&lt;/script&gt;"'); expect(html).not.toContain('<script>attack()'); expect(html).not.toContain(' onload="attack()');
  });

  test('request nonce is not reused and HEAD does not execute the component or expose a body', async () => {
    let renders = 0;
    const response = await renderServerPage({ component() { renders += 1; return null; }, props: {}, request: new Request('http://localhost/docs', { method: 'HEAD' }), appDir: './app', frontend, nonce: 'head-only' });
    expect(response.status).toBe(200); expect(await response.text()).toBe(''); expect(renders).toBe(0);
    const next = await renderServerPage({ component: Article, props: { text: 'No old nonce' }, request: new Request('http://localhost/docs'), appDir: './app', frontend, pluginName: 'reader' }); expect(await next.text()).not.toContain('head-only');
  });

  test('SSR failure stays public-safe and is emitted once through caller-owned observability', async () => {
    const codes: string[] = [];
    const observability = configureObservability(false);
    const response = await renderServerPage({ component() { throw new Error('PRIVATE_DOCUMENT_BODY'); }, props: {}, request: new Request('http://localhost/docs'), appDir: './app', frontend, emitCode(code, event) { codes.push(code.code); expect(event?.error).toBeUndefined(); return emitPlatformCodeTo(observability, code, event); } });
    expect(response.status).toBe(500); expect(await response.text()).toBe('Page could not be rendered.'); expect(codes).toEqual([OBS_CODES.RENDERER_SSR_ERROR.code]);
  });

  test('HTML shell preserves streaming backpressure and cancellation without a React wrapper', async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('<article>one chunk</article>')); }, cancel() { cancelled = true; } });
    const wrapped = wrapWithHtmlShell(source, '<title>Streaming</title>', { rootId: 'stream-root' }); const reader = wrapped.getReader(); const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('<div id="stream-root">'); await reader.cancel(); expect(cancelled).toBe(true);
  });
});
