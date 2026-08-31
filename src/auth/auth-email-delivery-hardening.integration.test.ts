/**
 * auth-email-delivery-hardening.integration.test.ts
 *
 * Verifies that failed auth-email sends do not strand accounts, poison action
 * token cooldowns, or leave MFA challenges active when no code was delivered.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  configureEmail,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from '../email';
import { createReactiveDB } from '../sync/reactive-db';
import { getActionTokenService } from './auth-runtime';
import { createAuthPlugin, getAuthEmailOutbox, getTokenService } from './auth.plugin';
import { createAuthMiddleware } from './auth.middleware';
import type { AuthPluginConfig } from './types';

class FlakyEmailProvider implements EmailProvider {
  readonly name = 'flaky-test';
  readonly messages: EmailMessage[] = [];
  failuresRemaining = 0;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('Simulated email delivery failure');
    }
    this.messages.push(message);
    const accepted = Array.isArray(message.to) ? message.to : [message.to];
    return { provider: this.name, accepted };
  }
}

afterEach(() => {
  configureEmail(false);
});

describe('Auth email delivery hardening', () => {
  test('failed registration verification removes the account and permits a clean retry', async () => {
    const provider = configureFlakyEmail();
    const local = await startAuthApp({
      registration: { mode: 'public' },
      account: { requireEmailVerification: true },
    });

    try {
      await registerAdmin(local.url, 'verification-register-owner');
      provider.failuresRemaining = 1;

      const failed = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verification-register-worker',
        email: 'verification-register-worker@test.com',
        password: 'password123',
      });
      expect(failed.status).toBe(502);
      expect(countRows(
        local.db,
        "SELECT COUNT(*) AS count FROM users WHERE email = 'verification-register-worker@test.com'"
      )).toBe(0);

      const retried = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verification-register-worker',
        email: 'verification-register-worker@test.com',
        password: 'password123',
      });
      expect(retried.status).toBe(200);
      expect(retried.data.user.emailVerificationRequired).toBe(true);
      expect(provider.messages).toHaveLength(1);
      expect(extractActionUrl(provider.messages[0].text).searchParams.get('redirect'))
        .toBeNull();
    } finally {
      await local.stop();
    }
  });

  test('registration token provisioning failure rolls back the gated account', async () => {
    const provider = configureFlakyEmail();
    const local = await startAuthApp({
      registration: { mode: 'public' },
      account: { requireEmailVerification: true },
    });

    try {
      await registerAdmin(local.url, 'verification-token-owner');
      const actionTokens = getActionTokenService()!;
      const create = actionTokens.create.bind(actionTokens);
      let failProvisioning = true;
      actionTokens.create = ((input) => {
        if (failProvisioning && input.type === 'email_verification') {
          failProvisioning = false;
          throw new Error('Simulated token persistence failure');
        }
        return create(input);
      }) as typeof actionTokens.create;

      const failed = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verification-token-worker',
        email: 'verification-token-worker@test.com',
        password: 'password123',
      });
      expect(failed.status).toBe(500);
      expect(countRows(
        local.db,
        "SELECT COUNT(*) AS count FROM users WHERE email = 'verification-token-worker@test.com'"
      )).toBe(0);
      expect(countRows(local.db, 'SELECT COUNT(*) AS count FROM _auth_registration_intents'))
        .toBe(0);
      expect(provider.messages).toHaveLength(0);

      const retried = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verification-token-worker',
        email: 'verification-token-worker@test.com',
        password: 'password123',
      });
      expect(retried.status).toBe(200);
      expect(provider.messages).toHaveLength(1);
    } finally {
      await local.stop();
    }
  });

  test('admin setup delivery failure removes the newly created account and permits a clean retry', async () => {
    const provider = configureFlakyEmail();
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: { adminCreatedUser: true },
    });

    try {
      const admin = await registerAdmin(local.url, 'setup-rollback-owner');
      provider.failuresRemaining = 1;

      const failed = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'setup-rollback-worker',
          email: 'setup-rollback-worker@test.com',
          sendSetupEmail: true,
        },
        admin.data.accessToken
      );

      expect(failed.status).toBe(502);
      expect(countRows(
        local.db,
        "SELECT COUNT(*) AS count FROM users WHERE email = 'setup-rollback-worker@test.com'"
      )).toBe(0);

      const retried = await requestJson(
        local.url,
        'POST',
        '/auth/admin/users',
        {
          username: 'setup-rollback-worker',
          email: 'setup-rollback-worker@test.com',
          sendSetupEmail: true,
        },
        admin.data.accessToken
      );

      expect(retried.status).toBe(200);
      expect(retried.data.setupEmailSent).toBe(true);
      expect(retried.data.user.passwordChangeRequired).toBe(true);
      expect(provider.messages).toHaveLength(1);
    } finally {
      await local.stop();
    }
  });

  test('failed verification resend discards its token and retries durably', async () => {
    const provider = configureFlakyEmail();
    const local = await startAuthApp({
      account: { requireEmailVerification: true },
      accountEmails: { requestCooldown: '5m' },
    });

    try {
      await registerAdmin(local.url, 'verification-resend-owner');
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verification-resend-worker',
        email: 'verification-resend-worker@test.com',
        password: 'password123',
      });
      expect(registered.status).toBe(200);
      expect(provider.messages).toHaveLength(1);

      const registrationToken = extractActionToken(provider.messages[0].text);
      getActionTokenService()!.consume(registrationToken, ['email_verification']);
      provider.messages.length = 0;
      provider.failuresRemaining = 1;

      const failed = await requestJson(local.url, 'POST', '/auth/resend-verification', {
        email: 'verification-resend-worker@test.com',
      });
      const retried = await requestJson(local.url, 'POST', '/auth/resend-verification', {
        email: 'verification-resend-worker@test.com',
      });

      expect(failed.status).toBe(200);
      expect(failed.data).toEqual({ ok: true });
      expect(retried.status).toBe(200);
      await waitUntil(() => provider.messages.length === 1);
      expect(provider.messages).toHaveLength(1);
    } finally {
      await local.stop();
    }
  });

  test('verification resend preserves an optional MFA enrollment request', async () => {
    const provider = configureFlakyEmail();
    const local = await startAuthApp({
      account: { requireEmailVerification: true },
      accountEmails: { requestCooldown: '0s' },
      mfa: { enabled: true, policy: 'optional', methods: ['totp'] },
    });
    try {
      await registerAdmin(local.url, 'verification-mfa-owner');
      await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verification-mfa-worker',
        email: 'verification-mfa-worker@test.com',
        password: 'password123',
        mfaEnrollment: true,
      });
      getActionTokenService()!.consume(
        extractActionToken(provider.messages[0]!.text), ['email_verification'],
      );
      provider.messages.length = 0;
      await requestJson(local.url, 'POST', '/auth/resend-verification', {
        email: 'verification-mfa-worker@test.com',
        mfaEnrollment: true,
      });
      const verified = await requestJson(local.url, 'POST', '/auth/verify-email', {
        token: extractActionToken(provider.messages[0]!.text),
      });
      expect(verified.status).toBe(200);
      expect(verified.data.mfaSetupRequired).toBe(true);
      expect(verified.data.mfaSetupToken).toBeString();
      expect(verified.data.accessToken).toBeUndefined();
      expect(countRows(
        local.db, 'SELECT COUNT(*) AS count FROM _auth_registration_intents'
      )).toBe(0);
    } finally {
      await local.stop();
    }
  });

  test('verification resend cannot escalate a victim into optional MFA enrollment', async () => {
    const provider = configureFlakyEmail();
    const local = await startAuthApp({
      account: { requireEmailVerification: true },
      accountEmails: { requestCooldown: '0s' },
      mfa: { enabled: true, policy: 'optional', methods: ['totp'] },
    });
    try {
      await registerAdmin(local.url, 'verification-mfa-victim-owner');
      await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verification-mfa-victim',
        email: 'verification-mfa-victim@test.com',
        password: 'password123',
      });
      getActionTokenService()!.consume(
        extractActionToken(provider.messages[0]!.text), ['email_verification'],
      );
      provider.messages.length = 0;
      await requestJson(local.url, 'POST', '/auth/resend-verification', {
        email: 'verification-mfa-victim@test.com',
        mfaEnrollment: true,
      });
      const verified = await requestJson(local.url, 'POST', '/auth/verify-email', {
        token: extractActionToken(provider.messages[0]!.text),
      });
      expect(verified.status).toBe(200);
      expect(verified.data.mfaSetupRequired).toBeUndefined();
      expect(verified.data.mfaSetupToken).toBeUndefined();
      expect(verified.data.accessToken).toBeString();
    } finally {
      await local.stop();
    }
  });

  test('using one verification link invalidates every sibling link', async () => {
    const provider = configureFlakyEmail();
    const local = await startAuthApp({
      account: { requireEmailVerification: true },
      accountEmails: { requestCooldown: '0s' },
    });
    try {
      await registerAdmin(local.url, 'verification-sibling-owner');
      await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verification-sibling-user',
        email: 'verification-sibling-user@test.com',
        password: 'password123',
      });
      const first = extractActionToken(provider.messages[0]!.text);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await requestJson(local.url, 'POST', '/auth/resend-verification', {
        email: 'verification-sibling-user@test.com',
      });
      const sibling = extractActionToken(provider.messages[1]!.text);

      const verified = await requestJson(local.url, 'POST', '/auth/verify-email', {
        token: first,
      });
      expect(verified.status).toBe(200);
      expect(verified.data.accessToken).toBeString();
      const refreshCount = countRows(local.db,
        'SELECT COUNT(*) AS count FROM _refresh_tokens');

      const replayedSibling = await requestJson(local.url, 'POST', '/auth/verify-email', {
        token: sibling,
      });
      expect(replayedSibling).toMatchObject({
        status: 400,
        data: { code: 'ACTION_TOKEN_INVALID' },
      });
      expect(countRows(local.db,
        'SELECT COUNT(*) AS count FROM _refresh_tokens')).toBe(refreshCount);
    } finally {
      await local.stop();
    }
  });

  test('failed MFA email delivery invalidates the challenge and allows an immediate retry', async () => {
    const provider = configureFlakyEmail(false);
    const local = await startAuthApp({
      mfa: {
        enabled: true,
        policy: 'optional',
        methods: ['email'],
        challengeCooldown: '5m',
      },
    });

    try {
      const admin = await registerAdmin(local.url, 'mfa-delivery-owner');
      provider.failuresRemaining = 1;

      const failed = await requestJson(
        local.url,
        'POST',
        '/auth/mfa/setup',
        { method: 'email' },
        admin.data.accessToken
      );
      expect(failed.status).toBe(502);
      expect(countRows(
        local.db,
        'SELECT COUNT(*) AS count FROM _auth_mfa_challenges WHERE consumed_at IS NULL'
      )).toBe(0);
      expect(countRows(
        local.db,
        "SELECT COUNT(*) AS count FROM _auth_mfa_methods WHERE status = 'pending'"
      )).toBe(0);

      const retried = await requestJson(
        local.url,
        'POST',
        '/auth/mfa/setup',
        { method: 'email' },
        admin.data.accessToken
      );
      expect(retried.status).toBe(200);
      expect(retried.data.challenge.delivery).toBe('email');
      expect(provider.messages).toHaveLength(1);
      expect(countRows(
        local.db,
        'SELECT COUNT(*) AS count FROM _auth_mfa_challenges WHERE consumed_at IS NULL'
      )).toBe(1);
    } finally {
      await local.stop();
    }
  });
});

function configureFlakyEmail(publicUrl = true): FlakyEmailProvider {
  const provider = new FlakyEmailProvider();
  configureEmail(
    { from: 'Zero <noreply@test.com>', provider },
    { name: 'Zero Test', publicUrl: publicUrl ? 'https://app.test' : undefined }
  );
  return provider;
}

async function startAuthApp(config: Omit<AuthPluginConfig, 'db'>) {
  const db = createReactiveDB({ mode: 'memory' });
  const app = new Elysia()
    .use(createAuthPlugin({ db, ...config }))
    .use(createAuthMiddleware(getTokenService));
  app.listen(0);
  return {
    db,
    url: `http://localhost:${app.server!.port}`,
    async stop() {
      await app.stop();
      db.dispose();
    },
  };
}

function registerAdmin(url: string, username: string) {
  return requestJson(url, 'POST', '/auth/register', {
    username,
    email: `${username}@test.com`,
    password: 'password123',
  });
}

async function requestJson(
  url: string,
  method: string,
  path: string,
  body?: object,
  token?: string
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (path === '/auth/forgot-password' || path === '/auth/resend-verification') {
    await getAuthEmailOutbox()?.processDue();
  }
  return {
    status: response.status,
    data: await response.json().catch(() => null) as any,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for auth email retry');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function extractActionToken(text: string): string {
  const token = extractActionUrl(text).searchParams.get('token');
  if (!token) throw new Error('Expected action token in email URL');
  return token;
}

function extractActionUrl(text: string): URL {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) throw new Error('Expected action URL in email');
  return new URL(match[0]);
}

function countRows(
  db: ReturnType<typeof createReactiveDB>,
  sql: string
): number {
  const row = db.prepare(sql).get() as { count: number };
  return row.count;
}
