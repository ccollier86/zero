/**
 * data-composition-hooks.test.ts
 *
 * Verifies pure query-building behavior for composed frontend data hooks.
 * React rendering behavior is covered by typecheck and integration usage.
 */

import { describe, expect, test } from 'bun:test';
import { buildDataPageQuery } from './data-composition-hooks';

describe('buildDataPageQuery', () => {
  test('encodes pagination, sorting, equality filters, operator filters, and array filters', () => {
    const query = buildDataPageQuery(
      'clients',
      {
        status: 'active',
        department: ['ops', 'finance'],
        created_at: { op: 'gte', value: '2026-01-01' },
        empty: null,
      },
      { field: 'created_at', dir: 'desc' },
      3,
      25,
    );
    const url = new URL(query, 'http://zero.test');
    const params = url.searchParams;

    expect(url.pathname).toBe('/api/data');
    expect(params.get('table')).toBe('clients');
    expect(params.getAll('filter')).toEqual([
      'status:active',
      'department:in:ops,finance',
      'created_at:gte:2026-01-01',
    ]);
    expect(params.get('order')).toBe('created_at');
    expect(params.get('dir')).toBe('desc');
    expect(params.get('limit')).toBe('25');
    expect(params.get('offset')).toBe('50');
  });
});
