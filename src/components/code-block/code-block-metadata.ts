/** Safe interpretation of supported fence metadata; never evaluates source. */
import type { CodeBlockHighlightOptions } from './code-block.types';
import { codeBlockTransformerKey } from './code-block-highlight-identity';

export interface CodeBlockMetadata {
  title?: string;
  prefix?: string;
  lineNumbers: boolean;
  wordWrap: boolean;
  startLine: number;
  highlightLines: readonly number[];
}

/** Read display options from fence metadata, with explicit props winning. */
export function readCodeBlockMetadata(options: CodeBlockHighlightOptions = {}, maxLine = 100_000): CodeBlockMetadata {
  const meta = options.meta ?? '';
  const number = Number(readQuotedValue(meta, 'startLine') ?? meta.match(/(?:^|\s)startLine=(\d+)(?=\s|$)/)?.[1] ?? 1);
  return {
    title: readQuotedValue(meta, 'title') ?? readQuotedValue(meta, 'filename'),
    prefix: options.lineAnchors ?? readQuotedValue(meta, 'prefix'),
    lineNumbers: options.showLineNumbers ?? /(?:^|\s)(?:lineNumbers|showLineNumbers)(?=\s|$)/.test(meta),
    wordWrap: options.wordWrap ?? /(?:^|\s)wrap(?=\s|$)/.test(meta),
    startLine: normalizeStartLine(options.startLine ?? number),
    highlightLines: options.highlightLines?.filter(line => Number.isSafeInteger(line) && line > 0 && line <= maxLine)
      ?? parseCodeBlockLineRanges(meta.match(/\{([\d,\s-]+)\}/)?.[1] ?? '', maxLine),
  };
}

/** Bounded line range parsing, shared with Markdown compilers. */
export function parseCodeBlockLineRanges(ranges: string, maxLine = 100_000): readonly number[] {
  const lines = new Set<number>();
  for (const entry of ranges.split(',')) {
    const match = entry.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) continue;
    const first = Number(match[1]), last = Number(match[2] ?? first);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > 100_000) continue;
    const limit = Number.isSafeInteger(maxLine) && maxLine >= 0 ? Math.min(maxLine, 100_000) : 100_000;
    for (let line = first; line <= Math.min(last, limit); line++) lines.add(line);
  }
  return [...lines].sort((left, right) => left - right);
}

/** Stable non-security fingerprint prevents older async results replacing newer source. */
export function codeBlockHighlightKey(code: string, language: string, options: CodeBlockHighlightOptions = {}): string {
  const descriptor = JSON.stringify([code, language.trim().toLowerCase() || 'text', options.theme ?? null,
    options.meta ?? '', options.highlightWords ?? [], options.annotations ?? true,
    readCodeBlockMetadata(options, code.split('\n').length), codeBlockTransformerKey(options)]);
  let hash = 2166136261;
  for (let index = 0; index < descriptor.length; index++) hash = Math.imul(hash ^ descriptor.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

export function normalizeStartLine(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function readQuotedValue(meta: string, name: string): string | undefined {
  return meta.match(new RegExp(`(?:^|\\s)${name}=(["'])(.*?)\\1(?=\\s|$)`))?.[2];
}
