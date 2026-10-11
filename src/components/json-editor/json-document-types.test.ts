/** Compile the additive editor's public contract without evaluating application code. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

test('JSON document editor public controls and accepted writer keep strict types', () => {
  const fixture = `${import.meta.dir}/__in_memory_document_types.tsx`;
  const source = `
import * as React from 'react';
import { JsonDocumentEditor, JsonEditor, DocumentEditor, parseDocumentSource, parseJsonDocument, diffJsonDocument } from './index';
import type { JsonDocumentEditorHandle, JsonDocumentValue, JsonDocumentPatch, DocumentFormat } from './index';
const ref = React.createRef<JsonDocumentEditorHandle>();
const editor = <JsonDocumentEditor value={{ title: 'Hello' }} onChange={value => { const exact: JsonDocumentValue = value; }}
  editorRef={ref} documentKey="one" onSave={async (value, patch, context) => {
    const exact: readonly JsonDocumentPatch[] = patch; const signal: AbortSignal = context.signal;
    const format: DocumentFormat = context.format; const text: string = context.text;
  }} validate={value => ({ checked: true })} validateEdit={context => context.kind === 'remove' ? 'Required' : null} />;
// @ts-expect-error Saved must follow an accepted-write promise, never a synchronous fake success.
const invalid = <JsonDocumentEditor value={null} onChange={() => {}} onSave={() => {}} />;
const original = <JsonEditor value={{}} onChange={() => {}} />;
const file = <DocumentEditor format="yaml" sourceText="# a comment\\nname: Zero\\n" onSourceChange={source => { const text: string = source.text; }} />;
const env = parseDocumentSource('PORT=8080', 'env');
ref.current?.setFormat('toml');
const parse = parseJsonDocument('{"a":1}');
const diff = diffJsonDocument({}, { a: 1 });
`;
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'], esModuleInterop: true };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, createNew) => file === fixture
    ? ts.createSourceFile(file, source, version, true, ts.ScriptKind.TSX) : read(file, version, onError, createNew);
  const program = ts.createProgram([fixture], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic =>
    `${diagnostic.file?.fileName ?? 'compiler'} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)).toEqual([]);
}, 60_000);
