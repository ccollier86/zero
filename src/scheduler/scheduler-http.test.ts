/** Local Elysia request tests with a synthetic structural verifier, no account/database/server. */

import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { TokenService } from '../auth/token-service';
import { createSchedulerPlugin } from './scheduler.plugin';
import { SchedulerService } from './scheduler-service';

test('HTTP controls distinguish protected busy work from a missing job and still require admin', async () => {
  const scheduler = new SchedulerService();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  scheduler.register({
    name: 'protected', pattern: '@daily', paused: true,
    async run() { calls += 1; await barrier; },
  });
  // The auth middleware explicitly supports this standalone structural-verifier
  // seam; this fixture is not a Guardian store or proof of real token security.
  const verifier = {
    async resolveAuthContext(token: string) {
      return token === 'synthetic-admin'
        ? { userId: 'synthetic-admin', email: 'admin@example.test', role: 'admin' }
        : { userId: 'synthetic-user', email: 'user@example.test', role: 'user' };
    },
  } as unknown as TokenService;
  const app = new Elysia().use(createSchedulerPlugin({
    service: scheduler, getTokenService: () => verifier,
  }));
  const call = (path: string, token?: string) => app.handle(new Request(`http://localhost/scheduler/${path}`, {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }));
  try {
    expect((await call('protected/trigger')).status).toBe(401);
    expect((await call('protected/trigger', 'synthetic-user')).status).toBe(403);
    expect(calls).toBe(0);
    const accepted = await call('protected/trigger', 'synthetic-admin');
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true });
    const busy = await call('protected/trigger', 'synthetic-admin');
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: 'SCHEDULER_JOB_BUSY' });
    expect(calls).toBe(1);
    const missing = await call('missing/trigger', 'synthetic-admin');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'NOT_FOUND' });
  } finally {
    release();
    scheduler.stopAll();
  }
});
