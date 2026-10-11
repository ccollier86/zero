/** Strict in-memory native contracts for the additive menu viewport; no emitted files or application setup. */
import { expect, test } from 'bun:test';
import ts from 'typescript';

test('Arc menu options and explicit viewport retain genuine native events, refs and Radix placement contracts', () => {
  const fixture = `${import.meta.dir}/__in_memory_context_menu_scroll_types.tsx`;
  const source = `
import * as React from 'react';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuSub, ContextMenuSubTrigger,
  ContextMenuSubContent, ContextMenuViewport, ContextMenuItem,
  type ContextMenuContentProps, type ContextMenuSubContentProps, type ContextMenuViewportProps } from './index';
const outer = React.createRef<HTMLDivElement>(), viewport = React.createRef<HTMLDivElement>();
const callback: React.RefCallback<HTMLDivElement> = node => { if (node) return () => { void node.tagName; }; };
const nativeEvents: ContextMenuViewportProps = {
  ref: callback, orientation: 'both', fadeEdges: false, scrollbars: 'always',
  onScroll: event => { const exact: HTMLDivElement = event.currentTarget; void exact.scrollTop; },
  onAnimationStart: event => { const exact: string = event.animationName; void exact; },
  onDragStart: event => { const exact: DataTransfer = event.dataTransfer; void exact; },
};
const rootProps: ContextMenuContentProps = { ref: outer, viewportRef: viewport, viewportClassName: 'menu-list',
  viewportStyle: { maxHeight: 160 }, scrollTreatment: 'arc', orientation: 'horizontal', scrollbars: 'scroll',
  onCloseAutoFocus: event => event.preventDefault(), onAnimationStart: event => { void event.animationName; },
  onDragStart: event => { void event.dataTransfer; }, collisionPadding: 12, portal: false, forceMount: true };
const subProps: ContextMenuSubContentProps = { ref: outer, viewportRef: callback, scrollTreatment: 'native',
  sideOffset: 8, alignOffset: -4, orientation: 'vertical', fadeEdges: true, scrollbars: 'hidden' };
const menu = <ContextMenu><ContextMenuTrigger>Record</ContextMenuTrigger><ContextMenuContent {...rootProps}>
  <ContextMenuItem>Open</ContextMenuItem><ContextMenuSub open><ContextMenuSubTrigger>More</ContextMenuSubTrigger>
    <ContextMenuSubContent {...subProps}><ContextMenuItem>Export</ContextMenuItem></ContextMenuSubContent>
  </ContextMenuSub></ContextMenuContent></ContextMenu>;
const custom = <ContextMenuContent asChild ref={outer}><section><header>Fixed</header>
  <ContextMenuViewport {...nativeEvents} ref={viewport}><ContextMenuItem>Open</ContextMenuItem></ContextMenuViewport>
</section></ContextMenuContent>;
// @ts-expect-error A viewport ref remains the native DIV rather than another element contract.
const wrongRef = <ContextMenuViewport ref={React.createRef<HTMLButtonElement>()} />;
// @ts-expect-error Unknown presentation recipes are not admitted.
const wrongTreatment = <ContextMenuContent scrollTreatment="legacy-ish" />;
// @ts-expect-error Native pointer-anchored content does not invent a root side prop.
const wrongPlacement = <ContextMenuContent side="bottom" />;
// @ts-expect-error Scrollbar policy uses the shared finite choices.
const wrongScrollbar = <ContextMenuViewport scrollbars="auto" />;
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
