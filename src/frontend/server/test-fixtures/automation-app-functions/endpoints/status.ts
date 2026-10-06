/** Authenticated fixture-only projection of a source-local delivery acknowledgment. */
import { t } from 'elysia';
import { defineEndpoint } from '../../../../server';

export default defineEndpoint({
  method: 'GET', path: '/proof/function-jobs/:id',
  auth: { user: 'required', tenant: 'required' },
  params: t.Object({ id: t.String() }),
  async handler({ zero, params }) {
    if (!zero.data) throw new Error('The bound data capability is unavailable.');
    return (await zero.data.query('proof.delivery', params.id, { consistency: { mode: 'strong' } })).value;
  },
});
