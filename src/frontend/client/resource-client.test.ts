/**
 * resource-client.test.ts
 *
 * Verifies the generated-resource SDK wrapper without React or a running
 * server. These tests keep URL/method construction separate from transport.
 */

import { describe, expect, test } from 'bun:test';

import { createResourceClient } from './resource-client';

describe('createResourceClient', () => {
  test('lists resources with Zero filter, sort, and pagination query params', async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    const client = createResourceClient('tickets', {
      async fetch<T = unknown>(path: string, init?: { method?: string }): Promise<T> {
        calls.push({ path, method: init?.method });
        return {
          rows: [{ ticket_id: 't_1', status: 'new' }],
          page: { limit: 25, offset: 50, count: 1, hasMore: false, nextOffset: null },
        } as T;
      },
    });

    const result = await client.list({
      filters: {
        owner_id: 'u_1',
        status: ['new', 'open'],
      },
      sort: { field: 'created_at', dir: 'asc' },
      limit: 25,
      offset: 50,
    });

    const url = new URL(calls[0].path, 'http://zero.test');
    expect(calls[0].method).toBe('GET');
    expect(url.pathname).toBe('/api/resources/tickets');
    expect(url.searchParams.getAll('filter')).toEqual([
      'owner_id:u_1',
      'status:in:new,open',
    ]);
    expect(url.searchParams.get('order')).toBe('created_at');
    expect(url.searchParams.get('dir')).toBe('asc');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('50');
    expect(result.rows[0].ticket_id).toBe('t_1');
  });

  test('wraps get, create, update, delete, and custom prefixes', async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    const client = createResourceClient('intake request', {
      async fetch<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
        calls.push({ path, method: init?.method, body: init?.body });
        if (init?.method === 'DELETE') return { deleted: true, id: 'i_1' } as T;
        return { row: { intake_request_id: 'i_1', status: 'new' } } as T;
      },
    }, {
      prefix: '/api/clinic/resources',
    });

    await client.get('i_1');
    await client.create({ status: 'new' });
    await client.update('i_1', { status: 'verified' });
    const deleted = await client.remove('i_1');

    expect(calls).toMatchObject([
      { path: '/api/clinic/resources/intake%20request/i_1', method: 'GET' },
      { path: '/api/clinic/resources/intake%20request', method: 'POST', body: { status: 'new' } },
      { path: '/api/clinic/resources/intake%20request/i_1', method: 'PATCH', body: { status: 'verified' } },
      { path: '/api/clinic/resources/intake%20request/i_1', method: 'DELETE' },
    ]);
    expect(deleted).toEqual({ deleted: true, id: 'i_1' });
  });
});
