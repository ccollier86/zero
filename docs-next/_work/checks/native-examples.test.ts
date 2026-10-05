/** Checks actual client integration examples against current public source, without runtime adapters. */

import { expect, test } from 'bun:test';
import ts from 'typescript';

const docs = new URL('../../', import.meta.url);
test('Native and Chrome examples match their separate public contracts', async () => {
  const fixtures = new Map<string, string>();
  for (const page of ['framework-client', 'broker-sync', 'chrome']) {
    const source = await Bun.file(new URL(`backend/native-auth/${page}.md`, docs)).text();
    for (const [index, block] of [...source.matchAll(/^\`\`\`ts\n([\s\S]*?)^\`\`\`/gm)].entries()) {
      fixtures.set(new URL(`backend/native-auth/${page}-${index}.example.ts`, docs).pathname, block[1]!);
    }
  }
  const repo = new URL('../', docs).pathname;
  const config = ts.readConfigFile(`${repo}tsconfig.json`, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repo);
  const options: ts.CompilerOptions = {
    ...parsed.options, noEmit: true,
    paths: {
      ...parsed.options.paths,
      '@zero/framework/native': [`${repo}src/native/index.ts`],
      '@zero/chrome-auth': [`${repo}sdk/zero-chrome-auth/src/index.ts`],
    },
  };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = name => fixtures.get(name) ?? readFile(name);
  host.fileExists = name => fixtures.has(name) || fileExists(name);
  host.getSourceFile = (name, version, onError, createNew) => fixtures.has(name)
    ? ts.createSourceFile(name, fixtures.get(name)!, version, true)
    : readSource(name, version, onError, createNew);
  const program = ts.createProgram([...fixtures.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined;
    const file = diagnostic.file?.fileName.split('/').at(-1) ?? 'compiler';
    return `${file}${line ? `:${line}` : ''} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  expect(fixtures.size).toBe(5);
  expect(diagnostics).toEqual([]);
}, 30_000);
