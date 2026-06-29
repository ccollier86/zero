/**
 * customers.ts
 *
 * App-owned Elysia routes for the package-mode fixture. This file owns HTTP
 * validation and request orchestration only; platform services come from the
 * `zero` route context provided by createServerRoute().
 */

import { t } from 'elysia';
import { createServerRoute } from '@zero/framework/server';

export default createServerRoute({ name: 'fixture.customers', prefix: '/api/customers' })
  .get('/health', () => ({
    ok: true,
    feature: 'package-mode-routes',
  }))
  .post(
    '/',
    ({ body, requireAuth, zero }) => {
      const user = requireAuth();

      return zero.syncDB.insert('customers', {
        customer_id: crypto.randomUUID(),
        name: body.name,
        owner_id: user.userId,
        created_at: Date.now(),
      }).row;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
      }),
    }
  );
