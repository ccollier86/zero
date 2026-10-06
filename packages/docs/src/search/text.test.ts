import { describe, expect, test } from 'bun:test';
import { createDocsSearchText, docsMatchRanges, docsSearchTerms, docsTermQuality } from './text';

describe('original-text search ranges', () => {
  test('NFC and lowercase expansion preserve original grapheme offsets', () => {
    const text = 'İ '.repeat(100) + 'cafe\u0301 needle 😃';
    const ranges = docsMatchRanges(text, docsSearchTerms('CAFÉ needle'));
    expect(ranges.map(range => text.slice(range.start, range.end))).toEqual(['cafe\u0301', 'needle']);
    expect(docsMatchRanges('İstanbul', docsSearchTerms('i'))).toEqual([{ start: 0, end: 1 }]);
    expect(createDocsSearchText('ordinary WORD').starts).toBeUndefined();
  });
  test('literal metacharacters, overlapping matches and astral text do not become markup or regular expressions', () => {
    expect(docsMatchRanges('*** <b>x</b>', ['***', '<b>'])).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }]);
    expect(docsMatchRanges('needle', ['need', 'needle'])).toEqual([{ start: 0, end: 6 }]);
    expect(docsMatchRanges('A😃B', docsSearchTerms('😃'))).toEqual([{ start: 1, end: 3 }]);
    expect(docsMatchRanges('x '.repeat(1_000), ['x'])).toHaveLength(16);
  });
  test('query budgets, Greek final sigma and whole-word ranking are explicit', () => {
    expect(docsSearchTerms('a a b c d e f g h i j')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(docsMatchRanges('ΟΣ ος οσ', docsSearchTerms('ος'))).toHaveLength(3);
    expect(docsTermQuality('token', 'token')).toBe(3); expect(docsTermQuality('tokenizer', 'token')).toBe(2); expect(docsTermQuality('subtoken', 'token')).toBe(1);
  });
  test('older reader runtimes without Intl.Segmenter still map canonical and expanded offsets safely', async () => {
    const module = new URL('./text.ts', import.meta.url).href;
    const source = `Object.defineProperty(Intl, 'Segmenter', {value: undefined}); const {docsMatchRanges, docsSearchTerms}=await import(${JSON.stringify(module)}); const text='İ cafe\\u0301'; const ranges=docsMatchRanges(text,docsSearchTerms('i café')); if(JSON.stringify(ranges)!==JSON.stringify([{start:0,end:1},{start:2,end:7}])) throw new Error('Unsafe fallback ranges');`;
    const child = Bun.spawn([Bun.which('bun')!, '--no-env-file', '-e', source], { stdout: 'pipe', stderr: 'pipe' });
    const error = await new Response(child.stderr).text();
    expect(await child.exited, error).toBe(0);
  });
});
