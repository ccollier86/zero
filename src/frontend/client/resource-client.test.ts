/**
 * resource-client.test.ts
 *
 * Verifies the generated-resource SDK wrapper without React or a running
 * server. These tests keep URL/method construction separate from transport.
 */

import { describe, expect, test } from 'bun:test';

import {
  createResourceClient,
  ResourceMutationError,
  type ResourceClientTransport,
} from './resource-client';

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
    const calls: Array<{
      path: string;
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    }> = [];
    const client = createResourceClient('intake request', {
      async fetch<T = unknown>(path: string, init?: {
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
      }): Promise<T> {
        calls.push({
          path,
          method: init?.method,
          body: init?.body,
          headers: init?.headers,
        });
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
      {
        path: '/api/clinic/resources/intake%20request',
        method: 'POST',
        body: { status: 'new' },
        headers: { 'Idempotency-Key': expect.stringMatching(/^r_[0-9a-f-]{36}$/) },
      },
      {
        path: '/api/clinic/resources/intake%20request/i_1',
        method: 'PATCH',
        body: { status: 'verified' },
        headers: { 'Idempotency-Key': expect.stringMatching(/^r_[0-9a-f-]{36}$/) },
      },
      {
        path: '/api/clinic/resources/intake%20request/i_1',
        method: 'DELETE',
        headers: { 'Idempotency-Key': expect.stringMatching(/^r_[0-9a-f-]{36}$/) },
      },
    ]);
    expect(deleted).toEqual({ deleted: true, id: 'i_1' });
  });

  test('sends an explicit idempotency key on every mutation kind', async () => {
    const calls: Array<{ method?: string; key?: string }> = [];
    const client = createResourceClient('tickets', {
      async fetch<T = unknown>(
        _path: string,
        init?: Parameters<ResourceClientTransport['fetch']>[1],
      ): Promise<T> {
        calls.push({
          method: init?.method,
          key: init?.headers?.['Idempotency-Key'],
        });
        if (init?.method === 'DELETE') return { deleted: true, id: 't_1' } as T;
        return { row: { ticket_id: 't_1' } } as T;
      },
    });

    await client.create({}, { idempotencyKey: 'caller-create' });
    await client.update('t_1', {}, { idempotencyKey: 'caller-update' });
    await client.delete('t_1', { idempotencyKey: 'caller-delete' });

    expect(calls).toEqual([
      { method: 'POST', key: 'caller-create' },
      { method: 'PATCH', key: 'caller-update' },
      { method: 'DELETE', key: 'caller-delete' },
    ]);
  });

  test('exposes an auto-generated key after transport loss for an exact replay', async () => {
    const keys: string[] = [];
    let fail = true;
    const client = createResourceClient<{ ticket_id: string; status: string }>(
      'tickets',
      {
        async fetch<T = unknown>(
          _path: string,
          init?: Parameters<ResourceClientTransport['fetch']>[1],
        ): Promise<T> {
          keys.push(init?.headers?.['Idempotency-Key'] ?? '');
          if (fail) {
            fail = false;
            throw new TypeError('network disconnected');
          }
          return { row: { ticket_id: 't_1', status: 'open' } } as T;
        },
      },
    );

    let recoveredKey = '';
    try {
      await client.create({ ticket_id: 't_1', status: 'open' });
      throw new Error('Expected mutation transport failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceMutationError);
      const mutationError = error as ResourceMutationError;
      expect(mutationError.cause).toBeInstanceOf(TypeError);
      expect(mutationError.idempotencyKey).toMatch(/^r_[0-9a-f-]{36}$/);
      recoveredKey = mutationError.idempotencyKey;
    }

    const row = await client.create(
      { ticket_id: 't_1', status: 'open' },
      { idempotencyKey: recoveredKey },
    );
    expect(row).toEqual({ ticket_id: 't_1', status: 'open' });
    expect(keys).toEqual([recoveredKey, recoveredKey]);
  });

  test('preserves transport status/body and rejects unsafe explicit keys before dispatch', async () => {
    let calls = 0;
    const responseBody = {
      error: 'Outcome unknown',
      code: 'resource-mutation-outcome-unknown',
      requiresSameIdempotencyKey: true,
    };
    const transportError = Object.assign(new Error('Outcome unknown'), {
      status: 503,
      body: responseBody,
    });
    const client = createResourceClient('tickets', {
      async fetch<T = unknown>(): Promise<T> {
        calls += 1;
        throw transportError;
      },
    });

    await expect(client.update('t_1', {}, {
      idempotencyKey: 'safe-replay-key',
    })).rejects.toMatchObject({
      name: 'ResourceMutationError',
      idempotencyKey: 'safe-replay-key',
      status: 503,
      body: responseBody,
      cause: transportError,
    });

    await expect(client.delete('t_1', {
      idempotencyKey: 'contains spaces',
    })).rejects.toThrow('header-safe');
    expect(calls).toBe(1);
  });
});
