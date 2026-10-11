'use client';

/** JSON row/source parts compose existing Zero controls and Tooltip. Own local rendering only, never a second overlay manager or writer. */
import * as React from 'react';
import { ChevronRight, Copy, Plus, Trash2, Check } from 'lucide-react';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '../tooltip';
import { ScrollViewportAttachment } from '../_internal/scroll-viewport/scroll-viewport-attachment';
import { jsonContainer, jsonDisplayPath, jsonPathKey, jsonPointer } from './json-document-model';
import { jsonPreview, type JsonTreeRow } from './json-document-tree-model';
import { DOCUMENT_FORMAT_LABELS, parseDocumentSource, tokenizeDocumentSource } from './document-source';
import { sourceInputEdit } from './document-source-input';
import type { DocumentFormat } from './document.types';
import type { JsonDocumentSession, JsonInlineDraft, JsonInlineType } from './json-document-session';
import type { JsonDocumentPath } from './json-document.types';

export function JsonDocumentTool({ label, children, ...props }: React.ComponentPropsWithoutRef<'button'> & { label: string }) {
  return <Tooltip><TooltipTrigger asChild><button {...props} type="button" className={['zero-json-tool', props.className].filter(Boolean).join(' ')} aria-label={label}>{children}</button></TooltipTrigger>
    <TooltipContent>{label}</TooltipContent></Tooltip>;
}

