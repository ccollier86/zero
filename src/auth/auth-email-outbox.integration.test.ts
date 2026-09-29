import { Elysia } from 'elysia';
import { expect, test } from 'bun:test';
import { configureEmail, type EmailMessage, type EmailProvider, type EmailSendResult } from '../email';
import { resetEmailCompatibilityRuntimeForTesting } from '../email/runtime';
import { createReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin, getAuthEmailOutbox } from './auth.plugin';

test('forgot-password returns generically without awaiting provider delivery', async () => {
  let release!: () => void;
  let started!: () => void;
  const providerStarted = new Promise<void>((resolve) => { started = resolve; });
  const providerReleased = new Promise<void>((resolve) => { release = resolve; });
  const messages: EmailMessage[] = [];
  const provider: EmailProvider = {
    name: 'blocking',
    async send(message): Promise<EmailSendResult> {
      messages.push(message); started(); await providerReleased;
      const accepted = Array.isArray(message.to) ? message.to : [message.to];
      return { provider: this.name, accepted };
    },
  };
  configureEmail({ from: 'Zero <noreply@test.com>', provider }, {
    name: 'Zero', publicUrl: 'https://app.test',
  });
  const db = createReactiveDB({ mode: 'memory' });
  const app = new Elysia().use(createAuthPlugin({ db, bootstrap: 'public' }));
  app.listen(0);
  const url = `http://localhost:${app.server!.port}`;

  try {
    const registered = await post(url, '/auth/register', {
      username: 'outbox-user', email: 'outbox-user@test.com', password: 'password123',
    });
    expect(registered.status).toBe(200);

    const reset = await Promise.race([
      post(url, '/auth/forgot-password', { email: 'outbox-user@test.com' }),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('forgot-password awaited the provider')), 1_000
      )),
    ]);
    expect(reset).toEqual({ status: 200, data: { ok: true } });
    await providerStarted;
    release();
    await getAuthEmailOutbox()?.processDue();
    expect(messages).toHaveLength(1);

    const unknown = await post(url, '/auth/forgot-password', { email: 'missing@test.com' });
    await getAuthEmailOutbox()?.processDue();
    expect(unknown).toEqual(reset);
    expect(messages).toHaveLength(1);
    const retained = db.prepare(`SELECT COUNT(*) AS count FROM _auth_email_outbox
      WHERE recipient <> ''`).get() as { count: number };
    expect(retained.count).toBe(0);

    await getAuthEmailOutbox()?.stop();
    const insert = db.prepare(`INSERT INTO _auth_email_outbox
      (job_id, kind, recipient, recipient_hash, status, attempts,
       available_at, created_at, updated_at)
      VALUES (?, 'password_reset', ?, ?, 'pending', 0, ?, ?, ?)`);
    db.transaction(() => Array.from({ length: 5_000 }, (_, index) => {
      const now = Date.now();
      insert.run(`capacity-${index}`, `capacity-${index}@test.com`, `hash-${index}`,
        now, now, now);
    }));
    const capacity = await post(url, '/auth/forgot-password', { email: 'capacity@test.com' });
    expect(capacity).toEqual(reset);
  } finally {
    await app.stop(); db.dispose(); resetEmailCompatibilityRuntimeForTesting();
  }
});

async function post(url: string, path: string, body: object) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
