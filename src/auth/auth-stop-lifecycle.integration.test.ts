import { afterEach, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { configureEmail, type EmailProvider } from '../email';
import {
  configureObservability,
  getObservabilityRuntime,
  MemoryEventStore,
  OBS_CODES,
} from '../observability';
import { createReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin, getAuthEmailOutbox, getAuthStore } from './auth.plugin';
import { installAuthStopBarrier } from './auth-stop-lifecycle';

afterEach(() => configureEmail(false));

test('standalone auth stop joins delivery before its caller disposes the database', async () => {
  const previousObservability = getObservabilityRuntime().config;
  const events = new MemoryEventStore();
  configureObservability({ console: false, store: events });
  let startedDelivery!: () => void;
  const started = new Promise<void>((resolve) => { startedDelivery = resolve; });
  let aborts = 0;
  const provider: EmailProvider = {
    name: 'standalone-shutdown-probe',
    send(message) {
      startedDelivery();
      message.signal?.addEventListener('abort', () => { aborts += 1; }, { once: true });
      return new Promise<never>(() => undefined);
    },
  };
  configureEmail({ from: 'Zero <noreply@test.com>', provider }, {
    name: 'Zero', publicUrl: 'https://app.test',
  });
  const db = createReactiveDB({ mode: 'memory' });
  const app = installAuthStopBarrier(installAuthStopBarrier(
    new Elysia().use(createAuthPlugin({ db }))
  ));
  let disposed = false;
  try {
    app.listen(0);
    const response = await fetch(`http://localhost:${app.server!.port}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'standalone-stop', email: 'standalone-stop@test.com',
        password: 'password123',
      }),
    });
    expect(response.status).toBe(200);
    getAuthEmailOutbox()!.enqueue({
      kind: 'password_reset', recipient: 'standalone-stop@test.com',
    });
    await started;

    await Promise.all([app.stop(), app.stop()]);

    expect(aborts).toBe(1);
    expect(getAuthStore()).toBeNull();
    expect(getAuthEmailOutbox()).toBeNull();
    expect(db.prepare(`SELECT status, attempts FROM _auth_email_outbox`).get())
      .toEqual({ status: 'pending', attempts: 0 });
    const activeTokens = db.prepare(
      `SELECT COUNT(*) AS count FROM _auth_action_tokens`
    ).get() as { count: number };
    expect(activeTokens.count).toBe(0);
    expect(events.query({ code: OBS_CODES.AUTH_EMAIL_OUTBOX_WORKER_FAILED.code }).events)
      .toHaveLength(0);
    db.dispose();
    disposed = true;
  } finally {
    await app.stop();
    if (!disposed) db.dispose();
    configureObservability(previousObservability);
  }
});
