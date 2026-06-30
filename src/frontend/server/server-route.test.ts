/**
 * server-route.test.ts
 *
 * Verifies the app-owned server route factory. The factory should expose typed
 * Zero service helpers to route handlers without making route modules import
 * individual platform singletons for common cases.
 */

import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { getEmailService } from '../../email';
import { clearPlatformSQLiteService, getPlatformSQLiteService } from '../../persistence';
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
            expect(zero.sql).toBe(zero.db.getSQLiteService());
            expect(zero.sqlite).toBe(zero.sql);
            expect(zero.vector).toBe(zero.vectors);
            expect(zero.auth.store).toBe(zero.auth.userStore);
            expect(zero.auth.tokens).toBe(zero.auth.tokenService);
            expect(zero.auth.getTokenService()).toBe(zero.auth.tokenService);
            expect(zero.tokens).toBeNull();
            expect(zero.email).toBe(getEmailService());
            expect(zero.observability.runtime).toBe(zero.observability.getRuntime());
            expect(zero.observability.sink).toBe(zero.observability.getSink());
            expect(zero.observability.store).toBe(zero.observability.getStore());

            const change = zero.db.insert('customers', {
              customer_id: 'cust_1',
              name: (body as { name: string }).name,
            });

            return change.row;
          })
      );

    try {
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
    } finally {
      const service = getPlatformSQLiteService();
      service?.close();
      clearPlatformSQLiteService(service);
    }
  });
});
