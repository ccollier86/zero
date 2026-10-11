import { describe, expect, it } from 'bun:test';
import { splitVisualizationDocument } from './visualization-chunker';

describe('visualization source chunking', () => {
  it('does not fabricate an empty chunk or mark estimated tokens exact', () => {
    expect(splitVisualizationDocument(' \n\t ')).toEqual([]);
    const rows = splitVisualizationDocument('Hello actual document.');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ index: 0, start: 0, end: 22, overlapChars: 0, tokenCountApproximate: true });
  });
  it('retains exact UTF-16 source spans, section identities, and bounded overlap', () => {
    const text = '# Intro\n' + 'first paragraph. '.repeat(10) + '\n\n# Details\n' + 'second paragraph. '.repeat(10);
    const rows = splitVisualizationDocument(text, { maxChars: 60, overlapChars: 10 });
    expect(new Set(rows.map(row => row.section))).toEqual(new Set(['Intro', 'Details']));
    for (const [index, row] of rows.entries()) {
      expect(row.index).toBe(index);
      expect(row.text).toBe(text.slice(row.start, row.end));
      expect(row.text.length).toBeLessThanOrEqual(60);
      expect(row.overlapChars).toBeLessThanOrEqual(10);
      expect(row.text.trim()).not.toBe('');
      if (index > 0) expect(row.start).toBeGreaterThan(rows[index - 1]!.start);
    }
    expect(rows.filter(row => row.text.startsWith('#')).every(row => row.overlapChars === 0)).toBe(true);
  });
  it('never bisects emoji surrogate pairs, including one-codepoint token windows', () => {
    const text = '🙂🙂🙂你好世界🌎';
    const rows = splitVisualizationDocument(text, { maxChars: 5, maxTokens: 1, overlapChars: 4, tokenizer: value => Array.from(value).length });
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) {
      expect(Array.from(row.text)).toHaveLength(1);
      expect(row.text).toBe(text.slice(row.start, row.end));
      expect(row.tokenCount).toBe(1);
      expect(row.tokenCountApproximate).toBe(false);
      expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(row.text)).toBe(false);
    }
  });
  it('enforces actual tokenizer and total chunk limits without silent truncation', () => {
    const rows = splitVisualizationDocument('abcdefghijklmnop', { maxChars: 10, maxTokens: 3, overlapChars: 1, tokenizer: s => s.length });
    expect(rows.every(row => row.tokenCount <= 3 && !row.tokenCountApproximate)).toBe(true);
    expect(() => splitVisualizationDocument('abcdefghij', { maxChars: 2, overlapChars: 0, maxChunks: 2 })).toThrow();
    expect(() => splitVisualizationDocument('x', { tokenizer: () => NaN })).toThrow();
    expect(() => splitVisualizationDocument('x', { maxTokens: 1, tokenizer: () => 2 })).toThrow();
    expect(() => splitVisualizationDocument('x', { maxChars: 0 })).toThrow();
  });
  it('does not interpret headings inside fenced source code as document sections', () => {
    const text = '# Real\n```markdown\n# Not a section\n```\nmore content\n# Next\nlast content';
    const rows = splitVisualizationDocument(text, { maxChars: 40, overlapChars: 0 });
    expect(new Set(rows.map(row => row.section))).toEqual(new Set(['Real', 'Next']));
    for (let i = 0; i < text.length; i++) if (!/\s/u.test(text[i]!)) {
      expect(rows.some(row => row.start <= i && row.end > i)).toBe(true);
    }
  });
});
