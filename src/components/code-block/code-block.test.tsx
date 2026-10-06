/** Native/SSR composition and backward-compatible CodeBlock behavior. */
import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeBlock, CodeBlockRoot, CodeBlockHeader, CodeBlockGroup, CodeBlockTitle, CodeBlockIcon,
  CodeBlockContent, CodeBlockCode, CodeBlockCopyButton, CodeBlockInline, CodeBlockMarkdown, CodeBlockPre,
  CodeBlockPackageManager, prepareCodeBlock, getCodeBlockPackageCommand } from './index';

describe('CodeBlock public compositions', () => {
  test('legacy convenience props preserve file tabs, copy control and native attributes', () => {
    const html = renderToStaticMarkup(<CodeBlock data-testid="legacy" files={[
      { id: 'server', filename: 'server.ts', language: 'ts', code: '<danger>' },
      { id: 'page', filename: 'page.tsx', language: 'tsx', code: 'page' },
    ]} defaultFileId="server" minLines={12} headerClassName="caller-header" viewportClassName="caller-viewport" />);
    expect(html).toContain('data-testid="legacy"'); expect(html).toContain('caller-header'); expect(html).toContain('caller-viewport');
    expect(html).toContain('aria-label="Code files"'); expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('role="tabpanel"'); expect(html).toContain('aria-controls='); expect(html).toContain('&lt;danger&gt;');
    expect(html).toContain('var(--zero-code-font-size)'); expect(html).toContain('aria-label="Copy code"');
  });
  test('controlled file selection chooses the expected source in SSR', () => {
    const html = renderToStaticMarkup(<CodeBlock files={[{ id: 'a', language: 'text', code: 'first' },
      { id: 'b', language: 'text', code: 'second' }]} activeFileId="b" copyButton={false} showLineNumbers={false} />);
    expect(html).toContain('second'); expect(html).not.toContain('>first<'); expect(html).not.toContain('aria-label="Copy code"');
    expect(html).toContain('data-line-numbers="false"');
  });
  test('full composable surface accepts Zero-native props and custom headers/content', () => {
    const html = renderToStaticMarkup(<CodeBlockRoot aria-label="Custom code"><CodeBlockHeader><CodeBlockGroup>
      <CodeBlockIcon language="ts" /><CodeBlockTitle>Example</CodeBlockTitle></CodeBlockGroup>
      <CodeBlockCopyButton content="hello" variant="text" disabled name="copy" /></CodeBlockHeader>
      <CodeBlockContent minLines={8}><CodeBlockCode code="hello" language="text" highlightOnClient={false} /></CodeBlockContent></CodeBlockRoot>);
    expect(html).toContain('aria-label="Custom code"'); expect(html).toContain('Example'); expect(html).toContain('disabled=""');
    expect(html).toContain('name="copy"'); expect(html).toContain('>Copy<'); expect(html).toContain('hello');
  });
  test('server-prepared code is highlighted before JavaScript and preserves option binding', async () => {
    const props = await prepareCodeBlock({ code: 'const value = "hello";', language: 'ts', lineAnchors: 'ssr', highlightLines: [1] });
    const html = renderToStaticMarkup(<CodeBlock {...props} highlightOnClient={false} />);
    expect(html).toContain('var(--zero-code-token-keyword)'); expect(html).toContain('zero-code-highlighted');
    expect(html).toContain('id="ssr-l1"'); expect(html).not.toContain('zero-code-block-fallback');
    const changed = renderToStaticMarkup(<CodeBlock {...props} code="changed" highlightOnClient={false} />);
    expect(changed).toContain('>changed<'); expect(changed).not.toContain('hello'); expect(changed).toContain('zero-code-block-fallback');
  });
  test('publishing can explicitly retain escaped code and report an unsupported fence language', async () => {
    const reported: string[] = [];
    const props = await prepareCodeBlock({ code: '<script>danger</script>', language: 'unsupported-fence' }, {
      fallbackOnError: true, onHighlightError: (_error, file) => { reported.push(file.language); },
    });
    const html = renderToStaticMarkup(<CodeBlock {...props} highlightOnClient={false} />);
    expect(reported).toEqual(['unsupported-fence']); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(prepareCodeBlock({ code: 'source', language: 'unsupported-fence' })).rejects.toThrow('Unsupported code language');
  });
  test('inline, Markdown and trusted pre adapters preserve safe distinct use cases', () => {
    expect(renderToStaticMarkup(<CodeBlockInline code="bun add example" language="bash" />)).toContain('zero-code-block-inline');
    const markdown = renderToStaticMarkup(<CodeBlockMarkdown code="value" language="ts" meta='filename="client.ts" lineNumbers' />);
    expect(markdown).toContain('client.ts'); expect(markdown).toContain('data-line-numbers="true"');
    const pre = renderToStaticMarkup(<CodeBlockPre className="custom" data-language="ts" data-title="Client" id="compiled">
      <code><span className="line">one</span>{'\n'}<span className="line">two</span></code></CodeBlockPre>);
    expect(pre).toContain('Client'); expect(pre).toContain('id="compiled"'); expect(pre).toContain('class="line"'); expect(pre).toContain('aria-label="Copy code"');
  });
  test('package-manager block supports every upstream manager and command mode, Bun by default', () => {
    expect(getCodeBlockPackageCommand('bun', 'example')).toBe('bun add example');
    expect(getCodeBlockPackageCommand('npm', 'example', 'dlx')).toBe('npx example');
    expect(getCodeBlockPackageCommand('pnpm', 'build', 'run')).toBe('pnpm run build');
    expect(getCodeBlockPackageCommand('yarn', 'example')).toBe('yarn add example');
    const tabs = renderToStaticMarkup(<CodeBlockPackageManager command="example" />);
    expect(tabs.match(/role="tab"/g)).toHaveLength(4); expect(tabs).toContain('bun add example');
    const select = renderToStaticMarkup(<CodeBlockPackageManager command="example" mode="select" defaultValue="pnpm" />);
    expect(select).toContain('Package manager: pnpm'); expect(select).toContain('pnpm add example');
  });
});
