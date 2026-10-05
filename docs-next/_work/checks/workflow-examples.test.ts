/** Typecheck actual Torrent/automation Markdown without executing app configuration. */

import { expect, test } from 'bun:test';
import ts from 'typescript';

const selected: Record<string, number[]> = {
  'guides/correlated-workflow.md': [0, 1, 2],
  'backend/database-automations/configuration.md': [0],
  'backend/database-automations/functions.md': [0],
  'backend/database-automations/durable-functions.md': [0],
  'backend/database-automations/triggers.md': [0],
  'backend/database-automations/validation.md': [0],
  'backend/torrent/configuration.md': [0],
  'backend/torrent/authoring.md': [0],
  'backend/torrent/expressions.md': [0],
  'backend/torrent/control-flow.md': [0, 1],
  'backend/torrent/interactions.md': [0],
  'backend/torrent/memory.md': [0],
  'backend/torrent/legacy-workflows.md': [0],
  'frontend/torrent/hooks.md': [0],
  'frontend/torrent/visualization.md': [0],
};

test('Torrent and database automation complete Markdown examples use public source APIs', async () => {
  const root = new URL('../../', import.meta.url);
  const fixtures = new Map<string, string>();
  for (const [page, indices] of Object.entries(selected)) {
    const text = await Bun.file(new URL(page, root)).text();
    const examples = [...text.matchAll(/^```tsx?\n([\s\S]*?)^```/gm)].map(match => match[1]!);
    for (const index of indices) {
      expect(examples[index], `${page}:${index}`).toBeDefined();
      const filename = new URL(`${page.replace('.md', '')}_${index}.example.tsx`, root).pathname;
      fixtures.set(filename, examples[index]!);
    }
  }
  const repo = new URL('../', root).pathname;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: {
      '@zero/framework/server': [`${repo}src/frontend/server.ts`],
      '@zero/framework/react': [`${repo}src/frontend/index.ts`],
      '@zero/framework/workflows': [`${repo}src/workflows/index.ts`],
      '@zero/framework/database-automations': [`${repo}src/database-automations/index.ts`],
      '@zero/framework/resources': [`${repo}src/resources/index.ts`],
    },
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, version, onError, createNew) => fixtures.has(filename)
    ? ts.createSourceFile(filename, fixtures.get(filename)!, version, true, ts.ScriptKind.TSX)
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
