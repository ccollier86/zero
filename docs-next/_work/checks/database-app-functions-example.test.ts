/** Typecheck and exercise the actual app-function adapter documented in Markdown. */
import { expect, test } from 'bun:test';
import ts from 'typescript';
import * as automations from '../../../src/database-automations';
import * as server from '../../../src/frontend/server';

async function example(): Promise<string> {
  const markdown = await Bun.file(new URL('../../backend/database-automations/app-functions.md', import.meta.url)).text();
  const block = /^```ts\n([\s\S]*?)^```/m.exec(markdown)?.[1];
  if (!block) throw new Error('The documented adapter is missing.');
  return block;
}

test('app-function documentation declaration uses valid public contracts', async () => {
  const code = await example();
  const root = new URL('../../../', import.meta.url).pathname;
  const filename = `${root}docs-next/backend/database-automations/app-functions.example.ts`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
    jsx: ts.JsxEmit.ReactJSX, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: {
      '@zero/framework/server': [`${root}src/frontend/server.ts`],
      '@zero/framework/database-automations': [`${root}src/database-automations/index.ts`],
    },
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (path, version, onError, createNew) => path === filename
    ? ts.createSourceFile(path, code, version, true) : read(path, version, onError, createNew);
  const program = ts.createProgram([filename], options, host);
  expect(ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
}, 30_000);

test('the documented adapter preserves parameters and stable effect identity', async () => {
  const code = ts.transpileModule(await example(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  const require = (name: string) => {
    if (name === '@zero/framework/database-automations') return automations;
    if (name === '@zero/framework/server') return server;
    throw new Error('Unexpected example dependency.');
  };
  new Function('require', 'exports', code)(require, exports);
  const calls: unknown[][] = [];
  const registry = exports.createAppFunctionAutomations({ invoke: async (...args: unknown[]) => { calls.push(args); } });
  const definition = registry.getFunction('function:jobs.invoke-app-function@1');
  const signal = new AbortController().signal;
  const zero = { scope: { scopeKind: 'tenant', tenantId: 'synthetic-tenant' } };
  const context = {
    input: { change: { row: { function_name: 'documents.publish', function_version: 2,
      parameters_json: JSON.stringify({ title: 'Example', labels: ['one', 'two'], count: 3 }) } } },
    invocation: { invocationId: 'synthetic-invocation', functionIdentity: definition.identity }, zero, signal,
  };
  await definition.handler(context);
  await definition.handler(context);
  expect(calls).toHaveLength(2);
  expect(calls[0]![0]).toEqual({ name: 'documents.publish', version: 2 });
  expect(calls[0]![1]).toEqual({ title: 'Example', labels: ['one', 'two'], count: 3 });
  expect(calls[0]![2]).toMatchObject({ zero, signal });
  expect((calls[0]![2] as any).idempotencyKey).toBe((calls[1]![2] as any).idempotencyKey);
  await expect(definition.handler({ ...context, input: { change: { row: {
    ...context.input.change.row, parameters_json: '{invalid-json',
  } } } })).rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
  expect(calls).toHaveLength(2);
});
