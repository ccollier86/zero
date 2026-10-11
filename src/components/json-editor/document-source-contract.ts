/** Internal bounded codec contract and text-splice helpers. No filesystem, network, HTML or environment access. */
import { JSON_DOCUMENT_LIMITS, jsonPointer } from './json-document-model';
import type { JsonDocumentPath, JsonDocumentValue } from './json-document.types';
import type { DocumentFormat, DocumentParseResult } from './document.types';

export interface SourceDocument {
  readonly format: DocumentFormat;
  readonly text: string;
  readonly value: JsonDocumentValue;
  readonly comments: ReadonlyMap<string, string>;
  /** Native scalars projected as text must remain native, not silently become quoted strings. */
  readonly native: ReadonlyMap<string, string>;
  readonly model?: unknown;
}
export class DocumentSourceError extends Error {
  constructor(message: string, readonly offset = 0, readonly length = 1) { super(message); }
}
export function sourceFault(source: string, error: unknown): Exclude<DocumentParseResult, { ok: true }> {
  const fault = error instanceof DocumentSourceError ? error : new DocumentSourceError('The document could not be represented safely.');
  if (typeof source !== 'string') return { ok: false, message: 'Document source must be text.', offset: 0, line: 1, column: 1, length: 1 };
  const offset = Math.max(0, Math.min(source.length, fault.offset)), before = source.slice(0, offset);
  return { ok: false, message: fault.message.slice(0, 2_048), offset, length: Math.max(1, fault.length), line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
}
export function boundSource(text: string) {
  if (typeof text !== 'string' || text.length > JSON_DOCUMENT_LIMITS.characters) throw new DocumentSourceError('Document source exceeds the text limit.');
}
export function putSourceValue(object: Record<string | number, JsonDocumentValue>, key: string | number, value: JsonDocumentValue) {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
}
export function pointerPath(pointer: string, document: JsonDocumentValue): JsonDocumentPath {
  const path: (string | number)[] = []; let current = document;
  if (!pointer) return path;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/gu, '/').replace(/~0/gu, '~'), index = Array.isArray(current) ? Number(key) : key;
    path.push(index); current = current && typeof current === 'object' ? (current as Record<string | number, JsonDocumentValue>)[index]! : null;
  }
  return path;
}
export interface SourceSplice { readonly start: number; readonly end: number; readonly text: string }
/** Apply disjoint ranges from the original source only; overlapping edits are rejected, never guessed. */
export function spliceSource(source: string, edits: readonly SourceSplice[]) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end), parts: string[] = []; let cursor = 0, length = source.length;
  for (const edit of sorted) {
    if (edit.start < cursor || edit.end < edit.start || edit.end > source.length) throw new DocumentSourceError('This structural edit needs Code view to preserve the file layout.');
    length += edit.text.length - (edit.end - edit.start);
    if (length > JSON_DOCUMENT_LIMITS.characters) throw new DocumentSourceError('Document source exceeds the text limit.');
    parts.push(source.slice(cursor, edit.start), edit.text); cursor = edit.end;
  }
  parts.push(source.slice(cursor)); return parts.join('');
}
export const sourceComment = (comments: Map<string, string>, path: JsonDocumentPath, text: string | undefined | null) => {
  if (text?.trim()) comments.set(jsonPointer(path), text.trim());
};
