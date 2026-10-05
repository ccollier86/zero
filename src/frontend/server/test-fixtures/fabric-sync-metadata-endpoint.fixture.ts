/** Authenticated proof-only endpoint using public request-bound Fabric services. */

import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'GET',
  path: '/proof/actor',
  auth: { user: 'required', tenant: 'required', permission: 'proof:read' },
  async handler({ zero }) {
    if (!zero.data || !zero.unsafe.databases) throw new Error('Proof Fabric services unavailable.');
    const result = await zero.data.query('proof.inspect', null, { consistency: { mode: 'strong' } });
    return {
      tables: result.value,
      manager: zero.unsafe.databases.diagnostics(),
    };
  },
});
