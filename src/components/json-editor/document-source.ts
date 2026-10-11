/** Source-format orchestration, diagnostics and React text tokens. Codecs do not read files or perform persistence. */
import { Document } from 'yaml';
import { cloneJsonDocument, equalJsonDocument } from './json-document-model';
import { parseJsonDocument, tokenizeJsonDocument, type JsonSourceToken } from './json-document-source';
import { boundSource, DocumentSourceError, sourceFault, spliceSource, type SourceDocument } from './document-source-contract';
import { readYamlDocument, writeYamlDocument } from './document-yaml-codec';
import { readTomlDocument, writeTomlDocument } from './document-toml-codec';
import { readEnvDocument, writeEnvDocument } from './document-env-codec';
import type { JsonDocumentValue } from './json-document.types';
import type { DocumentFormat, DocumentParseResult } from './document.types';
import { documentSourceRanges } from './document-source-ranges';
import { jsonSourceNeedsExactNumbers, formatJsonSourceTokens } from './document-number-precision';

export const DOCUMENT_FORMATS = ['json', 'yaml', 'toml', 'env'] as const;
export const DOCUMENT_FORMAT_LABELS: Record<DocumentFormat, string> = { json: 'JSON', yaml: 'YAML', toml: 'TOML', env: '.env' };
/** Internal source admission flag; aliases/native TOML types have separate path-level restrictions. */
export function documentNeedsExactNumbers(document: SourceDocument): boolean {
  return (document.format === 'json' || document.format === 'yaml') && document.native.get('')?.startsWith('Exact ') === true;
}
/** Read one bounded supplied buffer, preserving source-native metadata privately. */
export function readSourceDocument(text: string, format: DocumentFormat): SourceDocument {
  boundSource(text);
  if (format === 'yaml') return readYamlDocument(text);
  if (format === 'toml') return readTomlDocument(text);
  if (format === 'env') return readEnvDocument(text);
  if (format !== 'json') throw new DocumentSourceError('Choose JSON, YAML, TOML or .env.');
  const result = parseJsonDocument(text); if (!result.ok) throw new DocumentSourceError(result.message, result.offset, result.length);
  return { format, text, value: result.value, comments: new Map(), native: jsonSourceNeedsExactNumbers(text) ? new Map([['', 'Exact JSON numbers · use Code']]) : new Map() };
}
/** Pure public admission: returns a JSON-compatible projection or a source-positioned diagnostic. Native file text remains authoritative. */
export function parseDocumentSource(text: string, format: DocumentFormat = 'json'): DocumentParseResult {
  try { return { ok: true, value: readSourceDocument(text, format).value }; }
  catch (error) { return sourceFault(text, error); }
}
/** Preserve the prior file when editing the tree; failed preservation is explicit, never a lossy stringify fallback. */
export function writeSourceDocument(input: JsonDocumentValue, format: DocumentFormat, previous?: SourceDocument, rename?: { from: string; to: string }) {
  const value = cloneJsonDocument(input);
  if (previous?.format === format && equalJsonDocument(value, previous.value)) return previous.text;
  if (previous?.format === format && documentNeedsExactNumbers(previous)) throw new DocumentSourceError(`Edit this ${DOCUMENT_FORMAT_LABELS[format]} file in Code to preserve exact numbers outside its JavaScript projection.`);
  const text = format === 'yaml' ? writeYamlDocument(value, previous?.format === format ? previous : undefined)
    : format === 'toml' ? writeTomlDocument(value, previous?.format === format ? previous : undefined)
      : format === 'env' ? writeEnvDocument(value, previous?.format === format ? previous : undefined, rename) : JSON.stringify(value, null, 2);
  const parsed = readSourceDocument(text, format);
  if (!equalJsonDocument(parsed.value, value)) throw new DocumentSourceError('This conversion would change a value. Keep the current format or edit its source explicitly.');
  return text;
}
/** Formatting is deliberately source-preserving for TOML/.env; it does not normalize native values or remove comments. */
export function formatDocumentSource(source: string, format: DocumentFormat): string {
  const document = readSourceDocument(source, format);
  if (format === 'json') return formatJsonSourceTokens(source);
  if (format === 'yaml') return documentNeedsExactNumbers(document) ? source : (document.model as Document).toString({ indent: 2 });
  if (format === 'env') {
    const lines = document.model as readonly { keyEnd: number; valueStart: number }[];
    return spliceSource(source, lines.map(line => ({ start: line.keyEnd, end: line.valueStart, text: source[line.valueStart] === '#' ? '= ' : '=' })));
  }
  // TOML ranges come from the parser; only assignment whitespace outside values is changed.
  const model = document.model as { pairs: ReadonlyMap<string, { key: { range: [number, number] }; value: { range: [number, number] } }> };
  const edits = [...model.pairs.values()].map(pair => ({ start: pair.key.range[1], end: pair.value.range[0], text: ' = ' }));
  const text = spliceSource(source, edits);
  const result = readSourceDocument(text, format); if (!equalJsonDocument(document.value, result.value)) throw new DocumentSourceError('Formatting would alter this document.');
  return text;
}

