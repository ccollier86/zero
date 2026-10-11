/** Bounded path-based tree/search presentation. No DOM, editing authority or persistence. */
import { JSON_DOCUMENT_LIMITS, jsonContainer, jsonPathKey, readJsonPath } from './json-document-model';
import type { JsonDocumentPath, JsonDocumentValue } from './json-document.types';

export interface JsonTreeRow { readonly path: JsonDocumentPath; readonly value: JsonDocumentValue; readonly key: string | number;
  readonly level: number; readonly position: number; readonly siblings: number; readonly parentArray: boolean; readonly more?: number }
const keysOf = (value: JsonDocumentValue): Array<string | number> => jsonContainer(value) ? Array.isArray(value) ? value.map((_, index) => index) : Object.keys(value) : [];
export function initialJsonExpansion(value: JsonDocumentValue, depth: number): Set<string> {
  const open = new Set<string>();
  const walk = (value: JsonDocumentValue, path: JsonDocumentPath) => {
    if (!jsonContainer(value) || path.length >= depth) return;
    open.add(jsonPathKey(path)); for (const key of keysOf(value)) walk(readJsonPath(value, [key]), [...path, key]);
  };
  walk(value, []); return open;
}
/** Paging and a total row budget bound DOM size even when every branch is expanded. */
export function buildJsonTree(value: JsonDocumentValue, rootName: string, open: ReadonlySet<string>, pages: ReadonlyMap<string, number>, pageSize: number): JsonTreeRow[] {
  const rows: JsonTreeRow[] = [];
  function walk(value: JsonDocumentValue, path: JsonDocumentPath, key: string | number, position: number, siblings: number, parentArray: boolean) {
    if (rows.length >= JSON_DOCUMENT_LIMITS.visibleRows) return;
    rows.push({ value, path, key, level: path.length, position, siblings, parentArray });
    if (!jsonContainer(value) || !open.has(jsonPathKey(path))) return;
    const keys = keysOf(value), shown = Math.min(keys.length, pages.get(jsonPathKey(path)) ?? pageSize);
    for (let index = 0; index < shown && rows.length < JSON_DOCUMENT_LIMITS.visibleRows; index++) {
      const key = keys[index]!; walk(readJsonPath(value, [key]), [...path, key], key, index + 1, keys.length, Array.isArray(value));
    }
    if (shown < keys.length && rows.length < JSON_DOCUMENT_LIMITS.visibleRows) rows.push({ value, path, key: '', level: path.length + 1, position: shown + 1, siblings: keys.length, parentArray: Array.isArray(value), more: keys.length - shown });
  }
  walk(value, [], rootName, 1, 1, false); return rows;
}
export function searchJsonTree(value: JsonDocumentValue, query: string): JsonDocumentPath[] {
  const matches: JsonDocumentPath[] = [], needle = query.trim().toLocaleLowerCase(); if (!needle) return matches;
  function walk(value: JsonDocumentValue, path: JsonDocumentPath) {
    const key = path.at(-1);
    if (typeof key === 'string' && key.toLocaleLowerCase().includes(needle) || !jsonContainer(value) && String(value).toLocaleLowerCase().includes(needle)) matches.push(path);
    for (const key of keysOf(value)) walk(readJsonPath(value, [key]), [...path, key]);
  }
  walk(value, []); return matches;
}
export function revealJsonPath(value: JsonDocumentValue, path: JsonDocumentPath, open: Set<string>, pages: Map<string, number>, pageSize: number) {
  for (let index = 0; index < path.length; index++) {
    const parent = path.slice(0, index), container = readJsonPath(value, parent), keys = keysOf(container), position = keys.indexOf(path[index]!);
    if (position < 0) return;
    const key = jsonPathKey(parent); open.add(key); pages.set(key, Math.max(pages.get(key) ?? pageSize, Math.ceil((position + 1) / pageSize) * pageSize));
  }
}
export function jsonPreview(value: JsonDocumentValue): string {
  if (!jsonContainer(value)) return typeof value === 'string' ? JSON.stringify(value) : String(value);
  return Array.isArray(value) ? (value.length ? `[ ${value.slice(0, 6).map(child => jsonContainer(child) ? Array.isArray(child) ? '[…]' : '{…}' : JSON.stringify(child)).join(', ')}${value.length > 6 ? ', …' : ''} ]` : '[]')
    : `{ ${Object.keys(value).slice(0, 10).join(', ')}${Object.keys(value).length > 10 ? ', …' : ''} }`;
}
