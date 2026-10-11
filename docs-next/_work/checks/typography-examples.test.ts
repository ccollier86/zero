/** Compile the real optional text/heading example against public source exports in memory; no app or font loading. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

test('typography reference example compiles native semantics, role overrides and core consumers', async () => {
  const root = new URL('../../../', import.meta.url).pathname;
  const page = await Bun.file(new URL('../../frontend/design-system/typography.md', import.meta.url)).text();
  const examples = [...page.matchAll(/^```tsx\n([\s\S]*?)^```/gm)];
  expect(examples).toHaveLength(1);
  const fixture = `${root}docs-next/.typography.example.tsx`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: {
      '@zero/framework/design-system': [`${root}src/design-system/index.ts`],
      '@zero/framework/components/typography': [`${root}src/components/typography/index.ts`],
      '@zero/framework/components/ui/button': [`${root}src/components/ui/button.tsx`],
    },
  };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, createNew) => file === fixture
    ? ts.createSourceFile(file, examples[0]![1]!, version, true, ts.ScriptKind.TSX)
    : read(file, version, onError, createNew);
  const program = ts.createProgram([fixture], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic =>
    `${diagnostic.file?.fileName ?? 'compiler'} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)).toEqual([]);
}, 30_000);
