/** Bounded, section-aware splitting with honest source spans and token accounting. */

import { VectorError } from './vector-error';
import type { VectorVisualizationChunk } from './visualization-types';

export type VisualizationChunkText = Pick<VectorVisualizationChunk,
  'index' | 'text' | 'section' | 'start' | 'end' | 'overlapChars' | 'tokenCount' | 'tokenCountApproximate'>;

export interface VisualizationChunkOptions {
  /** UTF-16 code-unit budget; boundaries never split a Unicode surrogate pair. */
  maxChars?: number;
  /** Actual tokenizer budget when supplied, otherwise an explicitly approximate budget. */
  maxTokens?: number;
  /** UTF-16 source overlap, shortened when needed to guarantee forward progress. */
  overlapChars?: number;
  maxChunks?: number;
  /** Synchronous model-owned tokenizer count. Never guess that a count is exact. */
  tokenizer?: (text: string) => number;
}

/** Split without fabricating text, losing source offsets, or emitting empty chunks. */
export function splitVisualizationDocument(text: string, options: VisualizationChunkOptions = {}): VisualizationChunkText[] {
  if (typeof text !== 'string' || text.length > 1_048_576 || text.includes('\0')) {
    throw new VectorError('VECTOR_METADATA_INVALID', 'Ingestion text must be a bounded string.');
  }
  const maxChars = integer(options.maxChars ?? 2_000, 2, 65_536, 'maxChars');
  const maxTokens = integer(options.maxTokens ?? 512, 1, 32_768, 'maxTokens');
  const overlap = integer(options.overlapChars ?? Math.min(200, Math.floor(maxChars / 10)), 0, maxChars - 1, 'overlapChars');
  const maxChunks = integer(options.maxChunks ?? 4_096, 1, 4_096, 'maxChunks');
  if (options.tokenizer !== undefined && typeof options.tokenizer !== 'function') {
    throw new VectorError('VECTOR_CONFIG_INVALID', 'Chunk tokenizer must be a synchronous count function.');
  }
  const count = (value: string): number => {
    let n: number;
    try { n = options.tokenizer ? options.tokenizer(value) : Math.ceil(Array.from(value).length / 4); }
    catch { throw new VectorError('VECTOR_OPERATION_FAILED', 'Chunk tokenizer could not count source text.'); }
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new VectorError('VECTOR_OPERATION_FAILED', 'Chunk tokenizer returned an invalid count.');
    }
    return n;
  };
  const chunks: VisualizationChunkText[] = [];
  for (const section of sections(text)) {
    let start = section.start;
    let previousEnd = start;
    while (start < section.end) {
      while (start < section.end && /\s/u.test(text[start]!)) start += 1;
      if (start >= section.end) break;
      let end = boundary(text, Math.min(section.end, start + maxChars), -1);
      if (count(text.slice(start, end)) > maxTokens) {
        // Model token counts need not be monotone. Binary search finds a useful
        // prefix; the final count is rechecked rather than trusting monotonicity.
        let lo = start, hi = end;
        while (hi - lo > 1) {
          const mid = boundary(text, Math.floor((lo + hi) / 2), -1);
          if (mid <= lo) break;
          if (count(text.slice(start, mid)) <= maxTokens) lo = mid;
          else hi = mid;
        }
        end = lo;
        if (end === start) end = boundary(text, start + 1, 1);
      }
      if (end < section.end) {
        const candidate = preferredBreak(text, start, end);
        if (candidate > start && count(text.slice(start, candidate)) <= maxTokens) end = candidate;
      }
      while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;
      if (end <= start || count(text.slice(start, end)) > maxTokens) {
        throw new VectorError('VECTOR_CONFIG_INVALID', 'A source character exceeds the configured tokenizer budget.');
      }
      if (chunks.length >= maxChunks) {
        throw new VectorError('VECTOR_BACKPRESSURE', 'Ingestion chunk capacity is exhausted.', { capacity: 'chunks' });
      }
      const value = text.slice(start, end);
      chunks.push({ index: chunks.length, text: value, ...(section.title ? { section: section.title } : {}),
        start, end, overlapChars: Math.max(0, previousEnd - start), tokenCount: count(value),
        tokenCountApproximate: !options.tokenizer });
      previousEnd = end;
      if (end >= section.end) break;
      // Overlap never repeats the entire previous chunk (including token-limited
      // tiny chunks), and never crosses a section boundary.
      start = Math.max(boundary(text, start + 1, 1), boundary(text, end - overlap, 1));
    }
  }
  return chunks;
}

function integer(n: number, min: number, max: number, field: string): number {
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new VectorError('VECTOR_CONFIG_INVALID', 'Chunk setting is outside the supported range.', { field, min, max });
  }
  return n;
}

function boundary(text: string, offset: number, dir: -1 | 1): number {
  const i = Math.max(0, Math.min(text.length, offset));
  if (i > 0 && i < text.length && /[\uD800-\uDBFF]/u.test(text[i - 1]!) && /[\uDC00-\uDFFF]/u.test(text[i]!)) return i + dir;
  return i;
}

function preferredBreak(text: string, start: number, end: number): number {
  const low = start + Math.floor((end - start) / 2);
  const sample = text.slice(low, end);
  for (const pattern of [/\n\s*\n/gu, /[.!?。！？]\s/gu, /\s/gu]) {
    let found = end;
    for (let match = pattern.exec(sample); match; match = pattern.exec(sample)) found = low + match.index;
    if (found < end) return found;
  }
  return end;
}

function sections(text: string): Array<{ start: number; end: number; title?: string }> {
  const result: Array<{ start: number; end: number; title?: string }> = [];
  const lines = /[^\n]*\n|[^\n]+$/gu;
  const heading = /^ {0,3}#{1,6}[\t ]+(.+?)[\t ]*#*[\t ]*$/u;
  let fence: { char: string; size: number } | null = null;
  let start = 0, title: string | undefined;
  for (let line = lines.exec(text); line; line = lines.exec(text)) {
    const value = line[0].replace(/\r?\n$/u, '');
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(value);
    if (marker) {
      if (!fence) fence = { char: marker[1]![0]!, size: marker[1]!.length };
      else if (marker[1]![0] === fence.char && marker[1]!.length >= fence.size && !marker[2]!.trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const match = heading.exec(value);
    if (!match) continue;
    if (line.index > start) result.push({ start, end: line.index, ...(title ? { title } : {}) });
    start = line.index;
    const label = match[1]!.trim();
    title = label.slice(0, boundary(label, 160, -1));
  }
  result.push({ start, end: text.length, ...(title ? { title } : {}) });
  return result;
}