export interface DocumentSourceToken { readonly kind: JsonSourceToken['kind'] | 'comment' | 'anchor' | 'indent' | 'tab'; readonly text: string }
/** Decorations are bounded; every character stays visible and is rendered as text, never HTML. */
export function tokenizeDocumentSource(source: string, format: DocumentFormat): DocumentSourceToken[] {
  if (format === 'json') return tokenizeJsonDocument(source);
  let decorations: ReturnType<typeof documentSourceRanges> = [];
  try { decorations = documentSourceRanges(readSourceDocument(source, format)); } catch { /* Malformed source still needs complete, bounded text decoration. */ }
  if (decorations.length) {
    const result: DocumentSourceToken[] = []; let cursor = 0;
    const pattern = /#[^\n]*|[ \t]+|\r?\n|[{}\[\],:=]|[^\s{}\[\],:=#]+/gyu;
    const gap = (start: number, end: number) => {
      const text = source.slice(start, end); pattern.lastIndex = 0; let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        const piece = match[0], absolute = start + match.index;
        result.push({ text: piece, kind: piece.startsWith('#') ? 'comment' : /^[ \t]+$/u.test(piece) && (absolute === 0 || source[absolute - 1] === '\n') ? piece.includes('\t') ? 'tab' : 'indent'
          : /^\s+$/u.test(piece) ? 'space' : /^[{}\[\],:=]$/u.test(piece) ? 'punctuation' : /^[&*]/u.test(piece) && format === 'yaml' ? 'anchor' : 'space' });
        if (result.length >= 5_000) return start + pattern.lastIndex;
      }
      return end;
    };
    for (const decoration of decorations) {
      if (decoration.start < cursor) continue;
      cursor = gap(cursor, decoration.start);
      if (result.length >= 5_000) { result.push({ kind: 'space', text: source.slice(cursor) }); return result; }
      result.push({ kind: decoration.kind, text: source.slice(decoration.start, decoration.end) }); cursor = decoration.end;
      if (result.length >= 5_000) { result.push({ kind: 'space', text: source.slice(cursor) }); return result; }
    }
    cursor = gap(cursor, source.length); if (cursor < source.length) result.push({ kind: 'space', text: source.slice(cursor) }); return result;
  }
  const tokens: DocumentSourceToken[] = [];
  const pattern = /("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\]|\\.)*"?|'[^']*'?|#[^\n]*|[&*!][^\s,\[\]{}]+|(?:true|false|null|~)\b|[-+]?(?:\d[\w.+:-]*|\.\d+)|[{}\[\],:=]|[ \t]+|\r?\n|[^\s{}\[\],:=#"']+)/gyu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const text = match[0], start = match.index, leading = start === 0 || source[start - 1] === '\n';
    const kind: DocumentSourceToken['kind'] = text[0] === '#' ? 'comment' : /^[&*!]/u.test(text) && format === 'yaml' ? 'anchor'
      : leading && /^[ \t]+$/u.test(text) ? text.includes('\t') ? 'tab' : 'indent' : /^\s+$/u.test(text) ? 'space'
        : /^[{}\[\],:=]$/u.test(text) ? 'punctuation' : /^["']/u.test(text) ? /^[ \t]*[:=]/u.test(source.slice(pattern.lastIndex)) ? 'key' : 'string'
          : /^(?:true|false)$/u.test(text) ? 'boolean' : /^(?:null|~)$/u.test(text) ? 'null' : /^[-+]?(?:\d|\.\d)/u.test(text) && format !== 'env' ? 'number'
            : /^[ \t]*[:=]/u.test(source.slice(pattern.lastIndex)) ? 'key' : 'string';
    tokens.push({ kind, text });
    if (tokens.length >= 5_000) { tokens.push({ kind: 'space', text: source.slice(pattern.lastIndex) }); return tokens; }
  }
  if (pattern.lastIndex === 0 && tokens.map(token => token.text).join('').length < source.length) {
    const length = tokens.reduce((sum, token) => sum + token.text.length, 0); tokens.push({ kind: 'space', text: source.slice(length) });
  }
  return tokens;
}
