/** Strict bounded JSON source parser and escaped React-token data. Owns JSON diagnostics only, not a general code editor or HTML rendering. */
import { JSON_DOCUMENT_LIMITS, cloneJsonDocument, jsonOwn } from './json-document-model';
import type { JsonDocumentValue } from './json-document.types';

export type JsonDocumentParseResult = { readonly ok: true; readonly value: JsonDocumentValue }
  | { readonly ok: false; readonly message: string; readonly offset: number; readonly line: number; readonly column: number; readonly length: number };
class JsonSourceFault extends Error { constructor(message: string, readonly offset: number, readonly length = 1) { super(message); } }

/** Reject duplicate keys and nonfinite numbers; preserve the exact source and a one-based line/column on failure. */
export function parseJsonDocument(source: string): JsonDocumentParseResult {
  let cursor = 0, nodes = 0;
  const fail = (message: string, offset = cursor, length = 1): never => { throw new JsonSourceFault(message, offset, length); };
  const whitespace = () => { while (/[ \t\r\n]/u.test(source[cursor] ?? '') && cursor < source.length) cursor++; };
  function string(): string {
    const start = cursor++;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '"') {
        try { return JSON.parse(source.slice(start, cursor)) as string; }
        catch { fail('Invalid string escape.', start, cursor - start); }
      }
      if (char === '\\') cursor++;
      else if (char! < ' ') fail('Control characters inside strings must be escaped.', cursor - 1);
    }
    return fail('Unterminated string. Add the closing quote.', start, Math.max(1, cursor - start));
  }
  function value(depth: number): JsonDocumentValue {
    if (++nodes > JSON_DOCUMENT_LIMITS.nodes || depth > JSON_DOCUMENT_LIMITS.depth) fail('JSON document exceeds the supported structural limit.');
    whitespace(); const start = cursor, char = source[cursor];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      cursor++; whitespace();
      const array = char === '[', closing = array ? ']' : '}', object: Record<string, JsonDocumentValue> = {}, items: JsonDocumentValue[] = [];
      if (source[cursor] === closing) { cursor++; return array ? items : object; }
      for (;;) {
        whitespace();
        if (cursor >= source.length) fail(`This ${char} is never closed. Expected ${closing}.`, start);
        let name = '';
        if (!array) {
          if (source[cursor] !== '"') fail('Object keys need double quotes.');
          const keyStart = cursor; name = string();
          if (jsonOwn(object, name)) fail('Duplicate object key.', keyStart, cursor - keyStart);
          whitespace(); if (source[cursor++] !== ':') fail('Expected a colon after the object key.', cursor - 1);
        }
        const child = value(depth + 1);
        if (array) items.push(child); else Object.defineProperty(object, name, { value: child, enumerable: true, writable: true, configurable: true });
        whitespace();
        if (source[cursor] === closing) { cursor++; return array ? items : object; }
        if (cursor >= source.length) fail(`This ${char} is never closed. Expected ${closing}.`, start);
        if (source[cursor] !== ',') fail('Missing comma between entries.');
        const comma = cursor++; whitespace();
        if (source[cursor] === closing) fail('Trailing comma. Remove it or add another entry.', comma);
      }
    }
    const remaining = source.slice(cursor);
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(remaining);
    if (number) {
      cursor += number[0].length;
      if (/[\w.+-]/u.test(source[cursor] ?? '')) fail('Invalid JSON number.', start, cursor - start + 1);
      const result = Number(number[0]); if (!Number.isFinite(result)) fail('JSON numbers must be finite.', start, number[0].length);
      return result;
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) if (remaining.startsWith(token)) {
      cursor += token.length; if (/[\w$]/u.test(source[cursor] ?? '')) fail('Unexpected text after the JSON value.', start, token.length);
      return result;
    }
    return fail(cursor >= source.length ? 'Expected a JSON value.' : 'Expected a quoted string, number, boolean, null, object or array.');
  }
  try {
    if (source.length > JSON_DOCUMENT_LIMITS.characters) fail('JSON source exceeds the text limit.', 0);
    whitespace(); if (!source.trim()) fail('The JSON document is empty.', 0);
    const result = value(0); whitespace(); if (cursor < source.length) fail('Unexpected text after the end of the JSON.');
    return { ok: true, value: cloneJsonDocument(result) };
  } catch (error) {
    const fault = error instanceof JsonSourceFault ? error : new JsonSourceFault('JSON document exceeds the supported limit.', 0);
    const before = source.slice(0, fault.offset), line = before.split('\n').length, last = before.lastIndexOf('\n');
    return { ok: false, message: fault.message, offset: fault.offset, length: fault.length, line, column: fault.offset - last };
  }
}

export interface JsonSourceToken { readonly kind: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'invalid' | 'space'; readonly text: string }
/** Token text is rendered by React, never interpolated into innerHTML; invalid input remains visible. */
export function tokenizeJsonDocument(source: string): JsonSourceToken[] {
  const pattern = /("(?:[^"\\\n]|\\.)*"?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false)\b|(null)\b|([{}\[\],:])|(\s+)|([A-Za-z_$][\w$]*|.)/gyu;
  const result: JsonSourceToken[] = []; let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const kind = match[1] ? (/^[ \t]*:/u.test(source.slice(pattern.lastIndex)) ? 'key' : 'string')
      : match[2] ? 'number' : match[3] ? 'boolean' : match[4] ? 'null' : match[5] ? 'punctuation' : match[6] ? 'space' : 'invalid';
    const previous = result.at(-1);
    if (previous?.kind === kind) result[result.length - 1] = { kind, text: previous.text + match[0] };
    else result.push({ kind, text: match[0] });
    // Source stays complete; only the syntax decoration is bounded.
    if (result.length >= 5_000) { result.push({ kind: 'space', text: source.slice(pattern.lastIndex) }); break; }
  }
  return result;
}
