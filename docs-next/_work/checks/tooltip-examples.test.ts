/** Typecheck actual tooltip guide examples against public source exports; no app/config/transport executes. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

test('complete tooltip composition, group, rich, motion and overflow examples compile through the public facade', async () => {
  const docs = new URL('../../', import.meta.url), repo = new URL('../', docs);
  const guide = new URL('frontend/components/overlays/tooltip.md', docs);
  const markdown = await Bun.file(guide).text();
  const examples = [...markdown.matchAll(/^~~~tsx\n([\s\S]*?)^~~~/gm)].map(match => match[1]!);
  expect(examples.length).toBe(5);
  const fixtures = new Map(examples.map((source, index) => [new URL('tooltip_' + index + '.example.tsx', guide).pathname, source]));
  const manifest = await Bun.file(new URL('package.json', repo)).json();
  const paths: Record<string, string[]> = {};
  for (const [name, target] of Object.entries(manifest.exports)) {
    if (!target || typeof target !== 'object' || !('types' in target)) continue;
    paths[name === '.' ? '@zero/framework' : '@zero/framework' + name.slice(1)] = [new URL((target as { types: string }).types, repo).pathname];
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'], paths,
  };
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host), fileExists = host.fileExists.bind(host);
  host.readFile = name => fixtures.get(name) ?? readFile(name);
  host.fileExists = name => fixtures.has(name) || fileExists(name);
  host.getSourceFile = (name, version, onError, createNew) => fixtures.has(name)
    ? ts.createSourceFile(name, fixtures.get(name)!, version, true, ts.ScriptKind.TSX)
    : original(name, version, onError, createNew);
  const program = ts.createProgram([...fixtures.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(item => {
    const line = item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start).line + 1 : undefined;
    return (item.file?.fileName.split('/').at(-1) ?? 'compiler') + (line ? ':' + line : '') + ' TS' + item.code + ': '
      + ts.flattenDiagnosticMessageText(item.messageText, '\n');
  });
  expect(diagnostics).toEqual([]);
}, 40_000);
