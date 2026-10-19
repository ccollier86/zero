import { defineEndpoint } from '../../../../server';
import { t } from 'elysia';

export default [
  defineEndpoint({ method: 'POST', path: '/proof/seed', auth: { user: 'required', tenant: 'required' },
    async handler({ zero }) { return (await zero.data!.command('proof.seed', null, { idempotencyKey: 'seed' })).value; } }),
  defineEndpoint({ method: 'POST', path: '/proof/work', auth: { user: 'required', tenant: 'required' },
    body: t.Object({ enteredPath: t.String(), releasePath: t.String(), key: t.String() }),
    async handler({ zero, body }) { return (await zero.data!.command('proof.work', {
      enteredPath: body.enteredPath, releasePath: body.releasePath,
    }, { idempotencyKey: body.key })).value; } }),
  defineEndpoint({ method: 'GET', path: '/proof/counts', auth: { user: 'required', tenant: 'required' },
    async handler({ zero }) { return (await zero.data!.query('proof.counts', null, { consistency: { mode: 'strong' } })).value; } }),
];
