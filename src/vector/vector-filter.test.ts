import { describe, expect, it } from 'bun:test';

import { VectorError } from './vector-error';
import {
  buildZvecFilter,
  extractSimpleEqualityMetadata,
  mergeVectorFilters,
  recordMatchesVectorFilter,
} from './vector-filter';

describe('vector-filter', () => {
  const allowed = new Set(['bucket', 'year', 'status', 'title']);

  it('builds zvec SQL-like filters from structured input', () => {
    const filter = buildZvecFilter({
      bucket: 'docs',
      year: { gte: 2024, lt: 2026 },
      status: { in: ['open', 'closed'] },
    }, allowed);

    expect(filter).toBe("(bucket = 'docs') AND (year >= 2024 AND year < 2026) AND (status in ('open', 'closed'))");
  });

  it('supports logical AND and OR groups', () => {
    const filter = buildZvecFilter({
      $and: [
        { bucket: 'docs' },
        { $or: [{ status: 'open' }, { status: 'review' }] },
      ],
    }, allowed);

    expect(filter).toBe("(((bucket = 'docs')) AND ((((status = 'open')) OR ((status = 'review')))))");
  });

  it('rejects unknown fields before zvec sees the expression', () => {
    expect(() => buildZvecFilter({ unknown: 'x' }, allowed)).toThrow(VectorError);
  });

  it('maps public filter fields to internal zvec field names', () => {
    const filter = buildZvecFilter({ id: 'doc_1' }, new Set(['id']), { id: '_zero_id' });

    expect(filter).toBe("(_zero_id = 'doc_1')");
  });

  it('merges scope filters and extracts simple equality metadata', () => {
    const merged = mergeVectorFilters({ bucket: 'docs' }, { status: 'open' });
    expect(merged).toEqual({ $and: [{ bucket: 'docs' }, { status: 'open' }] });
    expect(extractSimpleEqualityMetadata({ bucket: 'docs', status: { eq: 'open' }, year: { gte: 2024 } }))
      .toEqual({ bucket: 'docs', status: 'open' });
    expect(extractSimpleEqualityMetadata({ $and: [{ bucket: 'docs' }, { status: { eq: 'open' } }] }))
      .toEqual({ bucket: 'docs', status: 'open' });
  });

  it('evaluates scoped fetch filters against returned records', () => {
    expect(recordMatchesVectorFilter({
      id: 'doc_1',
      text: 'Alpha',
      metadata: { bucket: 'docs', year: 2025 },
    }, { bucket: 'docs', year: { gte: 2024 } })).toBe(true);
    expect(recordMatchesVectorFilter({
      id: 'doc_2',
      metadata: { bucket: 'other', year: 2025 },
    }, { bucket: 'docs' })).toBe(false);
  });
});
