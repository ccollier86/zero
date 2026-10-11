import { describe, expect, it } from 'bun:test';
import { deriveVisualizationNeighbors, fitVisualizationProjection, transformVisualizationVector } from './visualization-projection';

const sample = [
  { id: 'a', vector: [-2, 0, 0] }, { id: 'b', vector: [2, 0, 0] },
  { id: 'c', vector: [0, 1, 0] }, { id: 'd', vector: [0, -1, 0] },
];
describe('fixed visualization PCA', () => {
  it('fits a deterministic stable frame independent of seed ordering', () => {
    const a = fitVisualizationProjection(sample), b = fitVisualizationProjection([...sample].reverse());
    expect(a).toEqual(b);
    expect(Math.abs(a.axes[0][0]!)).toBeCloseTo(1);
    expect(Math.abs(a.axes[1][1]!)).toBeCloseTo(1);
    expect(transformVisualizationVector(a, sample[0]!.vector).x).toBeCloseTo(-0.85);
    expect(transformVisualizationVector(a, sample[1]!.vector).x).toBeCloseTo(0.85);
    const before = JSON.stringify(a);
    const point = transformVisualizationVector(a, [500, -900, 0]);
    expect(point).toEqual({ x: 0.85, y: -0.85 });
    expect(JSON.stringify(a)).toBe(before);
  });
  it('handles empty, single, identical, and one-dimensional real seeds safely', () => {
    for (const rows of [[], [{ id: 'a', vector: [0, 0] }], [{ id: 'a', vector: [5] }, { id: 'b', vector: [5] }]]) {
      const p = fitVisualizationProjection(rows);
      expect(transformVisualizationVector(p, Array(p.dimensions).fill(0))).toEqual({ x: 0, y: 0 });
    }
    const p = fitVisualizationProjection([{ id: 'a', vector: [-1] }, { id: 'b', vector: [1] }]);
    expect(transformVisualizationVector(p, [1])).toEqual({ x: 0.85, y: 0 });
  });
  it('scales tiny and huge finite inputs without non-finite coordinates', () => {
    for (const magnitude of [1e-250, 1e300]) {
      const p = fitVisualizationProjection([{ id: 'a', vector: [-magnitude, 0] }, { id: 'b', vector: [magnitude, 0] }]);
      expect(transformVisualizationVector(p, [magnitude, 0]).x).toBeCloseTo(0.85);
    }
    const p = fitVisualizationProjection([{ id: 'a', vector: [-1e-250] }, { id: 'b', vector: [1e-250] }]);
    expect(transformVisualizationVector(p, [1e308]).x).toBe(0.85);
  });
  it('rejects malformed, non-finite, mismatched and over-capacity inputs', () => {
    expect(() => fitVisualizationProjection([{ id: 'a', vector: [NaN] }])).toThrow();
    expect(() => fitVisualizationProjection([{ id: 'a', vector: [1] }, { id: 'b', vector: [1, 2] }])).toThrow();
    expect(() => fitVisualizationProjection([sample[0]!, sample[0]!])).toThrow();
    expect(() => fitVisualizationProjection(Array.from({ length: 401 }, (_, i) => ({ id: `${i}`, vector: [i] })))).toThrow();
    expect(() => transformVisualizationVector(fitVisualizationProjection(sample), [1])).toThrow();
    expect(() => transformVisualizationVector({ ...fitVisualizationProjection(sample), axes: [] } as any, [1, 2, 3])).toThrow();
  });
  it('labels bounded exact sample neighbors as derived, not native graph links', () => {
    const result = deriveVisualizationNeighbors([{ id: 'same', vector: [1, 0] }, { id: 'opposite', vector: [-1, 0] }, { id: 'near', vector: [1, 0.1] }], 1);
    expect(result.provenance).toBe('derived-neighbors');
    expect(result.neighborIds.same).toEqual(['near']);
    expect(deriveVisualizationNeighbors([], 0).neighborIds).toEqual({});
    expect(() => deriveVisualizationNeighbors(sample, 17)).toThrow();
  });
  it('bounds high-dimensional graph work without dropping points or fabricating links outside the deterministic subset', () => {
    const vector = new Float32Array(8_192); vector[0] = 1;
    const rows = Array.from({ length: 112 }, (_, i) => ({ id: String(i).padStart(3, '0'), vector }));
    const result = deriveVisualizationNeighbors(rows, 1);
    expect(Object.keys(result.neighborIds)).toHaveLength(rows.length);
    // floor(sqrt(100,000,000 / 8192)) = 110; all comparisons stay in it.
    expect(result.neighborIds['000']).toEqual(['001']);
    expect(result.neighborIds['109']).toEqual(['000']);
    expect(result.neighborIds['110']).toEqual([]);
    expect(result.neighborIds['111']).toEqual([]);
    expect(deriveVisualizationNeighbors([...rows].reverse(), 1)).toEqual(result);
    expect(Object.values(deriveVisualizationNeighbors(rows, 0).neighborIds).every(ids => ids.length === 0)).toBe(true);
  });
});
