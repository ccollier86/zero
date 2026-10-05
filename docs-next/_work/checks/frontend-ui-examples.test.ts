/** Typechecks actual UI Markdown fragments in memory; never mounts an app or loads providers. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

const selected: Record<string, number[]> = {
  'frontend/app-shell/presets.md': [0],
  'frontend/app-shell/navigation.md': [0],
  'frontend/app-shell/workspaces.md': [0],
  'frontend/app-shell/header-and-account.md': [0],
  'frontend/data-studio/workspace.md': [0, 1, 2],
  'frontend/data-studio/controller.md': [0],
  'frontend/components/primitives/inputs.md': [0],
  'frontend/components/primitives/choices.md': [0],
  'frontend/components/primitives/tags-and-validation.md': [0],
  'frontend/components/primitives/dates-and-time.md': [0],
  'frontend/components/primitives/inline-editing.md': [0],
  'frontend/components/primitives/surfaces.md': [0],
  'frontend/components/primitives/list-detail.md': [0],
  'frontend/components/primitives/resizable.md': [0],
  'frontend/data-controls/master-detail.md': [1],
  'frontend/components/primitives/tables-and-pagination.md': [0],
  'frontend/components/primitives/breadcrumbs.md': [0],
  'frontend/components/primitives/charts.md': [0],
  'frontend/components/primitives/command.md': [0],
  'frontend/components/primitives/scroll-area.md': [0],
  'frontend/components/primitives/toasts.md': [0],
  'frontend/components/sensitive-display.md': [0, 1],
  'frontend/components/json-editor.md': [0],
  'frontend/components/text/streaming-text.md': [0],
  'frontend/components/text/effects.md': [0],
  'frontend/components/scroll-anchoring.md': [0],
  'frontend/components/public-pages/navigation.md': [0],
  'frontend/components/public-pages/hero.md': [0],
  'frontend/components/public-pages/backgrounds.md': [0],
  'frontend/components/public-pages/sections.md': [0],
  'frontend/components/public-pages/faq.md': [0],
  'frontend/components/public-pages/code-block.md': [0],
  'frontend/components/public-pages/collections.md': [0],
};

test('AppShell and reusable UI examples compile through the actual public source paths', async () => {
  const root = new URL('../../', import.meta.url);
  const repo = new URL('../', root);
  const fixtures = new Map<string, string>();
  for (const [page, indices] of Object.entries(selected)) {
    const source = await Bun.file(new URL(page, root)).text();
    const examples = [...source.matchAll(/^```(?:tsx|ts)\n([\s\S]*?)^```/gm)].map(match => match[1]!);
    for (const index of indices) {
      expect(examples[index], `${page}:${index}`).toBeDefined();
      fixtures.set(new URL(`${page.replace('.md', '')}_${index}.example.tsx`, root).pathname, examples[index]!);
    }
  }
  const manifest = await Bun.file(new URL('package.json', repo)).json();
  const paths: Record<string, string[]> = {};
  for (const [name, target] of Object.entries(manifest.exports)) {
    if (!target || typeof target !== 'object' || !('types' in target)) continue;
    const publicName = name === '.' ? '@zero/framework' : `@zero/framework${name.slice(1)}`;
    paths[publicName] = [new URL((target as { types: string }).types, repo).pathname];
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'], paths,
  };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = filename => fixtures.get(filename) ?? readFile(filename);
  host.fileExists = filename => fixtures.has(filename) || fileExists(filename);
  host.getSourceFile = (filename, version, onError, createNew) => fixtures.has(filename)
    ? ts.createSourceFile(filename, fixtures.get(filename)!, version, true, ts.ScriptKind.TSX)
    : readSource(filename, version, onError, createNew);
  const program = ts.createProgram([...fixtures.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined;
    const file = diagnostic.file?.fileName.split('/').at(-1) ?? 'compiler';
    return `${file}${line ? `:${line}` : ''} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  expect(diagnostics).toEqual([]);
}, 30_000);
