/** Actual complete chart examples typecheck without a DOM, app config or live data. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

test('custom, Arc and handmade charts: actual controlled, reactive, inspection and headless examples compile', async () => {
  const root = new URL('../../', import.meta.url), repo = new URL('../', root).pathname;
  const fixtures = new Map<string, string>();
  for (const page of ['frontend/charts/sankey.md', 'frontend/charts/race-bar.md', 'frontend/charts/funnel.md', 'frontend/charts/arc.md', 'frontend/charts/native.md']) {
    const source = await Bun.file(new URL(page, root)).text();
    const fences = [...source.matchAll(/^```tsx?\n([\s\S]*?)^```/gm)];
    expect(fences).toHaveLength(5);
    for (const [index, fence] of fences.entries()) {
      expect(fence[1]!.trim()).not.toBe('');
      fixtures.set(new URL(page.replace('.md', `.example-${index}.tsx`), root).pathname, fence[1]!);
    }
  }
  expect(fixtures.size).toBe(25);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: {
      '@zero/framework/charts': [`${repo}src/charts/index.ts`],
      '@zero/framework/charts/react': [`${repo}src/frontend/client/chart-query.ts`],
      '@zero/framework/components/charts': [`${repo}src/components/charts/index.ts`],
      '@zero/framework/components/charts/arc': [`${repo}src/components/charts/arc/index.ts`],
      '@zero/framework/charts/arc': [`${repo}src/charts/arc.ts`],
      '@zero/framework/components/charts/native': [`${repo}src/components/charts/native/index.ts`],
      '@zero/framework/charts/native': [`${repo}src/charts/native.ts`],
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
