/** Regression evidence for custom-transformer identity and preparation snapshots. */
import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ShikiTransformer } from 'shiki';
import { CodeBlock, highlightCodeBlock, prepareCodeBlock } from './index';
import { codeBlockHighlightKey } from './code-block-metadata';
import { codeBlockHighlightLiveIdentity } from './code-block-highlight-identity';

const stamp = (value: string): ShikiTransformer => ({ name: 'custom-stamp', pre(node) {
  node.properties['data-custom-stamp'] = value;
} });

describe('CodeBlock custom transformer result identity', () => {
  test('different functions with the same name cannot reuse prepared old HTML', async () => {
    const original = stamp('original'), replacement = stamp('replacement');
    const prepared = await prepareCodeBlock({ code: 'source', language: 'text', transformers: [original] });
    expect(renderToStaticMarkup(<CodeBlock {...prepared} highlightOnClient={false} />)).toContain('data-custom-stamp="original"');
    expect(codeBlockHighlightKey('source', 'text', { transformers: [original] }))
      .not.toBe(codeBlockHighlightKey('source', 'text', { transformers: [replacement] }));
    const changed = renderToStaticMarkup(<CodeBlock {...prepared} transformers={[replacement]} highlightOnClient={false} />);
    expect(changed).toContain('zero-code-block-fallback');
    expect(changed).not.toContain('data-custom-stamp="original"');
  });

  test('preparation captures mutable hooks and presentation before the first asynchronous boundary', async () => {
    const transformer = stamp('original');
    const options = { transformers: [transformer], meta: 'filename="original.txt"' };
    const key = codeBlockHighlightKey('source', 'text', options);
    const pending = highlightCodeBlock('source', 'text', options);
    transformer.pre = stamp('replacement').pre;
    options.meta = 'filename="replacement.txt"';
    const result = await pending;
    expect(result.key).toBe(key);
    expect(result.html).toContain('data-custom-stamp="original"');
    expect(result.html).toContain('data-title="original.txt"');
    expect(result.html).not.toContain('replacement');
    expect(renderToStaticMarkup(<CodeBlock code="source" language="text" highlighted={result}
      transformers={[transformer]} meta={options.meta} highlightOnClient={false} />)).toContain('zero-code-block-fallback');
  });

  test('portable custom results require an explicit identity while live results still fence different hooks', async () => {
    const original = stamp('original'), replacement = stamp('replacement');
    const prepared = await prepareCodeBlock({ code: 'source', language: 'text', transformers: [original], transformerIdentity: 'custom-stamp:v1' });
    const serialized = JSON.parse(JSON.stringify(prepared.highlighted));
    const same = renderToStaticMarkup(<CodeBlock {...prepared} highlighted={serialized} highlightOnClient={false} />);
    expect(same).toContain('data-custom-stamp="original"');
    const identityOnly = { code: prepared.code, language: prepared.language, transformerIdentity: prepared.transformerIdentity,
      highlightOnClient: false, highlighted: serialized };
    expect(renderToStaticMarkup(<CodeBlock {...identityOnly} />)).toContain('data-custom-stamp="original"');
    expect(renderToStaticMarkup(<CodeBlock {...identityOnly} highlighted={prepared.highlighted} />))
      .toContain('data-custom-stamp="original"');
    expect(codeBlockHighlightKey('source', 'text', { transformers: [original], transformerIdentity: 'custom-stamp:v1' }))
      .toBe(codeBlockHighlightKey('source', 'text', { transformers: [replacement], transformerIdentity: 'custom-stamp:v1' }));
    expect(renderToStaticMarkup(<CodeBlock {...prepared} transformers={[replacement]} highlightOnClient={false} />))
      .toContain('zero-code-block-fallback');
    expect(renderToStaticMarkup(<CodeBlock {...prepared} highlighted={serialized} transformerIdentity="custom-stamp:v2" highlightOnClient={false} />))
      .toContain('zero-code-block-fallback');
    const local = await prepareCodeBlock({ code: 'source', language: 'text', transformers: [original] });
    expect(renderToStaticMarkup(<CodeBlock {...local} highlighted={JSON.parse(JSON.stringify(local.highlighted))} highlightOnClient={false} />))
      .toContain('zero-code-block-fallback');
  });

  test('a same-object hook replacement creates a new live generation under a portable key', () => {
    const transformer = stamp('original');
    const options = { transformers: [transformer], transformerIdentity: 'custom-stamp:v1' };
    const key = codeBlockHighlightKey('source', 'text', options), generation = codeBlockHighlightLiveIdentity(options);
    transformer.pre = stamp('replacement').pre;
    expect(codeBlockHighlightKey('source', 'text', options)).toBe(key);
    expect(codeBlockHighlightLiveIdentity(options)).not.toBe(generation);
  });

  test('ordinary deterministic results survive serialization and invalid custom identities fail safely', async () => {
    const prepared = await prepareCodeBlock({ code: 'const value = 1', language: 'ts' });
    expect(renderToStaticMarkup(<CodeBlock {...prepared} highlighted={JSON.parse(JSON.stringify(prepared.highlighted))} highlightOnClient={false} />))
      .not.toContain('zero-code-block-fallback');
    for (const transformerIdentity of ['', '   ', 'x'.repeat(257)]) {
      await expect(highlightCodeBlock('source', 'text', { transformers: [stamp('test')], transformerIdentity })).rejects.toThrow('transformerIdentity');
    }
  });

  test('fallback preparation retains the captured file even if a failure callback changes the authored file', async () => {
    const file = { id: 'one', code: '<original>', language: 'unsupported-language', filename: 'original.txt' };
    const prepared = await prepareCodeBlock({ files: [file] }, { fallbackOnError: true, onHighlightError() {
      file.code = '<replacement>'; file.language = 'text'; file.filename = 'replacement.txt';
    } });
    expect(prepared.files![0]).toMatchObject({ code: '<original>', language: 'unsupported-language', filename: 'original.txt' });
    expect(prepared.files![0]!.highlighted).toMatchObject({ code: '<original>', language: 'unsupported-language' });
    expect(renderToStaticMarkup(<CodeBlock {...prepared} highlightOnClient={false} />)).toContain('&lt;original&gt;');
    expect(prepared.files![0]!.highlighted!.html).not.toContain('replacement');
  });
});
