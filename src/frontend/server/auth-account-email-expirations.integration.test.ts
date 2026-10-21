/** Independent setup/reset expiry must reach the managed runtime, email and HTTP proof. */

import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEmailProvider } from '../../email';
import type { AuthEmailTemplate } from '../../auth/auth-email-templates';
import { createApp } from './app-factory';

test('managed setup links last 48 hours while public and admin resets last 1 hour', async () => {
  const root = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-email-expirations-'));
  const provider = new MemoryEmailProvider();
  const rendered: Array<{ type: string | undefined; expiresAt: number | undefined }> = [];
  const template: AuthEmailTemplate = context => {
    rendered.push({ type: context.tokenType, expiresAt: context.expiresAt });
    return { subject: context.defaultSubject, text: context.defaultText, html: context.defaultHtml };
  };
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({
      db: { mode: 'memory' }, systemDb: { mode: 'memory' }, tables: {},
      app: { name: 'Expiry Test', publicUrl: 'https://app.example.test' },
      auth: {
        bootstrap: 'public', registration: { mode: 'admin-only' },
        accountEmails: {
          actionTokenTTL: '2h', accountSetupTokenTTL: '48h', passwordResetTokenTTL: '1h',
        },
        emails: { accountSetup: template, passwordReset: template },
      },
      email: { from: 'Expiry Test <noreply@example.test>', provider },
      appDir: join(root, 'app'), outDir: join(root, 'out'),
      generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
      serverEndpointsDir: false, serverRoutesDir: false,
      workflows: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false,
      observability: { console: false, endpoint: false },
    });
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${app.server!.port}`;
    const request = async (method: string, path: string, body?: object, bearer?: string) => {
      const response = await fetch(origin + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() as any };
    };
    const admin = await request('POST', '/auth/register', {
      username: 'expiry-owner', email: 'expiry-owner@example.test', password: 'Only-test-password-123',
    });
    expect(admin.status).toBe(200);
    const bearer = admin.data.accessToken;
    const config = await request('GET', '/auth/admin/config', undefined, bearer);
    expect(config.status).toBe(200);
    expect(config.data.accountEmails).toMatchObject({
      actionTokenTTL: '2h', accountSetupTokenTTL: '48h', passwordResetTokenTTL: '1h',
    });

    const beforeSetup = Date.now();
    const setup = await request('POST', '/auth/admin/users', {
      username: 'expiry-setup', email: 'expiry-setup@example.test', sendSetupEmail: true,
    }, bearer);
    expect(setup.status).toBe(200);
    const afterSetup = Date.now();
    expect(provider.messages).toHaveLength(1);
    const setupToken = tokenFrom(provider.messages[0]!.message.text);
    const setupProof = await request('GET', `/auth/action-token/${setupToken}`);
    expect(setupProof.status).toBe(200);
    expect(setupProof.data.type).toBe('account_setup');
    expect(setupProof.data.expiresAt).toBeGreaterThanOrEqual(beforeSetup + 48 * 3_600_000);
    expect(setupProof.data.expiresAt).toBeLessThanOrEqual(afterSetup + 48 * 3_600_000);

    const target = await request('POST', '/auth/admin/users', {
      username: 'expiry-reset', email: 'expiry-reset@example.test', password: 'Only-test-password-456',
    }, bearer);
    expect(target.status).toBe(200);
    const beforeReset = Date.now();
    const reset = await request('POST', `/auth/admin/users/${target.data.user.userId}/send-password-reset`, {}, bearer);
    expect(reset.status).toBe(200);
    const afterReset = Date.now();
    expect(provider.messages).toHaveLength(2);
    const adminToken = tokenFrom(provider.messages[1]!.message.text);
    const adminProof = await request('GET', `/auth/action-token/${adminToken}`);
    expect(adminProof.status).toBe(200);
    expect(adminProof.data.type).toBe('admin_password_reset');
    expect(adminProof.data.expiresAt).toBeGreaterThanOrEqual(beforeReset + 3_600_000);
    expect(adminProof.data.expiresAt).toBeLessThanOrEqual(afterReset + 3_600_000);

    const beforeForgot = Date.now();
    const forgot = await request('POST', '/auth/forgot-password', { email: 'expiry-reset@example.test' });
    expect(forgot.status).toBe(200);
    expect(forgot.data).toEqual({ ok: true });
    const deadline = performance.now() + 10_000;
    while (provider.messages.length < 3 && performance.now() < deadline) await Bun.sleep(10);
    expect(provider.messages).toHaveLength(3);
    const publicToken = tokenFrom(provider.messages[2]!.message.text);
    const publicProof = await request('GET', `/auth/action-token/${publicToken}`);
    expect(publicProof.status).toBe(200);
    expect(publicProof.data.type).toBe('password_reset');
    expect(publicProof.data.expiresAt).toBeGreaterThanOrEqual(beforeForgot + 3_600_000);
    expect(publicProof.data.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(rendered).toEqual([
      { type: 'account_setup', expiresAt: setupProof.data.expiresAt },
      { type: 'admin_password_reset', expiresAt: adminProof.data.expiresAt },
      { type: 'password_reset', expiresAt: publicProof.data.expiresAt },
    ]);

    // A longer setup lifetime must not change which endpoint accepts the proof.
    expect((await request('POST', '/auth/reset-password', {
      token: setupToken, newPassword: 'Only-test-new-password-123',
    })).status).toBe(400);
    expect((await request('POST', '/auth/setup-password', {
      token: setupToken, newPassword: 'Only-test-new-password-123',
    })).status).toBe(200);
    expect((await request('POST', '/auth/setup-password', {
      token: setupToken, newPassword: 'Only-test-new-password-456',
    })).status).toBe(400);
  } finally {
    try { await app?.stop(true); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
}, 30_000);

function tokenFrom(text: string): string {
  const token = text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('Expected a one-time link in the test email');
  return token;
}
