/** TOML 1.0 syntax-tree adapter. Range edits preserve untouched text and native scalars; ambiguous structural edits require Code. */
import { parseTOML, ParseError, type AST } from 'toml-eslint-parser';
import { cloneJsonDocument, diffJsonDocument, equalJsonDocument, jsonContainer, JSON_DOCUMENT_LIMITS, jsonOwn, jsonPointer, readJsonPath } from './json-document-model';
import { DocumentSourceError, pointerPath, putSourceValue, sourceComment, spliceSource, type SourceDocument, type SourceSplice } from './document-source-contract';
import type { JsonDocumentPath, JsonDocumentValue } from './json-document.types';

interface TomlModel { readonly ast: AST.TOMLProgram; readonly values: ReadonlyMap<string, AST.TOMLContentNode>; readonly pairs: ReadonlyMap<string, AST.TOMLKeyValue>; readonly tables: ReadonlyMap<string, AST.TOMLTable> }
const nameOf = (key: AST.TOMLKey) => key.keys.map(part => part.type === 'TOMLBare' ? part.name : part.value);
const quoteKey = (key: string) => /^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key);
export function validateTomlValue(value: JsonDocumentValue) {
  if (!jsonContainer(value) || Array.isArray(value)) throw new DocumentSourceError('TOML requires an object at the root.');
  function walk(item: JsonDocumentValue) {
    if (item === null) throw new DocumentSourceError('TOML has no null value. Choose a supported value or another format.');
    if (jsonContainer(item)) Object.values(item).forEach(walk);
    else if (typeof item === 'number' && Number.isInteger(item) && !Number.isSafeInteger(item)) throw new DocumentSourceError('Use Code for exact TOML integers beyond the JavaScript safe range.');
  }
  walk(value);
}
export function encodeTomlValue(value: JsonDocumentValue): string {
  if (value === null) throw new DocumentSourceError('TOML has no null value.');
  if (Array.isArray(value)) return '[' + value.map(encodeTomlValue).join(', ') + ']';
  if (jsonContainer(value)) return '{ ' + Object.entries(value).map(([key, item]) => `${quoteKey(key)} = ${encodeTomlValue(item)}`).join(', ') + ' }';
  if (typeof value === 'string') return JSON.stringify(value).replace(/\\u([0-9a-f]{4})/gu, (_, hex: string) => '\\u' + hex.toUpperCase());
  return String(value);
}

/** Native dates and 64-bit integers have exact textual projections and protected Tree fields; Code preserves their real type. */
export function readTomlDocument(text: string): SourceDocument {
  let ast: AST.TOMLProgram;
  try { ast = parseTOML(text, { tomlVersion: '1.0.0' }); }
  catch (error) { if (error instanceof ParseError) throw new DocumentSourceError(error.message, error.index); throw new DocumentSourceError('TOML exceeds the supported structural limit.'); }
  const value: Record<string, JsonDocumentValue> = {}, comments = new Map<string, string>(), native = new Map<string, string>();
  const values = new Map<string, AST.TOMLContentNode>(), pairs = new Map<string, AST.TOMLKeyValue>(), tables = new Map<string, AST.TOMLTable>(); let count = 0;
  const inlineComments = new Map(ast.comments.map(comment => [comment.loc.start.line, comment]));
  function target(path: JsonDocumentPath): Record<string | number, JsonDocumentValue> {
    let object: Record<string | number, JsonDocumentValue> = value;
    for (let index = 0; index < path.length; index++) {
      const key = path[index]!;
      if (!jsonOwn(object, key)) putSourceValue(object, key, typeof path[index + 1] === 'number' ? [] : {});
      object = object[key] as Record<string | number, JsonDocumentValue>;
    }
    return object;
  }
  function commentsFor(node: AST.TOMLNode, path: JsonDocumentPath) {
    const inline = inlineComments.get(node.loc.end.line), before: string[] = [];
    let low = 0, high = ast.comments.length;
    while (low < high) { const mid = (low + high) >>> 1; if (ast.comments[mid]!.range[1] <= node.range[0]) low = mid + 1; else high = mid; }
    let end = node.range[0];
    for (let index = low - 1; index >= 0; index--) { const comment = ast.comments[index]!;
      if (!/^\s*$/u.test(text.slice(comment.range[1], end))) break;
      before.unshift(comment.value.trim()); end = comment.range[0];
    }
    sourceComment(comments, path, [inline && inline.range[0] >= node.range[1] ? inline.value.trim() : '', ...before].filter(Boolean).join('\n'));
  }
  function content(node: AST.TOMLContentNode, path: JsonDocumentPath, depth: number): JsonDocumentValue {
    if (++count > JSON_DOCUMENT_LIMITS.nodes || depth > JSON_DOCUMENT_LIMITS.depth) throw new DocumentSourceError('TOML exceeds the supported structural limit.', node.range[0]);
    values.set(jsonPointer(path), node);
    if (node.type === 'TOMLArray') return node.elements.map((item, index) => content(item, [...path, index], depth + 1));
    if (node.type === 'TOMLInlineTable') {
      const object: Record<string, JsonDocumentValue> = {};
      for (const pair of node.body) {
        const keys = nameOf(pair.key); let parent = object;
        if (depth + keys.length > JSON_DOCUMENT_LIMITS.depth) throw new DocumentSourceError('TOML exceeds the supported structural limit.', pair.key.range[0]);
        keys.slice(0, -1).forEach(key => { if (!jsonOwn(parent, key)) putSourceValue(parent, key, {}); parent = parent[key] as Record<string, JsonDocumentValue>; });
        const childPath = [...path, ...keys]; pairs.set(jsonPointer(childPath), pair); commentsFor(pair, childPath);
        putSourceValue(parent, keys.at(-1)!, content(pair.value, childPath, depth + keys.length));
      }
      return object;
    }
    if (node.kind === 'integer' && !Number.isSafeInteger(node.value)) { native.set(jsonPointer(path), 'TOML 64-bit integer'); return node.bigint.toString(); }
    if (node.kind.includes('date') || node.kind === 'local-time') { native.set(jsonPointer(path), `TOML ${node.kind}`); return (node as AST.TOMLDateTimeValue).datetime; }
    if (typeof node.value === 'number' && !Number.isFinite(node.value)) throw new DocumentSourceError('Nonfinite TOML values are not supported by the document facade.', node.range[0], node.range[1] - node.range[0]);
    return node.value as string | number | boolean;
  }
  for (const statement of ast.body[0].body) {
    const base = statement.type === 'TOMLTable' ? statement.resolvedKey : [];
    if (base.length > JSON_DOCUMENT_LIMITS.depth) throw new DocumentSourceError('TOML exceeds the supported structural limit.', statement.range[0]);
    if (statement.type === 'TOMLTable') { tables.set(jsonPointer(base), statement); target(base); commentsFor(statement.key, base); }
    for (const pair of statement.type === 'TOMLTable' ? statement.body : [statement]) {
      const keys = nameOf(pair.key), path = [...base, ...keys];
      if (path.length > JSON_DOCUMENT_LIMITS.depth) throw new DocumentSourceError('TOML exceeds the supported structural limit.', pair.key.range[0]);
      pairs.set(jsonPointer(path), pair); commentsFor(pair, path);
      putSourceValue(target(path.slice(0, -1)), path.at(-1)!, content(pair.value, path, path.length));
    }
  }
  return { format: 'toml', text, value: cloneJsonDocument(value), comments, native, model: { ast, values, pairs, tables } satisfies TomlModel };
}

