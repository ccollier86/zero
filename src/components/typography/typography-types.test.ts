/** Compile native tags, attributes, refs and Slot children without emitting files. */

import { expect, test } from 'bun:test';
import ts from 'typescript';

const contract = `
import * as React from 'react';
import { Text, Heading, type TextProps, type HeadingProps } from './index';
const paragraphRef = React.createRef<HTMLParagraphElement>();
const labelRef = React.createRef<HTMLLabelElement>();
const headingRef = React.createRef<HTMLHeadingElement>();
const inputRef = React.createRef<HTMLInputElement>();
const paragraph = <Text as="p" variant="body" ref={paragraphRef} onClick={event => { const element: HTMLParagraphElement = event.currentTarget; }} />;
const label = <Text as="label" htmlFor="field" ref={labelRef}>Field</Text>;
const heading = <Heading as="h1" variant="section" ref={headingRef} onClick={event => { const element: HTMLHeadingElement = event.currentTarget; }}>Title</Heading>;
const slot = <Text as="label" asChild htmlFor="field" ref={labelRef}><label>Field</label></Text>;
const nativeProps: TextProps<'label'> = { htmlFor: 'field', ref: labelRef, variant: 'label' };
const outlineProps: HeadingProps<'h4'> = { variant: 'page', ref: headingRef, 'aria-describedby': 'help' };
const nativeAria = <Text role="status" aria-live="polite">Saved</Text>;
// @ts-expect-error The selected native label ref cannot be an input ref.
const invalidRef = <Text as="label" ref={inputRef} />;
// @ts-expect-error Heading refs preserve the native heading element type.
const invalidHeadingRef = <Heading ref={labelRef} />;
// @ts-expect-error label association is not a native span attribute.
const invalidSpan = <Text htmlFor="field" />;
// @ts-expect-error Unsupported interactive native tags use existing control primitives.
const invalidTag = <Text as="button" />;
// @ts-expect-error Heading's native as is a heading level, not visual div markup.
const invalidHeading = <Heading as="div" />;
// @ts-expect-error Unknown typography recipes do not silently invent a new size.
const invalidVariant = <Text variant="tiny-custom-size" />;
// @ts-expect-error Slot requires a single React element, not an ordinary string.
const invalidSlot = <Text asChild>Plain text</Text>;
// @ts-expect-error Slot requires its semantic child.
const missingChild = <Heading asChild />;
// @ts-expect-error Slot cannot wrap two sibling elements.
const multipleChildren = <Text asChild><span>A</span><span>B</span></Text>;
`;

test('typography native element/ref and asChild contracts compile', () => {
  const fixture = `${import.meta.dir}/__in_memory_typography_contract.tsx`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['bun'],
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, version, onError, createNew) => filename === fixture
    ? ts.createSourceFile(fixture, contract, version, true, ts.ScriptKind.TSX)
    : read(filename, version, onError, createNew);
  const program = ts.createProgram([fixture], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined;
    return `TS${diagnostic.code}${line ? `:${line}` : ''} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  expect(diagnostics).toEqual([]);
}, 30_000);
