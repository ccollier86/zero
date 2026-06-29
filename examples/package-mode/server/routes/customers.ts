/**
 * customers.ts
 *
 * App-owned customer routes for the package-mode fixture. This file owns HTTP
 * validation and request orchestration only; platform services come from the
 * Zero-native endpoint context.
 */

import { t } from 'elysia';
import { defineEndpoint, defineRouter } from '@zero/framework/server';

export default defineRouter({
  name: 'fixture.customers',
  prefix: '/api/customers',
  endpoints: [
    defineEndpoint({
      method: 'GET',
      path: '/health',
      handler: () => ({
        ok: true,
        feature: 'package-mode-routes',
      }),
    }),
    defineEndpoint({
      method: 'POST',
      path: '/',
      auth: 'user',
      body: t.Object({
        name: t.String({ minLength: 1 }),
      }),
      handler: ({ body, user, zero }) => {
        return zero.db.insert('customers', {
          customer_id: crypto.randomUUID(),
          name: body.name,
          owner_id: user.userId,
          created_at: Date.now(),
        }).row;
      },
    }),
  ],
});