/** Existing scalar edits retain TOML float/integer distinctions and never rewrite untouched tables, dates or comments. */
export function writeTomlDocument(value: JsonDocumentValue, previous?: SourceDocument) {
  validateTomlValue(value);
  if (!previous) return Object.entries(value as Record<string, JsonDocumentValue>).map(([key, item]) => `${quoteKey(key)} = ${encodeTomlValue(item)}\n`).join('');
  const model = previous.model as TomlModel, edits: SourceSplice[] = [];
  const protectedPaths = new Set(previous.native.keys());
  for (const path of previous.native.keys()) { let end = path.lastIndexOf('/'); while (end >= 0) { protectedPaths.add(path.slice(0, end)); if (end === 0) break; end = path.lastIndexOf('/', end - 1); } }
  const hasComments = (start: number, end: number) => {
    let low = 0, high = model.ast.comments.length;
    while (low < high) { const mid = (low + high) >>> 1; if (model.ast.comments[mid]!.range[0] < start) low = mid + 1; else high = mid; }
    return low < model.ast.comments.length && model.ast.comments[low]!.range[1] <= end;
  };
  for (const operation of diffJsonDocument(previous.value, value)) {
    const path = pointerPath(operation.path, value), pair = model.pairs.get(operation.path), node = model.values.get(operation.path);
    if (operation.op === 'replace') {
      if (!node || protectedPaths.has(operation.path) || hasComments(node.range[0], node.range[1])) throw new DocumentSourceError('Edit this TOML structure in Code to preserve native values and comments.');
      let text = encodeTomlValue(operation.value);
      if (node.type === 'TOMLValue' && node.kind === 'float' && typeof operation.value === 'number' && Number.isInteger(operation.value)) text += '.0';
      edits.push({ start: node.range[0], end: node.range[1], text });
    } else if (operation.op === 'move') {
      const from = model.pairs.get(operation.from);
      if (!from || from.key.keys.length !== 1 || jsonPointer(pointerPath(operation.from, previous.value).slice(0, -1)) !== jsonPointer(path.slice(0, -1))) throw new DocumentSourceError('Rename this TOML table or dotted key in Code.');
      edits.push({ start: from.key.range[0], end: from.key.range[1], text: quoteKey(String(path.at(-1))) });
    } else if (operation.op === 'remove') {
      if (!pair || pair.parent.type === 'TOMLInlineTable') throw new DocumentSourceError('Remove this TOML table or inline member in Code to preserve its layout.');
      const start = previous.text.lastIndexOf('\n', pair.range[0] - 1) + 1, newline = previous.text.indexOf('\n', pair.range[1]);
      edits.push({ start, end: newline < 0 ? previous.text.length : newline + 1, text: '' });
    } else {
      const parent = path.slice(0, -1), container = readJsonPath(value, parent), table = model.tables.get(jsonPointer(parent));
      if (Array.isArray(container) || parent.length && !table) throw new DocumentSourceError('Add this TOML array or inline-table member in Code to preserve its layout.');
      const firstTable = model.ast.body[0].body.find(node => node.type === 'TOMLTable');
      const lineEnd = table ? previous.text.indexOf('\n', table.range[1]) : -1;
      const end = table ? lineEnd < 0 ? previous.text.length : lineEnd + 1 : firstTable?.range[0] ?? previous.text.length;
      edits.push({ start: end, end, text: (end && previous.text[end - 1] !== '\n' ? '\n' : '') + `${quoteKey(String(path.at(-1)))} = ${encodeTomlValue(operation.value)}\n` });
    }
  }
  const text = spliceSource(previous.text, edits), admitted = readTomlDocument(text);
  if (!equalJsonDocument(value, admitted.value)) throw new DocumentSourceError('This TOML edit cannot preserve the source structure. Make it in Code.');
  return text;
}
