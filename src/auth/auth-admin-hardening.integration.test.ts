/**
 * auth-admin-hardening.integration.test.ts
 *
 * Exercises the administrator security routes as HTTP contracts while keeping
 * the broad legacy auth integration suite unchanged.
 */

import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { configureEmail, MemoryEmailProvider, type EmailProvider } from '../email';
import { createReactiveDB } from '../sync/reactive-db';
import { getActionTokenService, getAuthStore } from './auth-runtime';
import { createAuthPlugin, getTokenService } from './auth.plugin';
import { createAuthMiddleware } from './auth.middleware';
import { MfaChallengeStore } from './mfa-challenge-store';
import { MfaMethodStore } from './mfa-method-store';

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
  return {
    status: response.status,
    data: await response.json().catch(() => null) as any,
    headers: response.headers,
  };
}

async function startAuthApp(config: Omit<Parameters<typeof createAuthPlugin>[0], 'db'> = {}) {
  const db = createReactiveDB({ mode: 'memory' });
  const app = new Elysia()
    .use(createAuthPlugin({ db, ...config }))
    .use(createAuthMiddleware(getTokenService))
    .get('/api/whoami', (context: any) => context.authContext
      ? { userId: context.authContext.userId, role: context.authContext.role }
      : new Response('Unauthorized', { status: 401 }));
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

describe('Auth Plugin — Admin Security Hardening', () => {
  test('guards self transitions, validates properties first, and rejects unavailable MFA', async () => {
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: { passwordReset: true },
      strictUserProperties: true,
      userProperties: {
        department: { type: 'boolean', editableBy: 'admin' },
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'guard-owner',
        email: 'guard-owner@test.com',
        password: 'password123',
      });
      const target = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'guard-worker',
        email: 'guard-worker@test.com',
        password: 'password123',
        firstName: 'Original',
      }, admin.data.accessToken);
      const adminId = admin.data.user.userId;
      const targetId = target.data.user.userId;

      const selfRequests = [
        requestJson(local.url, 'PATCH', `/auth/admin/users/${adminId}`, { role: 'user' }, admin.data.accessToken),
        requestJson(local.url, 'DELETE', `/auth/admin/users/${adminId}`, undefined, admin.data.accessToken),
        requestJson(local.url, 'POST', `/auth/admin/users/${adminId}/suspend`, {}, admin.data.accessToken),
        requestJson(local.url, 'POST', `/auth/admin/users/${adminId}/reset-password`, { password: 'replacement1' }, admin.data.accessToken),
        requestJson(local.url, 'POST', `/auth/admin/users/${adminId}/send-setup-email`, {}, admin.data.accessToken),
        requestJson(local.url, 'POST', `/auth/admin/users/${adminId}/send-password-reset`, {}, admin.data.accessToken),
        requestJson(local.url, 'POST', `/auth/admin/users/${adminId}/mfa/reset`, {}, admin.data.accessToken),
      ];
      for (const response of await Promise.all(selfRequests)) {
        expect(response.status).toBe(400);
        expect(response.data.code).toBe('SELF_ADMIN_TRANSITION_FORBIDDEN');
      }

      const invalidPatch = await requestJson(local.url, 'PATCH', `/auth/admin/users/${targetId}`, {
        firstName: 'Mutated',
        properties: { department: 42 },
      }, admin.data.accessToken);
      expect(invalidPatch.status).toBe(400);
      const unchanged = await requestJson(
        local.url, 'GET', `/auth/admin/users/${targetId}`, undefined, admin.data.accessToken
      );
      expect(unchanged.data.user.firstName).toBe('Original');

      const unavailableCreate = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'mfa-unavailable',
        email: 'mfa-unavailable@test.com',
        password: 'password123',
        mfaRequired: true,
      }, admin.data.accessToken);
      expect(unavailableCreate.status).toBe(409);
      expect(unavailableCreate.data.code).toBe('MFA_NOT_AVAILABLE');
      for (const response of await Promise.all([
        requestJson(local.url, 'PATCH', `/auth/admin/users/${targetId}`, { mfaRequired: true }, admin.data.accessToken),
        requestJson(local.url, 'POST', `/auth/admin/users/${targetId}/mfa/require`, {}, admin.data.accessToken),
      ])) {
        expect(response.status).toBe(409);
        expect(response.data.code).toBe('MFA_NOT_AVAILABLE');
      }

      const manualVerify = await requestJson(
        local.url, 'POST', `/auth/admin/users/${targetId}/verify-email`, {}, admin.data.accessToken
      );
      expect(manualVerify.status).toBe(403);
      expect(manualVerify.data.code).toBe('ADMIN_EMAIL_VERIFICATION_DISABLED');
      const config = await requestJson(local.url, 'GET', '/auth/admin/config', undefined, admin.data.accessToken);
      expect(config.data.capabilities.adminMarkEmailVerified).toBe(false);
    } finally {
      await local.stop();
    }
  });

  test('admin MFA routes summarize, require, clear, and reset methods and challenges', async () => {
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      mfa: {
        enabled: true,
        policy: 'optional',
        methods: ['totp'],
        totp: { encryptionKey: 'admin-mfa-test-key' },
      },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'mfa-admin-owner',
        email: 'mfa-admin-owner@test.com',
        password: 'password123',
      });
      const target = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'mfa-admin-worker',
        email: 'mfa-admin-worker@test.com',
        password: 'password123',
      }, admin.data.accessToken);
      const targetId = target.data.user.userId;
      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'mfa-admin-worker',
        password: 'password123',
      });
      const staleAction = getActionTokenService()!.create({
        userId: targetId,
        type: 'email_verification',
        skipCooldown: true,
      });

      const initial = await requestJson(
        local.url, 'GET', `/auth/admin/users/${targetId}/mfa`, undefined, admin.data.accessToken
      );
      expect(initial.data).toEqual({ methods: [], required: false, requirement: 'none' });
      const required = await requestJson(
        local.url, 'POST', `/auth/admin/users/${targetId}/mfa/require`, {}, admin.data.accessToken
      );
      expect(required.data.user.mfaRequired).toBe(true);
      const revoked = await requestJson(local.url, 'GET', '/api/whoami', undefined, login.data.accessToken);
      expect(revoked.status).toBe(401);
      const revokedAction = await requestJson(
        local.url, 'GET', `/auth/action-token/${staleAction.rawToken}`
      );
      expect(revokedAction.status).toBe(400);
      expect(revokedAction.data.code).toBe('ACTION_TOKEN_INVALID');

      const method = new MfaMethodStore(local.db).createMethod({
        userId: targetId,
        type: 'totp',
        status: 'active',
        isPrimary: true,
      });
      new MfaChallengeStore(local.db).createChallenge({
        userId: targetId,
        methodId: method.methodId,
        methodType: 'totp',
        expiresAt: Date.now() + 60_000,
        maxAttempts: 5,
      });
      const reset = await requestJson(
        local.url, 'POST', `/auth/admin/users/${targetId}/mfa/reset`, {}, admin.data.accessToken
      );
      expect(reset.data).toEqual({ ok: true, deletedMethods: 1, invalidatedChallenges: 1 });
      const selfReset = await requestJson(
        local.url, 'POST', `/auth/admin/users/${admin.data.user.userId}/mfa/reset`, {}, admin.data.accessToken
      );
      expect(selfReset.status).toBe(400);

      const cleared = await requestJson(
        local.url, 'POST', `/auth/admin/users/${targetId}/mfa/clear-requirement`, {}, admin.data.accessToken
      );
      expect(cleared.data.user.mfaRequired).toBe(false);
      const final = await requestJson(
        local.url, 'GET', `/auth/admin/users/${targetId}/mfa`, undefined, admin.data.accessToken
      );
      expect(final.data).toEqual({ methods: [], required: false, requirement: 'none' });
    } finally {
      await local.stop();
    }
  });

  test('admin verification routes expose the gated capability and exact responses', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({ from: 'Zero <noreply@test.com>', provider }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      account: {
        requireEmailVerification: true,
        allowAdminMarkEmailVerified: true,
      },
    });

    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'verify-admin-owner',
        email: 'verify-admin-owner@test.com',
        password: 'password123',
      });
      const owner = registered;
      const target = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'verify-admin-worker',
        email: 'verify-admin-worker@test.com',
        password: 'password123',
      }, owner.data.accessToken);
      const targetId = target.data.user.userId;
      const targetLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'verify-admin-worker',
        password: 'password123',
      });
      const staleAction = getActionTokenService()!.create({
        userId: targetId,
        type: 'email_verification',
        skipCooldown: true,
      });
      const changed = await requestJson(local.url, 'PATCH', `/auth/admin/users/${targetId}`, {
        email: 'verify-admin-worker-new@test.com',
      }, owner.data.accessToken);
      expect(changed.data.user.emailVerifiedAt).toBeNull();
      expect(changed.data.user.emailVerificationRequired).toBe(true);
      const staleBearer = await requestJson(
        local.url, 'GET', '/api/whoami', undefined, targetLogin.data.accessToken
      );
      expect(staleBearer.status).toBe(401);
      const staleLink = await requestJson(
        local.url, 'GET', `/auth/action-token/${staleAction.rawToken}`
      );
      expect(staleLink.status).toBe(400);
      expect(staleLink.data.code).toBe('ACTION_TOKEN_INVALID');

      const config = await requestJson(local.url, 'GET', '/auth/admin/config', undefined, owner.data.accessToken);
      expect(config.data.capabilities.adminMarkEmailVerified).toBe(true);
      const sent = await requestJson(
        local.url, 'POST', `/auth/admin/users/${targetId}/send-verification-email`, {}, owner.data.accessToken
      );
      expect(sent.data).toEqual({ ok: true });
      expect(provider.messages).toHaveLength(1);
      const verified = await requestJson(
        local.url, 'POST', `/auth/admin/users/${targetId}/verify-email`, {}, owner.data.accessToken
      );
      expect(verified.data.user.emailVerificationRequired).toBe(false);
      expect(verified.data.user.emailVerifiedAt).toBeNumber();
      expect(registered.data.accessToken).toBeDefined();
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('failed setup/reset delivery leaves account eligibility and cooldown reusable', async () => {
    const provider: EmailProvider = {
      name: 'always-fails',
      async send() {
        throw new Error('provider unavailable');
      },
    };
    configureEmail({ from: 'Zero <noreply@test.com>', provider }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: { passwordReset: true },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'failure-owner',
        email: 'failure-owner@test.com',
        password: 'password123',
      });
      const target = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'failure-worker',
        email: 'failure-worker@test.com',
        password: 'password123',
      }, admin.data.accessToken);
      const targetId = target.data.user.userId;
      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'failure-worker',
        password: 'password123',
      });

      for (const path of [
        `/auth/admin/users/${targetId}/send-password-reset`,
        `/auth/admin/users/${targetId}/send-password-reset`,
        `/auth/admin/users/${targetId}/send-setup-email`,
      ]) {
        const failed = await requestJson(local.url, 'POST', path, {}, admin.data.accessToken);
        expect(failed.status).toBe(502);
      }
      const user = await requestJson(
        local.url, 'GET', `/auth/admin/users/${targetId}`, undefined, admin.data.accessToken
      );
      expect(user.data.user.passwordChangeRequired).toBe(false);
      const stillAuthorized = await requestJson(
        local.url, 'GET', '/api/whoami', undefined, login.data.accessToken
      );
      expect(stillAuthorized.status).toBe(200);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('resolved recipient rejection leaves the password gate off and revokes the link', async () => {
    let rejectedEmailText = '';
    const provider: EmailProvider = {
      name: 'resolved-rejection',
      async send(message) {
        rejectedEmailText = message.text;
        const recipients = Array.isArray(message.to) ? message.to : [message.to];
        return {
          provider: 'resolved-rejection',
          accepted: [],
          rejected: recipients,
        };
      },
    };
    configureEmail({ from: 'Zero <noreply@test.com>', provider }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: { passwordReset: true },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'rejection-owner',
        email: 'rejection-owner@test.com',
        password: 'password123',
      });
      const target = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'rejection-worker',
        email: 'rejection-worker@test.com',
        password: 'password123',
      }, admin.data.accessToken);
      const targetId = target.data.user.userId;
      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'rejection-worker',
        password: 'password123',
      });

      const failed = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${targetId}/send-password-reset`,
        {},
        admin.data.accessToken
      );
      expect(failed.status).toBe(502);
      expect(failed.data.code).toBe('EMAIL_DELIVERY_REJECTED');

      const user = await requestJson(
        local.url, 'GET', `/auth/admin/users/${targetId}`, undefined, admin.data.accessToken
      );
      expect(user.data.user.passwordChangeRequired).toBe(false);
      const stillAuthorized = await requestJson(
        local.url, 'GET', '/api/whoami', undefined, login.data.accessToken
      );
      expect(stillAuthorized.status).toBe(200);

      const actionUrl = rejectedEmailText
        .split('\n')
        .find((line) => line.startsWith('https://'));
      expect(actionUrl).toBeDefined();
      const rawToken = new URL(actionUrl!).searchParams.get('token');
      expect(rawToken).toBeTruthy();
      const rejectedLink = await requestJson(
        local.url,
        'GET',
        `/auth/action-token/${rawToken}`
      );
      expect(rejectedLink.status).toBe(400);
      expect(rejectedLink.data.code).toBe('ACTION_TOKEN_INVALID');
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('concurrent admin setup/reset sends leave exactly one latest link valid', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({ from: 'Zero <noreply@test.com>', provider }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: { passwordReset: true },
    });

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'concurrent-owner',
        email: 'concurrent-owner@test.com',
        password: 'password123',
      });
      const target = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'concurrent-worker',
        email: 'concurrent-worker@test.com',
        password: 'password123',
      }, admin.data.accessToken);
      const targetId = target.data.user.userId;

      const sends = await Promise.all([
        requestJson(
          local.url,
          'POST',
          `/auth/admin/users/${targetId}/send-setup-email`,
          {},
          admin.data.accessToken
        ),
        requestJson(
          local.url,
          'POST',
          `/auth/admin/users/${targetId}/send-password-reset`,
          {},
          admin.data.accessToken
        ),
      ]);
      expect(sends.map((response) => response.status)).toEqual([200, 200]);
      expect(provider.messages).toHaveLength(2);

      const tokens = provider.messages.map(({ message }) => {
        const actionUrl = message.text
          .split('\n')
          .find((line) => line.startsWith('https://'));
        return new URL(actionUrl!).searchParams.get('token')!;
      });
      const inspections = await Promise.all(tokens.map((token) =>
        requestJson(local.url, 'GET', `/auth/action-token/${token}`)
      ));
      expect(inspections.map((response) => response.status).sort()).toEqual([200, 400]);

      const user = await requestJson(
        local.url, 'GET', `/auth/admin/users/${targetId}`, undefined, admin.data.accessToken
      );
      expect(user.data.user.passwordChangeRequired).toBe(true);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('post-delivery gate failure removes the emailed token before retry', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({ from: 'Zero <noreply@test.com>', provider }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });
    const local = await startAuthApp({
      registration: { mode: 'admin-only' },
      accountEmails: { passwordReset: true },
    });
    let restoreGate: (() => void) | null = null;

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'gate-failure-owner',
        email: 'gate-failure-owner@test.com',
        password: 'password123',
      });
      const target = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'gate-failure-worker',
        email: 'gate-failure-worker@test.com',
        password: 'password123',
      }, admin.data.accessToken);
      const targetId = target.data.user.userId;
      const store = getAuthStore()!;
      const requirePasswordChange = store.requirePasswordChange.bind(store);
      let failNextGate = true;
      store.requirePasswordChange = (userId) => {
        if (failNextGate) {
          failNextGate = false;
          throw new Error('injected gate storage failure');
        }
        return requirePasswordChange(userId);
      };
      restoreGate = () => {
        store.requirePasswordChange = requirePasswordChange;
      };

      const first = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${targetId}/send-password-reset`,
        {},
        admin.data.accessToken
      );
      expect(first.status).toBe(500);
      expect(provider.messages).toHaveLength(1);
      const firstActionUrl = provider.messages[0].message.text
        .split('\n')
        .find((line) => line.startsWith('https://'))!;
      const firstToken = new URL(firstActionUrl).searchParams.get('token')!;
      const rejectedFirst = await requestJson(
        local.url, 'GET', `/auth/action-token/${firstToken}`
      );
      expect(rejectedFirst.status).toBe(400);
      expect(rejectedFirst.data.code).toBe('ACTION_TOKEN_INVALID');

      const retry = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${targetId}/send-password-reset`,
        {},
        admin.data.accessToken
      );
      expect(retry.status).toBe(200);
      expect(provider.messages).toHaveLength(2);
      const retryActionUrl = provider.messages[1].message.text
        .split('\n')
        .find((line) => line.startsWith('https://'))!;
      const retryToken = new URL(retryActionUrl).searchParams.get('token')!;
      const acceptedRetry = await requestJson(
        local.url, 'GET', `/auth/action-token/${retryToken}`
      );
      expect(acceptedRetry.status).toBe(200);
      const stillRejected = await requestJson(
        local.url, 'GET', `/auth/action-token/${firstToken}`
      );
      expect(stillRejected.status).toBe(400);
    } finally {
      restoreGate?.();
      await local.stop();
      configureEmail(false);
    }
  });
});
