/**
 * data-table-source.test.ts
 *
 * Verifies DataTable's lazy `/api/data` query construction. Hook-level React
 * behavior is covered by typecheck and integration through existing collection
 * tests; this file guards the transport contract.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildDataTableLazyQuery,
  resolveDataTableCollectionTable,
} from './data-table-source';
import {
  buildDataTableServerQuery,
  createDataTableApiAdapter,
  normalizeDataTableApiResponse,
  normalizeDataTableServerResult,
} from './data-table-server-query';
import { DataTableServerSourceError } from './data-table-server-types';
import type { Client } from '../../frontend/client/sdk';

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
    expect(params.has('includeTotal')).toBe(false);
  });
});

describe('DataTable server query contract', () => {
  test('does not open an unknown collection for a custom logical table', () => {
    const client = {
      _syncClient: { tables: { registered: {} } },
      collection() {
        throw new Error('unknown collection must not be opened');
      },
    } as any;

    expect(resolveDataTableCollectionTable('server', 'logical_endpoint', client)).toBeNull();
    expect(resolveDataTableCollectionTable('server', 'registered', client)).toBe('registered');
  });

  test('encodes offset paging, explicit search fields, filters, and multi-sort', () => {
    const url = buildDataTableServerQuery('documents', {
      search: 'quarterly report',
      searchFields: ['title', 'summary'],
      filters: [
        { id: 'status', value: ['open', 'review'] },
        { id: 'title', value: 'quarterly' },
      ],
      sorting: [
        { id: 'updated_at', desc: true },
        { id: 'title', desc: false },
      ],
      pagination: { mode: 'offset', pageIndex: 2, pageSize: 25 },
    });
    const parsed = new URL(url, 'http://zero.test');

    expect(parsed.pathname).toBe('/api/data');
    expect(parsed.searchParams.get('table')).toBe('documents');
    expect(parsed.searchParams.get('limit')).toBe('25');
    expect(parsed.searchParams.get('offset')).toBe('50');
    expect(parsed.searchParams.get('includeTotal')).toBe('true');
    expect(parsed.searchParams.get('search')).toBe('quarterly report');
    expect(parsed.searchParams.getAll('searchField')).toEqual(['summary', 'title']);
    expect(parsed.searchParams.getAll('filter')).toEqual([
      'status:in:open,review',
      'title:contains:quarterly',
    ]);
    expect(parsed.searchParams.getAll('sort')).toEqual([
      'updated_at:desc',
      'title:asc',
    ]);
  });

  test('exact totals are on for built-in table reads and explicitly optional for expensive endpoints', () => {
    const query = { search: '', filters: [], sorting: [],
      pagination: { mode: 'offset' as const, pageIndex: 0, pageSize: 20 } };
    expect(new URL(buildDataTableServerQuery('documents', query), 'http://zero.test').searchParams.get('includeTotal')).toBe('true');
    expect(new URL(buildDataTableServerQuery('documents', query, { includeTotal: false }), 'http://zero.test').searchParams.has('includeTotal')).toBe(false);
  });

  test('bounded live-insert membership reads never request an unnecessary total', async () => {
    const paths: string[] = [];
    const client = { async fetch(path: string) {
      paths.push(path);
      const params = new URL(path, 'http://zero.test').searchParams;
      const limit = Number(params.get('limit')), offset = Number(params.get('offset'));
      return { rows: [{ id: 'one' }], page: { limit, offset, count: 1, hasMore: false,
        nextOffset: null, ...(params.has('includeTotal') ? { total: 13 } : {}) } };
    } } as unknown as Client;
    const query = { search: '', filters: [], sorting: [],
      pagination: { mode: 'offset' as const, pageIndex: 0, pageSize: 20 } };
    const adapter = createDataTableApiAdapter(client, 'documents', 'id');
    const signal = new AbortController().signal;
    expect((await adapter.query(query, { signal })).page.total).toBe(13);
    expect(await adapter.confirmInsertedRows!(query, ['one'], { signal })).toEqual(['one']);
    expect(new URL(paths[0]!, 'http://zero.test').searchParams.get('includeTotal')).toBe('true');
    expect(new URL(paths[1]!, 'http://zero.test').searchParams.has('includeTotal')).toBe(false);
    const legacy = createDataTableApiAdapter(client, 'documents', 'id', { includeTotal: false });
    expect((await legacy.query(query, { signal })).page.total).toBeUndefined();
  });

  test('requires a custom adapter for cursor pagination', () => {
    expect(() => buildDataTableServerQuery('documents', {
      search: '',
      filters: [],
      sorting: [],
      pagination: { mode: 'cursor', pageIndex: 0, pageSize: 20 },
    })).toThrow(DataTableServerSourceError);
    try {
      buildDataTableServerQuery('documents', {
        search: '',
        filters: [],
        sorting: [],
        pagination: { mode: 'cursor', pageIndex: 0, pageSize: 20 },
      });
    } catch (error) {
      expect((error as DataTableServerSourceError).code)
        .toBe('DATA_TABLE_SERVER_CURSOR_ADAPTER_REQUIRED');
    }
  });

  test('rejects an unvisited cursor page without its opaque cursor', () => {
    expect(() => buildDataTableServerQuery('documents', {
      search: '',
      filters: [],
      sorting: [],
      pagination: { mode: 'cursor', pageIndex: 4, pageSize: 20, cursor: null },
    })).toThrow(DataTableServerSourceError);
  });

  test('validates custom cursor results without mutating their rows', () => {
    const row = { document_id: 'doc-1', title: 'Draft' };
    const rows = [row];
    const result = normalizeDataTableServerResult({
      rows,
      page: { mode: 'cursor', hasMore: true, nextCursor: 'next' },
    }, 'cursor');

    expect(result).toEqual({
      rows: [row],
      page: { mode: 'cursor', hasMore: true, nextCursor: 'next' },
    });
    expect(result.rows).not.toBe(rows);
  });

  test('rejects a capped built-in page before a later offset could skip rows', () => {
    expect(() => normalizeDataTableApiResponse({
      rows: [{ id: 'doc-1' }],
      page: {
        limit: 1,
        offset: 0,
        count: 1,
        hasMore: true,
        nextOffset: 1,
      },
    }, { limit: 2, offset: 0 })).toThrow(DataTableServerSourceError);
  });
});
