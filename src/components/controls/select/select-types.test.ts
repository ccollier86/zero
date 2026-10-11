/** Strict native Select composition/ref types in memory; no app, DOM or emitted build output. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

test('Select trigger source registration keeps exact native ref and Root props', () => {
  const fixture = `${import.meta.dir}/__in_memory_select_types.tsx`;
  const source = `
import * as React from 'react';
import {Select, SelectTrigger, SelectContent, SelectItem, SelectValue} from './select';
const trigger = React.createRef<HTMLButtonElement>();
const content = React.createRef<HTMLDivElement>();
const form = <Select name="category" defaultValue="one" onValueChange={value => { const exact: string = value; }}>
  <SelectTrigger ref={trigger} aria-label="Category"><SelectValue /></SelectTrigger>
  <SelectContent ref={content} viewportRef={content} position="popper" fadeEdges={false} scrollbars="always">
    <SelectItem value="one" ref={content} leading={<span />} description="Description" trailing="Metadata" textValue="One">One</SelectItem>
  </SelectContent>
</Select>;
// @ts-expect-error Native trigger ref cannot become an input ref.
const invalid = <SelectTrigger ref={React.createRef<HTMLInputElement>()} />;
const scrollOnly = <SelectContent scrollbars="scroll"><SelectItem value="one">One</SelectItem></SelectContent>;
`;
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, types: ['bun'] };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, createNew) => file === fixture
    ? ts.createSourceFile(file, source, version, true, ts.ScriptKind.TSX) : read(file, version, onError, createNew);
  const program = ts.createProgram([fixture], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic =>
    `${diagnostic.file?.fileName ?? 'compiler'} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)).toEqual([]);
}, 30_000);
