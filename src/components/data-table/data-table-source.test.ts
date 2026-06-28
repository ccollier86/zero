/**
 * data-table-source.test.ts
 *
 * Verifies DataTable's lazy `/api/data` query construction. Hook-level React
 * behavior is covered by typecheck and integration through existing collection
 * tests; this file guards the transport contract.
 */

import { describe, expect, test } from 'bun:test';
import { buildDataTableLazyQuery } from './data-table-source';

describe('buildDataTableLazyQuery', () => {
  test('builds a stable /api/data query with filters and options', () => {
    const query = buildDataTableLazyQuery(
      'audit_log',
      { user_id: 'u_1', archived: false, severity: 2 },
      { order: 'created_at', dir: 'desc', limit: 50, offset: 100 },
    );

    const params = new URLSearchParams(query);

    expect(params.get('table')).toBe('audit_log');
    expect(params.getAll('filter')).toEqual([
      'archived:false',
      'severity:2',
      'user_id:u_1',
    ]);
    expect(params.get('order')).toBe('created_at');
    expect(params.get('dir')).toBe('desc');
    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('100');
  });
});
