/**
 * server-route.test.ts
 *
 * Verifies the app-owned server route factory. The factory should expose typed
 * Zero service helpers to route handlers without making route modules import
 * individual platform singletons for common cases.
 */

import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createSyncPlugin } from '../../sync';
import { createServerRoute } from './server-route';

describe('createServerRoute', () => {
  test('exposes ReactiveDB through zero service context', async () => {
    const app = new Elysia()
      .use(createSyncPlugin({
        db: { mode: 'memory' },
        tables: {
          customers: {
            customer_id: 'text primary key',
            name: 'text not null',
          },
        },
      }))
      .use(
        createServerRoute({ name: 'test.customers', prefix: '/api/customers' })
          .post('/', ({ body, zero }) => {
            expect(zero.db).toBe(zero.syncDB);

            const change = zero.db.insert('customers', {
              customer_id: 'cust_1',
              name: (body as { name: string }).name,
            });

            return change.row;
          })
      );

    const response = await app.handle(new Request('http://localhost/api/customers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      customer_id: 'cust_1',
      name: 'Ada',
    });
  });
});
