/** Managed Guardian/outbox delivery and receiving lifecycle through the real mail adapters. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PostalMime from 'postal-mime';
import { getEmailRuntime, isEmailDeliveryReady } from '../../email';
import { smtpFixture } from '../../email/test-support/smtp-fixture';
import { imapFixture } from '../../email/test-support/imap-fixture';
import { createApp } from './app-factory';

test('managed Guardian uses SMTP for account setup/reset and stops its active IMAP subscriptions', async () => {
  const root = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-managed-mail-'));
  const smtp = await smtpFixture(), imap = await imapFixture();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({
      db: { mode: 'memory' }, systemDb: { mode: 'memory' }, tables: {},
      app: { name: 'Managed mail test', publicUrl: 'https://app.example.test' },
      auth: { bootstrap: 'public', registration: { mode: 'admin-only' },
        accountEmails: { accountSetupTokenTTL: '48h', passwordResetTokenTTL: '1h' },
      },
      email: { provider: 'smtp', smtp: smtp.config, from: 'Managed test <sender@example.test>', imap: imap.config },
      appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
      workflows: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false,
      observability: { console: false, endpoint: false },
    });
    const runtime = getEmailRuntime(); expect(isEmailDeliveryReady(runtime)).toBe(true);
    const live = runtime.mailbox!.watch()[Symbol.asyncIterator]();
    expect((await live.next()).value).toMatchObject({ type: 'resync', reason: 'connected' });
    await imap.ready();
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${app.server!.port}`;
    const post = async (path: string, body: object, bearer?: string) => {
      const response = await fetch(origin + path, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() as any };
    };
    const owner = await post('/auth/register', { username: 'mail-owner', email: 'owner@example.test', password: 'Only-test-password-123' });
    expect(owner.status).toBe(200);
    const before = Date.now();
    const account = await post('/auth/admin/users', { username: 'mail-member', email: 'member@example.test', sendSetupEmail: true }, owner.data.accessToken);
    expect(account.status).toBe(200); expect(smtp.messages).toHaveLength(1);
    const setup = await PostalMime.parse(smtp.messages[0]!);
    expect(setup.to?.[0]?.address).toBe('member@example.test');
    const setupToken = setup.text?.match(/token=([A-Za-z0-9_-]+)/)?.[1]; expect(setupToken).toBeString();
    const proof = await fetch(`${origin}/auth/action-token/${setupToken}`).then(response => response.json()) as any;
    expect(proof.type).toBe('account_setup'); expect(proof.expiresAt).toBeGreaterThanOrEqual(before + 48 * 3_600_000);
    const created = await post('/auth/admin/users', { username: 'mail-reset', email: 'reset@example.test', password: 'Only-test-password-456' }, owner.data.accessToken);
    expect(created.status).toBe(200);
    expect((await post('/auth/forgot-password', { email: 'reset@example.test' })).data).toEqual({ ok: true });
    const deadline = performance.now() + 5000;
    while (smtp.messages.length < 2 && performance.now() < deadline) await Bun.sleep(10);
    expect(smtp.messages).toHaveLength(2);
    const reset = await PostalMime.parse(smtp.messages[1]!);
    const resetToken = reset.text?.match(/token=([A-Za-z0-9_-]+)/)?.[1]; expect(resetToken).toBeString();
    const resetProof = await fetch(`${origin}/auth/action-token/${resetToken}`).then(response => response.json()) as any;
    expect(resetProof.type).toBe('password_reset'); expect(resetProof.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);

    const pending = live.next();
    await app.stop(true); app = undefined;
    expect((await pending).done).toBe(true); expect(runtime.mailbox!.isConfigured()).toBe(false);
    expect(isEmailDeliveryReady(runtime)).toBe(false);
    await expect(runtime.service.send({ to: 'receiver@example.test', subject: 'Stopped', text: 'No delivery' })).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_ABORTED' });
    expect(smtp.messages).toHaveLength(2);
  } finally {
    try { await app?.stop(true); } finally { await smtp.close(); await imap.close(); await rm(root, { recursive: true, force: true }); }
  }
}, 30_000);
