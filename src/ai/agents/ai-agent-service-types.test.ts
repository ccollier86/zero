/** Compile public facade inference without running any agent/model or app module. */

import { expect, test } from 'bun:test';
import ts from 'typescript';

const contract = `
import { AIAgentService, type AIAgentToolSet, type AITextOutput } from '@zero/framework/ai';
declare const agents: AIAgentService;
const reference = { name: 'task', version: '1' };
agents.generate(reference, { prompt: 'Task.', runtimeContext: {}, toolsContext: {} });
agents.stream(reference, { prompt: 'Task.', runtimeContext: {}, toolsContext: {} });
type Runtime = { organizationId: string };
type Execution = { lookup(): Promise<string> };
type Tools = AIAgentToolSet<Runtime, Execution>;
const runtime = { organizationId: 'synthetic-org' };
const execution = { lookup: async () => 'synthetic' };
agents.generate(reference, { prompt: 'Task.', runtimeContext: runtime, toolsContext: {}, executionContext: execution });
agents.stream(reference, { prompt: 'Task.', runtimeContext: runtime, toolsContext: {}, executionContext: execution });
agents.generate<Runtime, Execution, Tools, AITextOutput>(reference, {
 prompt: 'Task.', runtimeContext: runtime, toolsContext: {}, executionContext: execution,
});
agents.stream<Runtime, Execution, Tools, AITextOutput>(reference, {
 prompt: 'Task.', runtimeContext: runtime, toolsContext: {}, executionContext: execution,
});
// @ts-expect-error a declared service context remains mandatory.
agents.generate<Runtime, Execution, Tools, AITextOutput>(reference, {
 prompt: 'Task.', runtimeContext: runtime, toolsContext: {},
});
// @ts-expect-error streaming must also retain the required service context.
agents.stream<Runtime, Execution, Tools, AITextOutput>(reference, {
 prompt: 'Task.', runtimeContext: runtime, toolsContext: {},
});
// @ts-expect-error the context must implement the explicitly declared service.
agents.generate<Runtime, Execution, Tools, AITextOutput>(reference, { prompt: 'Task.', runtimeContext: runtime, toolsContext: {}, executionContext: {} });
`;

test('agent service defaults absent execution context but preserves explicit typed requirements', () => {
  const fixture = `${import.meta.dir}/__in_memory_service_contract.ts`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'],
    paths: { '@zero/framework/ai': [`${import.meta.dir}/../index.ts`] },
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, version, onError, createNew) => filename === fixture
    ? ts.createSourceFile(fixture, contract, version, true)
    : read(filename, version, onError, createNew);
  const program = ts.createProgram([fixture], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined;
    return `TS${diagnostic.code}${line ? `:${line}` : ''} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  expect(diagnostics).toEqual([]);
}, 30_000);
