/** Typecheck actual AI manual examples without executing configuration or providers. */

import { expect, test } from 'bun:test';
import ts from 'typescript';

const selected: Record<string, number[]> = {
  'configuration.md': [0], 'provider-settings.md': [0], 'generation.md': [0, 1],
  'structured-output.md': [0], 'conversations.md': [0, 1], 'embeddings.md': [0],
  'reranking.md': [0], 'media.md': [0, 1, 2], 'hosted-files.md': [0, 1],
  'tools.md': [0, 1], 'agents.md': [0], 'video.md': [0],
};

test('AI manual service/configuration examples compile against public source exports', async () => {
  const root = new URL('../../', import.meta.url);
  const fixtures = new Map<string, string>();
  for (const [page, blocks] of Object.entries(selected)) {
    const markdown = await Bun.file(new URL(`backend/ai/${page}`, root)).text();
    const examples = [...markdown.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map(match => match[1]!);
    for (const block of blocks) {
      expect(examples[block], `${page} block ${block}`).toBeDefined();
      const filename = new URL(`backend/ai/__typecheck_${page.replace('.md', '')}_${block}.ts`, root).pathname;
      fixtures.set(filename, examples[block]!);
    }
  }
  const repo = new URL('../', root).pathname;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: { '@zero/framework/ai': [`${repo}src/ai/index.ts`] },
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, version, onError, createNew) => fixtures.has(filename)
    ? ts.createSourceFile(filename, fixtures.get(filename)!, version, true)
    : read(filename, version, onError, createNew);
  const program = ts.createProgram([...fixtures.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined;
    const file = diagnostic.file?.fileName.split('/').at(-1) ?? 'compiler';
    return `${file}${line ? `:${line}` : ''} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  expect(diagnostics).toEqual([]);
}, 30_000);
