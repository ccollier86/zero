import { describe, expect, it } from 'bun:test';
import { fuseVisualizationRanks, normalizeVisualizationVectorScore } from './visualization-model';

describe('honest visualization retrieval scores', () => {
  it('fuses full independent ranks and admits a lexical-only document', () => {
    const rows = fuseVisualizationRanks(['dense-first', 'both'], ['lexical-only', 'both'], { limit: 3 });
    expect(rows.map(row => row.id)).toEqual(['both', 'dense-first', 'lexical-only']);
    expect(rows[0]).toMatchObject({ rank: 1, vectorRank: 2, lexicalRank: 2, score: { kind: 'fusion', direction: 'higher' } });
    expect(rows[0]!.score.value).toBeCloseTo(2 / 62);
  });
  it('deduplicates stable ids within each ranking and honors zero-weight exclusion', () => {
    const rows = fuseVisualizationRanks(['a', 'a', 'b'], ['c', 'b'], { vectorWeight: 0 });
    expect(rows.map(row => row.id)).toEqual(['c', 'b']);
    expect(rows[1]!.lexicalRank).toBe(2);
    expect(() => fuseVisualizationRanks(['x'], [], { vectorWeight: -1 })).toThrow();
    expect(() => fuseVisualizationRanks(['x'], [], { rankConstant: 0 })).toThrow();
  });
  it('computes cosine independently of embedding magnitude without native-distance assumptions', () => {
    expect(normalizeVisualizationVectorScore('cosine', [1e308], [1e-308])).toEqual({ value: 1, kind: 'cosine', direction: 'higher' });
    expect(normalizeVisualizationVectorScore('cosine', [0, 0], [1, 0]).value).toBe(0);
    expect(normalizeVisualizationVectorScore('cosine', [-1, 0], [1, 0]).value).toBe(-1);
  });
  it('preserves inner product and L2 provenance and rejects impossible finite transport scores', () => {
    expect(normalizeVisualizationVectorScore('l2', [3, 4], [0, 0])).toEqual({ value: 5, kind: 'distance', direction: 'lower' });
    expect(normalizeVisualizationVectorScore('ip', [2, 3], [4, 5])).toEqual({ value: 23, kind: 'inner-product', direction: 'higher' });
    expect(normalizeVisualizationVectorScore('ip', [1e308], [1e-308]).value).toBeCloseTo(1);
    expect(normalizeVisualizationVectorScore('l2', [1e-250], [0]).value).toBe(1e-250);
    expect(() => normalizeVisualizationVectorScore('ip', [1e308], [1e308])).toThrow();
    expect(() => normalizeVisualizationVectorScore('cosine', [1], [1, 2])).toThrow();
  });
});
