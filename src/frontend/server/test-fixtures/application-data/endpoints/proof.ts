import { defineEndpoint } from '../../../../server';
export default [
  defineEndpoint({ method: 'POST', path: '/proof/seed', auth: 'required', async handler({ zero }) {
    const result = await zero.data!.command('notes.seed', null, { idempotencyKey: 'synthetic:seed' });
    return { value: result.value, replayed: result.replayed, sequence: result.sequence };
  } }),
  defineEndpoint({ method: 'GET', path: '/proof/page', auth: 'required', async handler({ zero }) {
    return (await zero.data!.findPage('notes', { limit: 5, offset: 10, order: [{ field: 'id', direction: 'asc' }] })).value;
  } }),
  defineEndpoint({ method: 'GET', path: '/proof/count', auth: 'required', async handler({ zero }) {
    return (await zero.data!.query('notes.count', null)).value;
  } }),
];
