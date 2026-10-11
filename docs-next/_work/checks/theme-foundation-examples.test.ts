/** Compile actual foundation/configuration examples in memory; never boot application configuration. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

test('next foundation guide has a complete compiling public example and separate CSS entrypoints', async () => {
  const root = new URL('../../../', import.meta.url).pathname;
  const page = await Bun.file(new URL('../../frontend/design-system/foundation-next.md', import.meta.url)).text();
  const examples = [...page.matchAll(/^```tsx\n([\s\S]*?)^```/gm)];
  expect(examples).toHaveLength(1);
  expect(page).toContain('@import "@zero/framework/styles-legacy.css";\n@import "@zero/framework/styles-next.css";');
  expect(page).toContain('@import "@zero/framework/styles.css";');
  const fixture = `${root}docs-next/.foundation-next.example.tsx`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: { '@zero/framework/design-system': [`${root}src/design-system/index.ts`] },
  };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, createNew) => file === fixture
    ? ts.createSourceFile(file, examples[0]![1]!, version, true, ts.ScriptKind.TSX)
    : read(file, version, onError, createNew);
  const program = ts.createProgram([fixture], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic =>
    `${diagnostic.file?.fileName ?? 'compiler'} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)).toEqual([]);
}, 30_000);

test('managed foundation guide compiles its complete public server configuration', async () => {
  const root = new URL('../../../', import.meta.url).pathname;
  const page = await Bun.file(new URL('../../frontend/design-system/style-build.md', import.meta.url)).text();
  const examples = [...page.matchAll(/^```ts\n([\s\S]*?)^```/gm)];
  expect(examples).toHaveLength(1);
  expect(examples[0]![1]).toContain('themeFoundation: foundation');
  const fixture = `${root}docs-next/.managed-foundation.example.ts`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: { '@zero/framework/server': [`${root}src/frontend/server.ts`] },
  };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, createNew) => file === fixture
    ? ts.createSourceFile(file, examples[0]![1]!, version, true, ts.ScriptKind.TS)
    : read(file, version, onError, createNew);
  const program = ts.createProgram([fixture], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic =>
    `${diagnostic.file?.fileName ?? 'compiler'} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)).toEqual([]);
}, 30_000);