/** Highlight only matches; all user text remains React text, including hostile HTML and quote characters. */
function Mark({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLocaleLowerCase(); if (!needle) return text;
  const lower = text.toLocaleLowerCase(), parts: React.ReactNode[] = []; let start = 0, index: number;
  while (parts.length < 200 && (index = lower.indexOf(needle, start)) >= 0) { parts.push(text.slice(start, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>); start = index + needle.length; }
  parts.push(text.slice(start)); return parts;
}

export function JsonDocumentInline({ edit, session, label, errorId, disabled, afterCommit }: { edit: JsonInlineDraft; session: JsonDocumentSession;
  label: string; errorId: string; disabled: boolean; afterCommit: (step?: 1 | -1) => void }) {
  const input = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, [jsonPathKey(edit.path), edit.kind]);
  const keyboard = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); session.cancel(); afterCommit(); }
    else if (event.key === 'Enter' && !event.shiftKey || event.key === 'Tab') {
      if (!session.finishInline()) { event.preventDefault(); return; }
      if (session.getSnapshot().edit) { event.preventDefault(); return; }
      event.preventDefault(); afterCommit(event.key === 'Tab' ? event.shiftKey ? -1 : 1 : undefined);
    }
  };
  const shared = { value: edit.text, disabled, spellCheck: false, 'aria-label': label, 'aria-describedby': errorId, 'data-zero-document-escape': '',
    'aria-invalid': session.getSnapshot().error ? true as const : undefined, className: 'zero-json-inline-input', onKeyDown: keyboard,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => session.changeInline(event.target.value) };
  const string = edit.kind === 'value' && edit.type === 'string';
  const format = session.getSnapshot().format, types = format === 'env' ? ['string'] : format === 'toml' ? ['auto', 'string', 'number', 'boolean', 'object', 'array'] : ['auto', 'string', 'number', 'boolean', 'null', 'object', 'array'];
  return <span className="zero-json-inline" data-string={string || undefined}>
    {string && <span aria-hidden="true" className="zero-json-quote">"</span>}
    {string ? <Textarea {...shared} ref={input as React.Ref<HTMLTextAreaElement>} rows={Math.min(6, edit.text.split('\n').length)} wrap="off" />
      : <Input {...shared} ref={input as React.Ref<HTMLInputElement>} style={{ width: `min(${Math.max(3, edit.text.length + 1)}ch, 100%)` }} />}
    {string && <span aria-hidden="true" className="zero-json-quote">"</span>}
    {edit.kind === 'value' && <Select disabled={disabled} value={edit.type} onValueChange={value => {
      session.changeInline(edit.text, value as JsonInlineType);
      if (['null', 'object', 'array'].includes(value)) { if (session.finishInline()) afterCommit(); }
    }}><SelectTrigger className="zero-json-type" aria-label={`${DOCUMENT_FORMAT_LABELS[format]} value type`}><SelectValue /></SelectTrigger>
      <SelectContent>{types.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select>}
  </span>;
}

export function JsonDocumentRow({ row, active, expanded, changed, descendantChanged, currentMatch, comment, native, query, edit, session, rootName, disabled, errorId, afterCommit, onAction, onSelect, onToggle, onKeyDown, onHot, rowRef, copy }:
  { row: JsonTreeRow; active: boolean; expanded: boolean; changed: boolean; descendantChanged: boolean; currentMatch: boolean; query: string;
    edit: JsonInlineDraft | null; session: JsonDocumentSession; rootName: string; disabled: boolean; errorId: string; comment?: string; native?: string;
    afterCommit: (step?: 1 | -1) => void; onAction: (kind: 'rename' | 'edit' | 'add' | 'remove') => void;
    onSelect: () => void; onToggle: () => void; onKeyDown: React.KeyboardEventHandler<HTMLDivElement>; onHot: () => void;
    rowRef: (element: HTMLDivElement | null) => void; copy: (path: JsonDocumentPath, kind: 'value' | 'path') => void }) {
  const container = jsonContainer(row.value), type = row.value === null ? 'null' : Array.isArray(row.value) ? 'array' : typeof row.value;
  const key = String(row.key), count = container ? Array.isArray(row.value) ? row.value.length : Object.keys(row.value).length : 0;
  const path = jsonDisplayPath(rootName, row.path), keyEdit = edit?.kind === 'key';
  return <div ref={rowRef} className="zero-json-row" role="treeitem" tabIndex={active && !edit ? 0 : -1}
    aria-level={row.level + 1} aria-posinset={row.position} aria-setsize={row.siblings} aria-selected={active}
    aria-expanded={container && !row.more ? expanded : undefined} aria-label={row.more ? `Show ${row.more} more entries` : `${path}, ${type}`}
    data-path={jsonPointer(row.path)} data-active={active || undefined} data-editing={!!edit || undefined} data-current={currentMatch || undefined}
    data-json-row={jsonPathKey(row.path) + (row.more ? ':more' : '')}
    style={{ '--zero-json-level': row.level } as React.CSSProperties} onFocus={event => { if (event.target === event.currentTarget) { onSelect(); onHot(); } }}
    onPointerEnter={event => { if (event.pointerType !== 'touch') onHot(); }} onKeyDown={onKeyDown}
    onClick={event => { if ((event.target as Element).closest('button,input,textarea,[role="combobox"]')) return; onSelect(); if (container || row.more) onToggle(); }}>
    <div className="zero-json-line">
      <span className="zero-json-mod" data-changed={changed || undefined} data-inside={descendantChanged || undefined} aria-hidden="true" />
      <span className="zero-json-chevron" aria-hidden="true">{container && !row.more && <ChevronRight />}</span>
      {row.more ? <><span className="zero-json-more">Show more</span><span className="zero-json-count">{row.more.toLocaleString()} hidden</span></>
        : <>{keyEdit ? <JsonDocumentInline edit={edit!} session={session} label={`Rename ${path}`} errorId={errorId} disabled={disabled} afterCommit={afterCommit} />
          : <><span className={row.parentArray ? 'zero-json-index' : 'zero-json-key'} data-root={!row.path.length || undefined}
              onClick={event => { event.stopPropagation(); onSelect(); }} onDoubleClick={event => { event.stopPropagation(); if (row.path.length && !row.parentArray) onAction('rename'); }}><Mark text={key} query={query} /></span>
            {!!row.path.length && <span className="zero-json-colon">:</span>}</>}
          {edit?.kind === 'value' ? <JsonDocumentInline edit={edit} session={session} label={`Edit ${path}`} errorId={errorId} disabled={disabled} afterCommit={afterCommit} />
            : container ? <span className="zero-json-summary">{!expanded && <span className="zero-json-preview">{jsonPreview(row.value)}</span>}<span className="zero-json-count">{count} {Array.isArray(row.value) ? count === 1 ? 'item' : 'items' : count === 1 ? 'key' : 'keys'}</span></span>
              : <Tooltip overflowOnly><TooltipTrigger asChild><span className="zero-json-value" data-type={type}
                  data-native={native || undefined} onClick={event => { event.stopPropagation(); onSelect(); onAction('edit'); }}><Mark text={typeof row.value === 'string' ? native ? row.value : JSON.stringify(row.value) : String(row.value)} query={query} /></span></TooltipTrigger>
                <TooltipContent className="zero-json-value-tip">{typeof row.value === 'string' ? row.value : String(row.value)}</TooltipContent></Tooltip>}
          {native && <span className="zero-document-native">{native}</span>}
          {comment && <Tooltip><TooltipTrigger asChild><span className="zero-document-comment" tabIndex={active ? 0 : -1} aria-label={`Comment for ${path}`}># {comment.split('\n')[0]}</span></TooltipTrigger><TooltipContent className="zero-json-value-tip">{comment}</TooltipContent></Tooltip>}
        </>}
    </div>
    {!row.more && !edit && <div className="zero-json-actions">
      <JsonDocumentTool label={`Copy ${path} value`} tabIndex={active ? 0 : -1} onClick={() => copy(row.path, 'value')}><Copy /></JsonDocumentTool>
      <JsonDocumentTool label={`Copy ${path} path`} tabIndex={active ? 0 : -1} onClick={() => copy(row.path, 'path')}><span aria-hidden="true">/</span></JsonDocumentTool>
      <JsonDocumentTool label={`Add entry at ${path}`} disabled={disabled} tabIndex={active ? 0 : -1} onClick={() => onAction('add')}><Plus /></JsonDocumentTool>
      {!!row.path.length && <JsonDocumentTool label={`Remove ${path}`} disabled={disabled} tabIndex={active ? 0 : -1} onClick={() => onAction('remove')}><Trash2 /></JsonDocumentTool>}
    </div>}
  </div>;
}

/** Highlighted JSON-specific textarea; one native viewport owns both axes and is decorated by the shared scroll effect. */
export function JsonDocumentSource({ source, format, label, disabled, arc, bounded, maxHeight, onChange, onCancel, onSave, errorId }:
  { source: string; format: DocumentFormat; label: string; disabled: boolean; arc: boolean; bounded: boolean; maxHeight: number; onChange: (source: string) => void;
    onCancel: () => void; onSave: () => void; errorId: string }) {
  const tokens = React.useMemo(() => tokenizeDocumentSource(source, format), [source, format]), parsed = React.useMemo(() => parseDocumentSource(source, format), [source, format]);
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null), input = React.useRef<HTMLTextAreaElement>(null), escaped = React.useRef(false);
  const [caret, setCaret] = React.useState({ line: 1, column: 1 });
  const lines = source.split('\n').length;
  const caretInfo = () => { const element = input.current; if (!element) return; const before = element.value.slice(0, element.selectionEnd);
    setCaret({ line: before.split('\n').length, column: before.length - before.lastIndexOf('\n') }); };
  const insert = (element: HTMLTextAreaElement, edit: ReturnType<typeof sourceInputEdit>) => {
    if (!edit) return;
    const next = element.value.slice(0, edit.start) + edit.text + element.value.slice(edit.end);
    element.setSelectionRange(edit.start, edit.end);
    if (next !== element.value) {
      // Where supported, native insertText participates in the textarea's Undo
      // stack. Browsers without it use the same admitted, controlled fallback.
      let native = false;
      try { native = typeof element.ownerDocument.execCommand === 'function' && element.ownerDocument.execCommand('insertText', false, edit.text); } catch { /* Unsupported editing capability; use controlled insertion. */ }
      if (!native) onChange(next);
    }
    requestAnimationFrame(() => { if (element.isConnected) { element.setSelectionRange(edit.anchor, edit.focus); caretInfo(); } });
  };
  return <><div className="zero-json-source-shell"><div ref={setViewport} className="zero-json-source-scroll" data-native={arc ? undefined : true}
      style={{ maxHeight: bounded ? maxHeight : undefined, overflow: bounded ? 'auto' : 'visible' }}>
      <div className="zero-json-source-grid"><pre className="zero-json-gutter" aria-hidden="true">{Array.from({ length: lines }, (_, index) => String(index + 1)).join('\n')}</pre>
        <div className="zero-json-source-area">
          {!parsed.ok && <div className="zero-json-error-line" aria-hidden="true" style={{ top: `${10 + (parsed.line - 1) * 20}px` }} />}
          {!parsed.ok && <div className="zero-document-squiggle" aria-hidden="true" style={{ top: `${26 + (parsed.line - 1) * 20}px`, left: `calc(6px + ${parsed.column - 1}ch)`, width: `${Math.max(1, Math.min(40, parsed.length))}ch` }} />}
          <pre aria-hidden="true" className="zero-json-source-pre">{tokens.map((token, index) => <span key={index} data-token={token.kind}>{token.text}</span>)}{'\n '}</pre>
          <Textarea ref={input} className="zero-json-source-input" value={source} disabled={disabled} spellCheck={false} wrap="off" data-zero-document-escape=""
            aria-label={`${label} source`} aria-describedby={errorId} aria-invalid={!parsed.ok || undefined}
            onChange={event => { onChange(event.target.value); caretInfo(); }} onSelect={caretInfo}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              const element = event.currentTarget, mod = event.metaKey || event.ctrlKey;
              if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); onSave(); return; }
              if (event.key === 'Escape') { event.stopPropagation(); escaped.current = true; return; }
              if (event.key === 'Tab' && escaped.current) { escaped.current = false; return; }
              escaped.current = false;
              if (mod && event.key.toLowerCase() === 'r') { event.preventDefault(); onCancel(); return; }
              if (mod || event.altKey) return;
              const edit = sourceInputEdit(element.value, element.selectionStart, element.selectionEnd, event.key, event.shiftKey, format);
              if (edit) { event.preventDefault(); insert(element, edit); }
            }} />
        </div></div>
    </div>{arc && bounded && <ScrollViewportAttachment viewport={viewport} />}</div>
    <div className="zero-json-code-status" role="status"><span>{parsed.ok ? <><Check aria-hidden="true" />Valid {DOCUMENT_FORMAT_LABELS[format]} · {lines} {lines === 1 ? 'line' : 'lines'}</>
      : <><span className="zero-json-invalid">{parsed.message} Ln {parsed.line}, Col {parsed.column}</span><button type="button" className="zero-document-jump" onClick={() => {
        const element = input.current; if (!element) return; element.focus({ preventScroll: true }); element.setSelectionRange(parsed.offset, Math.min(source.length, parsed.offset + Math.min(40, parsed.length))); caretInfo();
        const parent = viewport; if (parent) { parent.scrollTop = Math.max(0, (parsed.line - 2) * 20); parent.scrollLeft = Math.max(0, (parsed.column - 4) * 8); }
      }}>Jump</button>{format === 'yaml' && /^.*\t/mu.test(source) && <button type="button" className="zero-document-jump" disabled={disabled} onClick={() => onChange(source.replace(/^[ \t]+/gmu, whitespace => whitespace.replace(/\t/gu, '  ')))}>Use spaces</button>}</>}</span><span>Ln {caret.line}, Col {caret.column}</span></div></>;
}
