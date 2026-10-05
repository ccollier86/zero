/** Typechecks actual Guardian Markdown snippets without executing config or credentials. */

import { expect, test } from 'bun:test';
import ts from 'typescript';

const docs = new URL('../../', import.meta.url);
async function blocks(page: string): Promise<string[]> {
  const source = await Bun.file(new URL(`backend/guardian/${page}.md`, docs)).text();
  return [...source.matchAll(/^\`\`\`ts\n([\s\S]*?)^\`\`\`/gm)].map(match => match[1]!);
}

test('Guardian declarations and integration examples use public source contracts', async () => {
  const fixtures = new Map<string, string>();
  const add = (name: string, source: string) => {
    fixtures.set(new URL(`backend/guardian/${name}.example.ts`, docs).pathname, source);
  };
  for (const page of [
    'bootstrap', 'user-properties', 'mfa', 'authorization', 'rbac', 'tenancy',
    'invitations', 'verified-domains', 'api-keys', 'audit', 'identity-projection',
    'native-provider', 'integration', 'configuration',
  ]) {
    for (const [index, source] of (await blocks(page)).entries()) add(`${page}-${index}`, source);
  }
  const modes = await blocks('modes');
  add('modes-0', modes[0]!);
  add('modes-1', "import { defineAuthConfig } from '@zero/framework/auth';\n" + modes[1]!);
  const admission = await blocks('request-admission');
  add('request-admission-0', admission[0]!);
  // The guide explicitly labels the second block as a configuration fragment.
  add('request-admission-1',
    "import { defineAuthConfig } from '@zero/framework/auth';\n"
    + 'defineAuthConfig({\n' + admission[1]! + '\n});\n');
  const repo = new URL('../', docs).pathname;
  const config = ts.readConfigFile(`${repo}tsconfig.json`, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repo);
  const options: ts.CompilerOptions = {
    ...parsed.options, noEmit: true,
    paths: {
      ...parsed.options.paths,
      '@zero/framework/auth': [`${repo}src/auth/index.ts`],
      '@zero/framework/server': [`${repo}src/frontend/server.ts`],
      '@zero/framework/schema': [`${repo}src/schema/index.ts`],
      '@zero/framework/sync': [`${repo}src/sync/index.ts`],
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
  expect(fixtures.size).toBeGreaterThan(15);
  expect(diagnostics).toEqual([]);
}, 30_000);
