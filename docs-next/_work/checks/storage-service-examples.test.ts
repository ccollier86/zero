/** Compiles actual Guardian/Storage UI and small-service Markdown without executing examples. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

const docs = new URL('../../', import.meta.url);
const folders = [
  'frontend/guardian', 'frontend/storage', 'frontend/notifications', 'frontend/rooms',
  'backend/email', 'backend/notifications', 'backend/rooms', 'backend/tokens',
  'backend/observability', 'backend/kv', 'backend/pdf',
];

test('Guardian/Storage and service Markdown examples compile against actual public source exports', async () => {
  const fixtures = new Map<string, string>();
  for (const folder of folders) {
    for (const name of new Bun.Glob('*.md').scanSync({ cwd: new URL(folder, docs).pathname })) {
      const page = new URL(`${folder}/${name}`, docs);
      const text = await Bun.file(page).text();
      let index = 0;
      for (const match of text.matchAll(/^```(tsx?)\n([\s\S]*?)^```/gm)) {
        const filename = `${page.pathname}.${index++}.example.${match[1]}`;
        fixtures.set(filename, match[2]!);
      }
    }
  }
  const repo = new URL('../', docs).pathname;
  const config = ts.readConfigFile(`${repo}tsconfig.json`, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repo);
  const options: ts.CompilerOptions = {
    ...parsed.options, noEmit: true,
    paths: {
      ...parsed.options.paths,
      '@zero/framework/react': [`${repo}src/frontend/index.ts`],
      '@zero/framework/react/hooks': [`${repo}src/frontend/client/hooks.ts`],
      '@zero/framework/components/storage': [`${repo}src/components/storage/index.ts`],
      '@zero/framework/components/auth': [`${repo}src/components/auth/index.ts`],
      '@zero/framework/email': [`${repo}src/email/index.ts`],
      '@zero/framework/tokens': [`${repo}src/tokens/index.ts`],
      '@zero/framework/pdf': [`${repo}src/pdf/index.ts`],
    },
  };
  const host = ts.createCompilerHost(options);
  const source = host.getSourceFile.bind(host), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.readFile = name => fixtures.get(name) ?? read(name);
  host.fileExists = name => fixtures.has(name) || exists(name);
  host.getSourceFile = (name, version, onError, createNew) => fixtures.has(name)
    ? ts.createSourceFile(name, fixtures.get(name)!, version, true)
    : source(name, version, onError, createNew);
  const program = ts.createProgram([...fixtures.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined;
    return `${diagnostic.file?.fileName.split('/').at(-1) ?? 'compiler'}${line ? `:${line}` : ''} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  expect(fixtures.size).toBe(50);
  expect(diagnostics).toEqual([]);
}, 30_000);
