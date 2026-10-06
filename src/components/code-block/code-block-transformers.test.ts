/** Highlighter features and security/ordering contracts shared by SSR and browser rendering. */
import { describe, expect, test } from 'bun:test';
import { highlightCodeBlock, buildFallbackCodeBlockHtml } from './code-block-highlight';
import { readCodeBlockMetadata, parseCodeBlockLineRanges, codeBlockHighlightKey } from './code-block-metadata';

describe('CodeBlock shared transformations', () => {
  test('uses CSS variables for syntax instead of fixed vendor colors', async () => {
    const result = await highlightCodeBlock('const greeting = "hello"; // comment', 'ts');
    expect(result.html).toContain('var(--zero-code-token-keyword)');
    expect(result.html).toMatch(/var\(--zero-code-token-string(?:-expression)?\)/);
    expect(result.html).toContain('var(--zero-code-token-comment)');
    expect(result.html).not.toMatch(/color:\s*#[0-9a-f]/i);
    expect(result.code).toBe('const greeting = "hello"; // comment');
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('applies line, literal word and fence word highlights without evaluating patterns', async () => {
    const result = await highlightCodeBlock('const first = "hello";\nconst second = "world";', 'ts', {
      meta: 'filename="client.ts" {2} /hello/', highlightWords: ['world'],
    });
    expect(result.html).toContain('data-title="client.ts"');
    expect(result.html.match(/zero-code-word-highlight/g)).toHaveLength(2);
    expect(result.html).toContain('class="line zero-code-highlighted" data-line-number="2"');
    expect(result.html).not.toMatch(/<\/span>\n<span class="line/);
  });
  test('qualifies notation diff, focus, line/word highlight and annotation opt-out', async () => {
    const source = 'const old = 1; // [!code --]\nconst next = 2; // [!code ++]\nnext(); // [!code focus]\nconst important = 3; // [!code highlight]';
    const html = (await highlightCodeBlock(source, 'ts')).html;
    expect(html).toContain('has-diff'); expect(html).toContain('diff remove'); expect(html).toContain('diff add');
    expect(html).toContain('has-focused'); expect(html).toContain('focused'); expect(html).toContain('zero-code-highlighted');
    expect(html).not.toContain('[!code');
    const plain = (await highlightCodeBlock(source, 'ts', { annotations: false })).html;
    expect(plain).toContain('[!code'); expect(plain).not.toContain('has-diff');
  });
  test('real line anchors preserve start line, wrapping and escaped malicious prefix/source', async () => {
    const result = await highlightCodeBlock('<script>alert(1)</script>\nnext', 'text', {
      lineAnchors: 'example" onclick="bad', showLineNumbers: true, startLine: 10, wordWrap: true,
    });
    expect(result.html).toContain('data-line-number="10"'); expect(result.html).toContain('Link to line 11');
    expect(result.html).toContain('data-word-wrap="true"'); expect(result.html).toContain('data-line-numbers="true"');
    expect(result.html).toMatch(/(?:&lt;|&#x3C;)script>/); expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain(' onclick="bad'); expect(result.html).toContain('href="#example%22-onclick%3D%22bad-l10"');
  });
  test('fallback escapes raw code and produces coherent numbered anchors', () => {
    const html = buildFallbackCodeBlockHtml('<img src=x onerror=alert(1)>\n', { lineAnchors: 'example', startLine: 5 });
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
    expect(html).toContain('id="example-l6"'); expect(html).toContain('data-line-number="5"');
  });
  test('supports existing explicitly named light/dark theme pairs', async () => {
    const result = await highlightCodeBlock('const value = 1', 'ts', { theme: { light: 'github-light', dark: 'github-dark-default' } });
    expect(result.html).toContain('shiki-themes'); expect(result.html).toContain('--shiki-dark:');
  });
  test('ANSI normal, bright and dim colors stay CSS-tokenized', async () => {
    const result = await highlightCodeBlock('\u001b[31mnormal\u001b[2;31mdim\u001b[0;91mbright\u001b[2;91mbright dim\u001b[0m', 'ansi');
    expect(result.html).toContain('var(--zero-code-ansi-red)');
    expect(result.html).toContain('var(--zero-code-ansi-red-dim)');
    expect(result.html).toContain('var(--zero-code-ansi-bright-red)');
    expect(result.html).toContain('var(--zero-code-ansi-bright-red-dim)');
  });
  test('preserves lazy embedded language highlighting in Markdown and ignores unknown embedded hints', async () => {
    const result = await highlightCodeBlock('```ruby\nputs "nested source"\n```\n```unknown-fence\nplain\n```', 'markdown');
    expect(result.html).toContain('var(--zero-code-token-string)');
    expect(result.html).toContain('nested source'); expect(result.html).toContain('unknown-fence');
  });
  test('fails safely for unsupported languages/themes instead of interpreting source', async () => {
    expect(highlightCodeBlock('source', 'not-a-language')).rejects.toThrow('Unsupported code language');
    expect(highlightCodeBlock('source', 'text', { theme: { light: 'not-a-theme', dark: 'github-dark' } })).rejects.toThrow('Unsupported code theme');
  });
  test('metadata and ranges use bounded integer validation, with explicit controls winning', () => {
    expect(readCodeBlockMetadata({ meta: 'filename="file.ts" showLineNumbers wrap startLine=10 {1,3-5} prefix="fence"' }))
      .toEqual({ title: 'file.ts', prefix: 'fence', lineNumbers: true, wordWrap: true, startLine: 10, highlightLines: [1, 3, 4, 5] });
    expect(readCodeBlockMetadata({ meta: 'lineNumbers startLine=4', showLineNumbers: false, startLine: -1 }).startLine).toBe(1);
    expect(readCodeBlockMetadata({ meta: 'lineNumbers', showLineNumbers: false }).lineNumbers).toBe(false);
    expect(parseCodeBlockLineRanges('0,5-2,1-1000000000000,3,3,8-10')).toEqual([3, 8, 9, 10]);
    expect(readCodeBlockMetadata({ meta: '{1-100000}' }, 3).highlightLines).toEqual([1, 2, 3]);
    expect(codeBlockHighlightKey('a', 'ts', { wordWrap: true })).not.toBe(codeBlockHighlightKey('a', 'ts', { wordWrap: false }));
  });
  test('deduplicates word metadata and bounds highlight expansion without executing regexes', async () => {
    const html = (await highlightCodeBlock('literal', 'text', { meta: '/literal/ /literal/', highlightWords: ['literal'] })).html;
    expect(html.match(/zero-code-word-highlight/g)).toHaveLength(1);
    expect(highlightCodeBlock('a'.repeat(20_001), 'text', { meta: '/a/' })).rejects.toThrow('decoration budget');
    expect(highlightCodeBlock('source', 'text', { highlightWords: Array.from({ length: 2049 }, (_, index) => String(index)) })).rejects.toThrow('word budget');
  });
  test('concurrent renders do not share highlight metadata', async () => {
    const [first, second] = await Promise.all([
      highlightCodeBlock('const a = 1;\nconst b = 2;', 'ts', { highlightLines: [1], lineAnchors: 'first' }),
      highlightCodeBlock('const a = 1;\nconst b = 2;', 'ts', { highlightLines: [2], lineAnchors: 'second' }),
    ]);
    expect(first.html).toContain('class="line zero-code-highlighted" data-line-number="1"');
    expect(first.html).not.toContain('second-l'); expect(second.html).not.toContain('first-l');
    expect(second.html).toContain('class="line zero-code-highlighted" data-line-number="2"');
  });
});
