/** Actual complete visualization examples compile against public facades without executing them. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

test('visualization configuration, workflow and inspection examples compile against public exports', async () => {
  const root = new URL('../../', import.meta.url), repo = new URL('../', root).pathname;
  const fixtures = new Map<string, string>();
  for (const page of ['backend/vector/visualizations.md', 'frontend/components/vector-visualization.md']) {
    const source = await Bun.file(new URL(page, root)).text();
    const fences = [...source.matchAll(/^```tsx?\n([\s\S]*?)^```/gm)];
    for (const [index, fence] of fences.entries()) {
      // Imperative usage fragments name an existing client/render callback;
      // complete import-led examples are executable modules and compile alone.
      if (!fence[1]!.trimStart().startsWith('import ')) continue;
      fixtures.set(new URL(page.replace('.md', `.example-${index}.tsx`), root).pathname, fence[1]!);
    }
  }
  expect(fixtures.size).toBe(5);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: {
      '@zero/framework': [`${repo}src/frontend/index.ts`],
      '@zero/framework/server': [`${repo}src/frontend/server.ts`],
      '@zero/framework/vector': [`${repo}src/vector/index.ts`],
      '@zero/framework/vector/visualization': [`${repo}src/vector/visualization.ts`],
      '@zero/framework/workflows': [`${repo}src/workflows/index.ts`],
    },
  };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, createNew) => fixtures.has(file)
    ? ts.createSourceFile(file, fixtures.get(file)!, version, true, ts.ScriptKind.TSX)
    : read(file, version, onError, createNew);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([...fixtures.keys()], options, host))
    .map(diagnostic => `${diagnostic.file?.fileName ?? 'compiler'} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  expect(diagnostics).toEqual([]);
}, 60_000);
