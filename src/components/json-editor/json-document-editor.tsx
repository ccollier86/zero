'use client';

/**
 * Additive JSON Tree/Code organism. Composes the local session, pure tree model,
 * existing Zero controls/Tooltip and the shared scroll decoration. No database,
 * subscription, endpoint, application shell or global overlay ownership lives here.
 */
import * as React from 'react';
import { Braces, Code2, Search, X, Undo2, Redo2, ChevronsUpDown, ChevronsDownUp, Copy, AlignLeft, Check, LoaderCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { TooltipProvider } from '../tooltip';
import { ScrollViewportAttachment } from '../_internal/scroll-viewport/scroll-viewport-attachment';
import { cn } from '../../lib/utils';
import { JsonDocumentSession } from './json-document-session';
import { buildJsonTree, initialJsonExpansion, revealJsonPath, searchJsonTree, type JsonTreeRow } from './json-document-tree-model';
import { JsonDocumentRow, JsonDocumentSource, JsonDocumentTool } from './json-document-parts';
import { diffJsonDocument, jsonContainer, jsonDisplayPath, jsonPathKey, jsonPointer, readJsonPath, JSON_DOCUMENT_LIMITS } from './json-document-model';
import { DOCUMENT_FORMAT_LABELS, formatDocumentSource, documentNeedsExactNumbers } from './document-source';
import { DocumentFormatControl } from './document-format-control';
import type { DocumentEditorProps } from './document.types';
import { useJsonDocumentMotion } from './use-json-document-motion';
import { useDocumentEscapeBoundary } from './use-document-escape-boundary';
import type { JsonDocumentEditorProps, JsonDocumentMode, JsonDocumentPath } from './json-document.types';
import './json-document-editor.css';

/** Document identity owns the entire session, including retained edits, undo and pending-save feedback. */
export function JsonDocumentEditor(props: JsonDocumentEditorProps) {
  return <JsonDocumentEditorInstance key={props.documentKey ?? 'json-document'} {...props} />;
}
/** Shared Tree/Code editor for supplied JSON, YAML, TOML or literal .env text. No transport or environment ownership. */
export function DocumentEditor(props: DocumentEditorProps) {
  return <JsonDocumentEditorInstance key={props.documentKey ?? 'source-document'} {...props} />;
}

const ignoreLocalChange = () => {};
function JsonDocumentEditorInstance({ value, onChange = ignoreLocalChange, sourceText, format: sourceFormat = 'json', onSourceChange, documentKey: _documentKey, label = 'Document', rootName = 'root', disabled = false,
  defaultMode = 'tree', defaultExpandDepth = 1, pageSize = 50, maxHeight = 420, density = 'default', scrollMode = 'self', scrollTreatment = 'arc',
  className, style, validate, validateEdit, onSave, rawTextDraft, onRawTextDraftChange, onEditingChange, editorRef }: DocumentEditorProps) {
  if (!Number.isInteger(defaultExpandDepth) || defaultExpandDepth < 0 || defaultExpandDepth > JSON_DOCUMENT_LIMITS.depth) throw new RangeError('JSON expansion depth must be an integer from 0 to 64.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new RangeError('JSON page size must be an integer from 1 to 500.');
  if (!Number.isFinite(maxHeight) || maxHeight < 80 || maxHeight > 10_000) throw new RangeError('JSON maxHeight must be between 80 and 10000 pixels.');
  const [session] = React.useState(() => new JsonDocumentSession(value, { onChange, validate, validateEdit, onSave, disabled, onRawTextDraftChange, onEditingChange, onSourceChange }, rawTextDraft ?? null, { format: sourceFormat, text: sourceText }));
  const snapshot = React.useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  React.useLayoutEffect(() => { session.updateOptions({ onChange, validate, validateEdit, onSave, disabled, onRawTextDraftChange, onEditingChange, onSourceChange }); });
  React.useLayoutEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  React.useLayoutEffect(() => { if (sourceText !== undefined) session.receiveSource(sourceFormat, sourceText); else session.setFormat(sourceFormat); }, [session, sourceFormat, sourceText]);
  React.useLayoutEffect(() => { if (value !== undefined) session.receive(value); }, [session, value]);
  React.useLayoutEffect(() => { if (rawTextDraft !== undefined) session.receiveRaw(rawTextDraft); }, [session, rawTextDraft]);
  const [mode, setMode] = React.useState<JsonDocumentMode>(session.getSnapshot().raw != null || documentNeedsExactNumbers(session.document) ? 'code' : defaultMode);
  const [open, setOpen] = React.useState(() => initialJsonExpansion(session.getSnapshot().value, defaultExpandDepth));
  const [pages, setPages] = React.useState(new Map<string, number>());
  const [active, setActive] = React.useState('[]'), [hot, setHot] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState(''), [match, setMatch] = React.useState(0), [copied, setCopied] = React.useState('');
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const root = React.useRef<HTMLDivElement>(null), tree = React.useRef<HTMLDivElement>(null), highlight = React.useRef<HTMLDivElement>(null), search = React.useRef<HTMLInputElement>(null);
  useDocumentEscapeBoundary(root);
  const alive = React.useRef(true);
  const rowElements = React.useRef(new Map<string, HTMLDivElement>()), focusNext = React.useRef(false), copyGeneration = React.useRef(0);
  const id = React.useId(), errorId = id + '-error', treeId = id + '-tree', codeId = id + '-code';
  const rows = React.useMemo(() => buildJsonTree(snapshot.value, rootName, open, pages, pageSize), [snapshot.value, rootName, open, pages, pageSize]);
  useJsonDocumentMotion(root, tree, rows, mode === 'tree');
  const matches = React.useMemo(() => searchJsonTree(snapshot.value, query), [snapshot.value, query]);
  const patch = React.useMemo(() => diffJsonDocument(snapshot.baseline, snapshot.value), [snapshot.baseline, snapshot.value]);
  const rowId = (row: JsonTreeRow) => jsonPathKey(row.path) + (row.more ? ':more' : '');
  const activeRow = rows.find(row => rowId(row) === active) ?? rows[0]!;
  const activeKey = rowId(activeRow), matchPath = matches[Math.min(match, Math.max(0, matches.length - 1))];
  const markers = React.useMemo(() => {
    const direct = new Set<string>(), ancestors = new Set<string>();
    for (const op of patch) {
      if (op.op !== 'remove') direct.add(op.path);
      for (const path of op.op === 'move' ? [op.path, op.from] : [op.path]) {
        let end = path.lastIndexOf('/'); while (end >= 0) { ancestors.add(path.slice(0, end)); if (end === 0) break; end = path.lastIndexOf('/', end - 1); }
      }
    }
    return { direct, ancestors };
  }, [patch]);
  const arc = scrollTreatment === 'arc', bounded = scrollMode === 'self';
  const document = React.useMemo(() => session.document, [session, snapshot.format, snapshot.text]);
  const codeError = snapshot.raw !== null && !snapshot.draftValid;
  const dirty = session.dirty;
  const notice = snapshot.saving || snapshot.saved || snapshot.conflict || /^(Snapshot saved|Save failed|Save interrupted)/u.test(snapshot.notice)
    ? snapshot.notice : snapshot.edit ? 'Unfinished local edit.' : snapshot.raw !== null ? 'Uncommitted Code draft.'
      : snapshot.format !== snapshot.baselineFormat ? `Converted to ${DOCUMENT_FORMAT_LABELS[snapshot.format]}.` : !patch.length && snapshot.text !== snapshot.baselineText ? 'Comments or spacing changed.' : `${patch.length} local ${patch.length === 1 ? 'change' : 'changes'}`;

  React.useLayoutEffect(() => {
    const element = hot ? rowElements.current.get(hot) : null;
    if (highlight.current) { highlight.current.style.opacity = element ? '1' : '0'; if (element) { highlight.current.style.transform = `translateY(${element.offsetTop + 1}px)`; highlight.current.style.height = `${element.offsetHeight - 2}px`; } }
    if (focusNext.current && !snapshot.edit) { focusNext.current = false; const element = rowElements.current.get(activeKey);
      element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }, [hot, rows, activeKey, snapshot.edit]);
  React.useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; copyGeneration.current++; }; }, []);

  const reveal = (path: JsonDocumentPath) => {
    if (!alive.current) return;
    const nextOpen = new Set(open), nextPages = new Map(pages);
    try { readJsonPath(snapshot.value, path); revealJsonPath(snapshot.value, path, nextOpen, nextPages, pageSize); }
    catch { return; }
    setOpen(nextOpen); setPages(nextPages); setActive(jsonPathKey(path)); setHot(jsonPathKey(path));
  };
  const changeMode = (next: JsonDocumentMode) => {
    if (!alive.current) return;
    if (snapshot.edit && !session.finishInline() || session.getSnapshot().edit) return;
    if (next === 'tree' || next === 'code') setMode(next);
  };
  const setAll = (expanded: boolean) => {
    if (!alive.current) return;
    if (!session.finishInline() || session.getSnapshot().edit) return;
    setOpen(initialJsonExpansion(snapshot.value, expanded ? JSON_DOCUMENT_LIMITS.depth : 1));
  };
  const select = (path: JsonDocumentPath) => { if (!session.finishInline() || session.getSnapshot().edit) return; reveal(path); focusNext.current = true; };
  const afterCommit = (path: JsonDocumentPath, step?: 1 | -1) => {
    if (session.getSnapshot().edit) return;
    const index = rows.findIndex(row => !row.more && jsonPathKey(row.path) === jsonPathKey(path));
    if (step) for (let next = index + step; next >= 0 && next < rows.length; next += step) {
      const row = rows[next]!; if (row.more || jsonContainer(row.value)) continue;
      setActive(jsonPathKey(row.path)); setHot(jsonPathKey(row.path)); session.begin(row.path, 'value'); return;
    }
    setActive(jsonPathKey(path)); setHot(jsonPathKey(path)); focusNext.current = true;
  };
  const act = (row: JsonTreeRow, kind: 'rename' | 'edit' | 'add' | 'remove') => {
    if (disabled || codeError) return;
    if (kind === 'edit' || kind === 'rename') {
      if (kind === 'edit' && typeof row.value === 'boolean') session.mutate({ kind: 'replace', path: row.path, value: !row.value });
      else if (session.begin(row.path, kind === 'rename' ? 'key' : 'value')) setActive(jsonPathKey(row.path));
      return;
    }
    const path = session.mutate(kind === 'remove' ? { kind, path: row.path }
      : jsonContainer(row.value) ? { kind, path: row.path } : { kind, path: row.path.slice(0, -1), after: row.path.at(-1) });
    if (path && kind === 'add') {
      const nextOpen = new Set(open), nextPages = new Map(pages);
      revealJsonPath(session.getSnapshot().value, path, nextOpen, nextPages, pageSize); setOpen(nextOpen); setPages(nextPages); setActive(jsonPathKey(path));
    }
  };
  const toggle = (row: JsonTreeRow) => {
    if (!session.finishInline() || session.getSnapshot().edit) return;
    const key = jsonPathKey(row.path);
    if (row.more) setPages(current => new Map(current).set(key, (current.get(key) ?? pageSize) + pageSize));
    else setOpen(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };
  const copy = async (path: JsonDocumentPath, kind: 'value' | 'path') => {
    const token = ++copyGeneration.current;
    try {
      const precise = documentNeedsExactNumbers(session.document);
      if (precise && kind === 'value' && path.length) { setCopied('Copy this value from Code to retain exact numeric precision.'); return; }
      const value = readJsonPath(session.getSnapshot().value, path), text = kind === 'path' ? jsonDisplayPath(rootName, path)
        : precise ? session.getSnapshot().text : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      await navigator.clipboard.writeText(text);
      if (token === copyGeneration.current) setCopied(kind === 'path' ? 'Path copied.' : 'Value copied.');
    } catch { if (token === copyGeneration.current) setCopied('Clipboard unavailable.'); }
  };
  const jumpMatch = (next: number) => { if (!matches.length) return; const index = (next + matches.length) % matches.length; setMatch(index); reveal(matches[index]!); focusNext.current = false; };
  const rowKeyboard = (row: JsonTreeRow, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    const index = rows.indexOf(row), mod = event.metaKey || event.ctrlKey;
    const go = (index: number) => { const target = rows[Math.max(0, Math.min(rows.length - 1, index))]; if (!target) return;
      setActive(rowId(target)); setHot(rowId(target)); rowElements.current.get(rowId(target))?.focus({ preventScroll: true }); rowElements.current.get(rowId(target))?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); };
    switch (event.key) {
      case 'ArrowDown': go(index + 1); break;
      case 'ArrowUp': go(index - 1); break;
      case 'Home': go(0); break;
      case 'End': go(rows.length - 1); break;
      case 'ArrowRight': if (jsonContainer(row.value)) open.has(jsonPathKey(row.path)) ? go(index + 1) : toggle(row); break;
      case 'ArrowLeft': if (jsonContainer(row.value) && open.has(jsonPathKey(row.path))) toggle(row); else select(row.path.slice(0, -1)); break;
      case 'Enter': if (event.shiftKey) act(row, 'add'); else if (jsonContainer(row.value) || row.more) toggle(row); else act(row, 'edit'); break;
      case ' ': if (jsonContainer(row.value) || row.more) toggle(row); else if (typeof row.value === 'boolean') act(row, 'edit'); else return; break;
      case 'F2': if (row.path.length && !row.parentArray) act(row, 'rename'); break;
      case 'Delete': case 'Backspace': if (row.path.length) act(row, 'remove'); break;
      case '/': search.current?.focus(); break;
      case 'c': case 'C': if (!mod) return; void copy(row.path, event.shiftKey ? 'path' : 'value'); break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
  };
  React.useImperativeHandle(editorRef, () => ({ commit: () => session.commit(), cancel: () => session.cancel(), startTextEdit: () => { changeMode('code'); },
    setMode: changeMode, setFormat: format => session.setFormat(format), undo: () => session.undo(), redo: () => session.redo(), expandAll: () => setAll(true), collapseAll: () => setAll(false),
    search: query => { if (alive.current) setQuery(query); }, select, save: () => session.save(), discard: () => session.discard(),
    get patch() { return diffJsonDocument(session.getSnapshot().baseline, session.getSnapshot().value); }, get format() { return session.getSnapshot().format; },
    get text() { return session.getSnapshot().raw ?? session.getSnapshot().text; }, get dirty() { return session.dirty; }, get valid() { return session.getSnapshot().draftValid; } }));
  React.useEffect(() => { setMatch(0); if (matches[0]) reveal(matches[0]); }, [query]);
  const format = () => { if (!codeError) { const source = snapshot.raw ?? snapshot.text, next = formatDocumentSource(source, snapshot.format); if (next !== source) session.setRaw(next); } };

  return <TooltipProvider><div ref={root} className={cn('zero-json-document', className)} style={style} data-slot="json-document-editor" data-density={density} data-mode={mode} data-format={snapshot.format}
    role="group" aria-label={label} onKeyDown={event => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void session.save(); }
      else if (!(event.target instanceof Element) || !event.target.closest('input,textarea,[role="combobox"]')) {
        if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? session.redo() : session.undo(); }
        else if (event.key.toLowerCase() === 'y') { event.preventDefault(); session.redo(); }
      }
    }}>
    <header className="zero-json-bar"><div className="zero-json-tabs" role="tablist" aria-label={`${label} view`} onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'tree' : event.key === 'End' ? 'code' : mode === 'tree' ? 'code' : 'tree';
        changeMode(next); root.current?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus(); }
    }}><span className="zero-json-tab-pill" data-mode={mode} aria-hidden="true" />
      {(['tree', 'code'] as const).map(view => <button key={view} type="button" className="zero-json-tab" role="tab" id={`${id}-${view}-tab`}
        data-view={view} aria-selected={mode === view} aria-controls={view === 'tree' ? treeId : codeId} tabIndex={mode === view ? 0 : -1} onClick={() => changeMode(view)}>
        {view === 'tree' ? <Braces aria-hidden="true" /> : <Code2 aria-hidden="true" />}{view === 'tree' ? 'Tree' : 'Code'}{view === 'code' && codeError && <span className="zero-json-tab-error" aria-label="Code contains an error" />}</button>)}</div>
      <div className="zero-json-middle">{mode === 'tree' ? <div className="zero-json-search"><Search aria-hidden="true" /><input ref={search} type="search" value={query} data-zero-document-escape=""
        aria-label="Search keys and values" placeholder="Search keys and values" onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); jumpMatch(match + (event.shiftKey ? -1 : 1)); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); query ? setQuery('') : rowElements.current.get(activeKey)?.focus(); } }} />
        {query && <><span className="zero-json-search-count">{matches.length ? `${Math.min(match + 1, matches.length)} / ${matches.length}` : 'No matches'}</span>
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X aria-hidden="true" /></button></>}</div>
        : <><DocumentFormatControl format={snapshot.format} disabled={disabled || codeError} onChange={format => session.setFormat(format)} />
          <Button size="xs" variant="outline" disabled={disabled || codeError} onClick={format}><AlignLeft aria-hidden="true" />Format</Button>
          {snapshot.raw !== null && <Button size="xs" variant="ghost" disabled={disabled} onClick={() => session.cancel()}>Revert Code</Button>}
          <span className="zero-json-code-hint">{snapshot.format === 'yaml' ? 'Spaces only · Enter continues lists' : snapshot.format === 'env' ? 'Literal KEY=value · No expansion' : snapshot.format === 'toml' ? 'Tables and comments stay put' : 'Tab indents · Esc, then Tab, leaves'}</span></>}</div>
      <span className="zero-json-divider" />
      <JsonDocumentTool label="Undo" disabled={disabled || !snapshot.undoCount} onClick={() => session.undo()}><Undo2 /></JsonDocumentTool>
      <JsonDocumentTool label="Redo" disabled={disabled || !snapshot.redoCount} onClick={() => session.redo()}><Redo2 /></JsonDocumentTool>
      {mode === 'tree' && <><span className="zero-json-divider zero-json-tree-tool" /><JsonDocumentTool className="zero-json-tree-tool" label="Expand all" onClick={() => setAll(true)}><ChevronsUpDown /></JsonDocumentTool>
        <JsonDocumentTool className="zero-json-tree-tool" label="Collapse all" onClick={() => setAll(false)}><ChevronsDownUp /></JsonDocumentTool></>}
    </header>
    <div className="zero-json-body">
      <div role="tabpanel" id={treeId} aria-labelledby={`${id}-tree-tab`} hidden={mode !== 'tree'}>
        {codeError && <div className="zero-json-banner" role="status">The Code draft has an error. The tree shows the last valid version.
          <Button size="xs" variant="outline" onClick={() => setMode('code')}>Go to Code</Button><Button size="xs" variant="outline" disabled={disabled} onClick={() => session.cancel()}>Revert Code</Button></div>}
        <div className="zero-json-tree-shell"><div ref={setViewport} className="zero-json-tree-scroll" data-native={arc ? undefined : true}
          style={{ maxHeight: bounded ? maxHeight : undefined, overflow: bounded ? 'auto' : 'visible' }}>
          <div ref={tree} className="zero-json-tree" role="tree" aria-label={`${label} tree`} onPointerLeave={() => setHot(null)}>
            <div ref={highlight} className="zero-json-highlight" aria-hidden="true" />
            {rows.map(row => {
              const key = rowId(row), path = jsonPointer(row.path);
              const edit = snapshot.edit && jsonPathKey(snapshot.edit.path) === jsonPathKey(row.path) && !row.more ? snapshot.edit : null;
              return <JsonDocumentRow key={key} row={row} rowRef={element => { if (element) rowElements.current.set(key, element); else rowElements.current.delete(key); }}
                active={key === activeKey} expanded={open.has(jsonPathKey(row.path))} query={query} edit={edit} session={session} rootName={rootName} errorId={errorId}
                changed={markers.direct.has(path)} descendantChanged={markers.ancestors.has(path)}
                comment={document.comments.get(path)} native={document.native.get(path)}
                currentMatch={!!matchPath && jsonPathKey(matchPath) === jsonPathKey(row.path)} disabled={disabled || codeError}
                onSelect={() => { if (!snapshot.edit || session.finishInline() && !session.getSnapshot().edit) setActive(key); }}
                onHot={() => setHot(key)} onToggle={() => toggle(row)} onKeyDown={event => rowKeyboard(row, event)} onAction={kind => act(row, kind)} copy={copy}
                afterCommit={step => afterCommit(row.path, step)} />;
            })}
            {rows.length >= JSON_DOCUMENT_LIMITS.visibleRows && <p role="status">Visible row limit reached. Collapse branches or use Code.</p>}
          </div></div>{arc && bounded && mode === 'tree' && <ScrollViewportAttachment viewport={viewport} />}</div>
      </div>
      <div role="tabpanel" id={codeId} aria-labelledby={`${id}-code-tab`} hidden={mode !== 'code'}>
        {mode === 'code' && <JsonDocumentSource source={snapshot.raw ?? snapshot.text} format={snapshot.format} label={label} disabled={disabled}
          arc={arc} bounded={bounded} maxHeight={maxHeight} onChange={text => session.setRaw(text)} onCancel={() => session.cancel()} onSave={() => { void session.save(); }} errorId={errorId} />}
      </div>
    </div>
    <footer className="zero-json-footer">{mode === 'tree' && <div className="zero-json-path-bar"><span className="zero-json-path">{jsonDisplayPath(rootName, activeRow.path)}</span>
      <span className="zero-json-path-type">{activeRow.value === null ? 'null' : Array.isArray(activeRow.value) ? 'array' : typeof activeRow.value}</span>
      <JsonDocumentTool label="Copy selected path" onClick={() => { void copy(activeRow.path, 'path'); }}><Copy /></JsonDocumentTool></div>}
      {snapshot.error && <p id={errorId} role="alert" className="zero-json-invalid">{snapshot.error}</p>}
      {dirty || snapshot.saved || snapshot.conflict ? <div className="zero-json-save" aria-busy={snapshot.saving || undefined}>
        <span className="zero-json-save-dot" data-saved={snapshot.saved || undefined} aria-hidden="true" /><span className="zero-json-save-message" role="status">
          {notice}</span>
        <Button size="xs" variant="ghost" disabled={disabled || snapshot.saving} onClick={() => session.discard()}>Discard</Button>
        {onSave && <Button size="xs" className="zero-json-save-button" disabled={disabled || snapshot.saving || snapshot.saved || snapshot.conflict || codeError}
          onClick={() => { void session.save(); }}>{snapshot.saving ? <LoaderCircle className="zero-json-spinner" aria-hidden="true" /> : snapshot.saved ? <Check aria-hidden="true" /> : null}
          {snapshot.saving ? 'Saving…' : snapshot.saved ? 'Saved' : 'Save'}</Button>}
      </div> : null}
      <span className="zero-json-sr" role="status" aria-live="polite">{copied}</span>
    </footer>
  </div></TooltipProvider>;
}
