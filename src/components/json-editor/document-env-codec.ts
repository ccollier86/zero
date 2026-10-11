/** Literal .env grammar and line-preserving edits. No interpolation, shell execution, process.env or file reads. */
import { cloneJsonDocument, jsonContainer, jsonOwn, jsonPointer } from './json-document-model';
import { DocumentSourceError, putSourceValue, sourceComment, spliceSource, type SourceDocument, type SourceSplice } from './document-source-contract';
import type { JsonDocumentValue } from './json-document.types';

interface EnvLine { readonly key: string; readonly start: number; readonly end: number; readonly keyStart: number; readonly keyEnd: number; readonly valueStart: number; readonly valueEnd: number }
const envKey = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
/** This format is a flat string dictionary, including empty values. No implicit numeric/null conversion. */
export function validateEnvValue(value: JsonDocumentValue) {
  if (!jsonContainer(value) || Array.isArray(value)) throw new DocumentSourceError('.env requires a flat object of string values.');
  for (const [key, item] of Object.entries(value)) {
    if (!envKey.test(key)) throw new DocumentSourceError('Environment keys start with a letter or underscore and contain letters, numbers, underscores, dots or hyphens.');
    if (typeof item !== 'string') throw new DocumentSourceError(`.env values must be strings (${key}). Use Code to supply the intended literal text.`);
  }
}
export function quoteEnv(value: string) {
  if (!value || /^[A-Za-z0-9_./:@%+,-]+$/u.test(value)) return value;
  return '"' + value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\n/gu, '\\n').replace(/\r/gu, '\\r').replace(/\t/gu, '\\t').replace(/\$/gu, '\\$') + '"';
}
export function readEnvDocument(text: string): SourceDocument {
  const value: Record<string, JsonDocumentValue> = {}, comments = new Map<string, string>(), lines: EnvLine[] = [];
  let offset = 0, pending: string[] = [];
  const fail = (message: string, at = offset): never => { throw new DocumentSourceError(message, at); };
  while (offset < text.length) {
    const start = offset, newline = text.indexOf('\n', offset), lineEnd = newline < 0 ? text.length : newline;
    const line = text.slice(start, lineEnd).replace(/\r$/u, '');
    if (!line.trim() || /^\s*#/u.test(line)) { if (line.trim()) pending.push(line.trim().slice(1).trim()); offset = newline < 0 ? text.length : newline + 1; continue; }
    const head = /^(\s*)(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*=[ \t]*/u.exec(line);
    if (!head) throw new DocumentSourceError('Use KEY=value on each .env line.', start);
    const key = head[2]!; if (jsonOwn(value, key)) fail('Duplicate environment key.', start + line.indexOf(key));
    const keyStart = start + head[0].lastIndexOf(key, head[0].lastIndexOf('=')), valueStart = start + head[0].length;
    let cursor = valueStart, content = '', valueEnd = cursor;
    const quote = text[cursor];
    if (quote === '"' || quote === "'") {
      cursor++; let closed = false;
      while (cursor < text.length) {
        const char = text[cursor++]!;
        if (char === quote) { closed = true; break; }
        if (char === '\n' && quote === "'") fail('Single-quoted environment values must stay on one line.', cursor - 1);
        if (char === '\\' && quote === '"') {
          const next = text[cursor++]; if (next === undefined) fail('Unterminated environment value.', valueStart);
          content += ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', $: '$' } as Record<string, string>)[next!] ?? '\\' + next;
        } else content += char;
      }
      if (!closed) fail('Unterminated environment value. Add the closing quote.', valueStart);
      valueEnd = cursor;
    } else {
      while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') {
        if (text[cursor] === '#' && cursor > 0 && /[ \t]/u.test(text[cursor - 1]!)) break;
        cursor++;
      }
      content = text.slice(valueStart, cursor).trimEnd(); valueEnd = valueStart + content.length;
    }
    const afterLine = text.indexOf('\n', cursor), end = afterLine < 0 ? text.length : afterLine + 1;
    const tail = text.slice(cursor, afterLine < 0 ? text.length : afterLine).trim();
    if ((quote === '"' || quote === "'") && tail && !tail.startsWith('#')) fail('Only a comment may follow a quoted environment value.', cursor);
    putSourceValue(value, key, content);
    sourceComment(comments, [key], [...(tail.startsWith('#') ? [tail.slice(1).trim()] : []), ...pending].join('\n')); pending = [];
    lines.push({ key, start, end, keyStart, keyEnd: keyStart + key.length, valueStart, valueEnd }); offset = end;
  }
  return { format: 'env', text, value: cloneJsonDocument(value), comments, native: new Map(), model: lines };
}
export function writeEnvDocument(value: JsonDocumentValue, previous?: SourceDocument, rename?: { from: string; to: string }) {
  validateEnvValue(value); const next = value as Record<string, string>;
  if (!previous) return Object.entries(next).map(([key, item]) => `${key}=${quoteEnv(item)}\n`).join('');
  const edits: SourceSplice[] = [], handled = new Set<string>();
  for (const line of previous.model as EnvLine[]) {
    const key = rename?.from === jsonPointer([line.key]) ? rename.to : line.key;
    if (!jsonOwn(next, key)) { edits.push({ start: line.start, end: line.end, text: '' }); continue; }
    handled.add(key);
    if (key !== line.key) edits.push({ start: line.keyStart, end: line.keyEnd, text: key });
    if (next[key] !== (previous.value as Record<string, string>)[line.key]) edits.push({ start: line.valueStart, end: line.valueEnd, text: quoteEnv(next[key]!) + (previous.text[line.valueEnd] === '#' ? ' ' : '') });
  }
  const added = Object.keys(next).filter(key => !handled.has(key));
  if (added.length) edits.push({ start: previous.text.length, end: previous.text.length, text: (previous.text && !previous.text.endsWith('\n') ? '\n' : '') + added.map(key => `${key}=${quoteEnv(next[key]!)}\n`).join('') });
  return spliceSource(previous.text, edits);
}
