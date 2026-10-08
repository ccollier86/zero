/** Compile current modal documentation in memory; no app, transport, config or provider executes. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

const selected: Record<string, readonly number[]> = {
  'frontend/modals/index.md': [0],
  'frontend/modals/content.md': [0],
  'frontend/modals/motion.md': [0],
  'frontend/modals/forms.md': [0],
  'frontend/modals/workflow-progress.md': [0],
  'frontend/modals/confirm.md': [0, 1],
  'frontend/modals/prompt.md': [0],
  'frontend/components/dense-list.md': [0, 1],
  'frontend/components/primitives/tabs.md': [0],
  'frontend/forms/reactive-records.md': [0],
  'frontend/hooks/confirmation.md': [0],
};

test('structured modal/list/form examples compile through current public source exports', async () => {
  const docs = new URL('../../', import.meta.url);
  const repo = new URL('../', docs);
  const fixtures = new Map<string, string>();
  for (const [page, indices] of Object.entries(selected)) {
    const markdown = await Bun.file(new URL(page, docs)).text();
    const examples = [...markdown.matchAll(/^~~~(?:tsx|ts)\n([\s\S]*?)^~~~/gm)].map(match => match[1]!);
    for (const index of indices) {
      expect(examples[index], page + ':' + index).toBeDefined();
      fixtures.set(new URL(page.replace('.md', '') + '_' + index + '.example.tsx', docs).pathname, examples[index]!);
    }
  }
  const manifest = await Bun.file(new URL('package.json', repo)).json();
  const paths: Record<string, string[]> = {};
  for (const [name, target] of Object.entries(manifest.exports)) {
    if (!target || typeof target !== 'object' || !('types' in target)) continue;
    paths[name === '.' ? '@zero/framework' : '@zero/framework' + name.slice(1)] = [
      new URL((target as { types: string }).types, repo).pathname,
    ];
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
  host.readFile = name => fixtures.get(name) ?? readFile(name);
  host.fileExists = name => fixtures.has(name) || fileExists(name);
  host.getSourceFile = (name, version, onError, createNew) => fixtures.has(name)
    ? ts.createSourceFile(name, fixtures.get(name)!, version, true, ts.ScriptKind.TSX)
    : readSource(name, version, onError, createNew);
  const program = ts.createProgram([...fixtures.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(item => {
    const line = item.file && item.start !== undefined
      ? item.file.getLineAndCharacterOfPosition(item.start).line + 1 : undefined;
    const file = item.file?.fileName.split('/').at(-1) ?? 'compiler';
    return file + (line ? ':' + line : '') + ' TS' + item.code + ': ' + ts.flattenDiagnosticMessageText(item.messageText, '\n');
  });
  expect(diagnostics).toEqual([]);
}, 30_000);
