/** Browser-safe literal search normalization and original-text ranges; never builds or injects HTML. */
export interface DocsMatchRange { readonly start: number; readonly end: number }
export interface DocsSearchText {
  readonly original: string;
  readonly value: string;
  /** NFC/case expansion mapping; omitted when original UTF-16 positions remain unchanged. */
  readonly starts?: readonly number[];
  readonly ends?: readonly number[];
}
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : undefined;
const fold = (value: string) => value.normalize('NFC').toLocaleLowerCase('en').replace(/ς/gu, 'σ');

/** Normalize bounded queries into at most eight distinct, literal AND terms. */
export function docsSearchTerms(query: string): readonly string[] {
  return [...new Set(fold(query.trim().slice(0, 200)).split(/\s+/u).filter(Boolean))].slice(0, 8);
}

/** Precompute normalization once, retaining grapheme-aligned original offsets when lengths change. */
export function createDocsSearchText(original: string): DocsSearchText {
  const normalized = original.normalize('NFC'), value = fold(normalized);
  if (normalized === original && value.length === original.length) return { original, value };
  const starts: number[] = [], ends: number[] = []; let mapped = '';
  for (const { segment, index } of segmenter?.segment(original) ?? fallbackGraphemes(original)) {
    const part = fold(segment); mapped += part;
    for (let position = 0; position < part.length; position++) { starts.push(index); ends.push(index + segment.length); }
  }
  return { original, value: mapped, starts, ends };
}

/** Conservative Unicode fallback keeps combining marks/ZWJ sequences together in older reader browsers. */
function* fallbackGraphemes(value: string): Generator<{ segment: string; index: number }> {
  let segment = '', index = 0, offset = 0, join = false;
  for (const character of value) {
    const continuation = segment && (join || character === '\u200d' || /[\p{M}\uFE0E\uFE0F]/u.test(character));
    if (segment && !continuation) { yield { segment, index }; segment = ''; index = offset; }
    segment += character; join = character === '\u200d'; offset += character.length;
  }
  if (segment) yield { segment, index };
}

/** Find bounded merged UTF-16 ranges in original text, safe for React text-node highlighting. */
export function docsMatchRanges(text: string, terms: readonly string[], maximum = 16): readonly DocsMatchRange[] {
  return docsSearchTextRanges(createDocsSearchText(text), terms, maximum);
}

/** Reuse a prebuilt text projection without rescanning Unicode mappings on every query. */
export function docsSearchTextRanges(text: DocsSearchText, terms: readonly string[], maximum = 16): readonly DocsMatchRange[] {
  const cap = Number.isSafeInteger(maximum) ? Math.max(0, Math.min(128, maximum)) : 16;
  if (!cap) return [];
  const found: DocsMatchRange[] = [];
  for (const term of terms.slice(0, 8)) {
    if (!term) continue;
    let cursor = 0, hits = 0;
    while (hits++ < cap) {
      const index = text.value.indexOf(term, cursor); if (index < 0) break;
      const end = index + term.length;
      found.push({ start: text.starts?.[index] ?? index, end: text.ends?.[end - 1] ?? end });
      cursor = end;
    }
  }
  found.sort((left, right) => left.start - right.start || left.end - right.end);
  const result: Array<{ start: number; end: number }> = [];
  for (const range of found) {
    const previous = result[result.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else if (result.length < cap) result.push({ ...range });
  }
  return result;
}

/** Rank whole words above prefixes, and prefixes above arbitrary literal substrings. */
export function docsTermQuality(value: string, term: string): number {
  let cursor = 0, best = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const index = value.indexOf(term, cursor); if (index < 0) break;
    const before = index === 0 || !/[\p{L}\p{M}\p{N}_]$/u.test(value.slice(0, index));
    const after = index + term.length === value.length || !/[\p{L}\p{M}\p{N}_]/u.test(String.fromCodePoint(value.codePointAt(index + term.length) ?? 0));
    best = Math.max(best, before ? after ? 3 : 2 : 1); if (best === 3) break;
    cursor = index + term.length;
  }
  return best;
}
