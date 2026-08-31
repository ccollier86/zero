/** HTTP regressions for safe administrator password-gate recovery. */

import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { configureEmail, MemoryEmailProvider } from '../email';
import { createReactiveDB } from '../sync/reactive-db';
import { createAuthMiddleware } from './auth.middleware';
import { createAuthPlugin, getTokenService } from './auth.plugin';

async function requestJson(
  url: string,
  method: string,
  path: string,
  body?: object,
  token?: string,
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
  };
}

async function startAuthApp() {
  const db = createReactiveDB({ mode: 'memory' });
  const app = new Elysia()
    .use(createAuthPlugin({
      db,
      registration: { mode: 'admin-only' },
      accountEmails: { passwordReset: true },
    }))
    .use(createAuthMiddleware(getTokenService));
  app.listen(0);
  return {
    url: `http://localhost:${app.server!.port}`,
    async stop() {
      await app.stop();
      db.dispose();
    },
  };
}

function extractToken(text: string): string {
  const match = text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`No token found in email text: ${text}`);
  return match[1];
}

describe('admin password-change requirement recovery', () => {
  test('gates only after email and explicitly recovers another user', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({ from: 'Zero <noreply@test.com>', provider }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });
    const local = await startAuthApp();

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'recovery-owner',
        email: 'recovery-owner@test.com',
        password: 'password123',
      });
      const adminId = admin.data.user.userId;
      const bearer = admin.data.accessToken;

      const harmlessSelfUpdate = await requestJson(
        local.url,
        'PATCH',
        `/auth/admin/users/${adminId}`,
        { firstName: 'Recovery' },
        bearer,
      );
      expect(harmlessSelfUpdate.status).toBe(200);
      expect(harmlessSelfUpdate.data.user.role).toBe('admin');

      const unsafeCreate = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'recovery-worker',
        email: 'recovery-worker@test.com',
        password: 'oldpassword1',
        passwordChangeRequired: true,
        sendSetupEmail: false,
      }, bearer);
      expect(unsafeCreate.status).toBe(409);
      expect(unsafeCreate.data.code).toBe('PASSWORD_CHANGE_REQUIREMENT_REQUIRES_EMAIL');

      const created = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'recovery-worker',
        email: 'recovery-worker@test.com',
        password: 'oldpassword1',
      }, bearer);
      const targetId = created.data.user.userId;

      const unsafePatch = await requestJson(
        local.url,
        'PATCH',
        `/auth/admin/users/${targetId}`,
        { passwordChangeRequired: true },
        bearer,
      );
      expect(unsafePatch.status).toBe(409);
      expect(unsafePatch.data.code).toBe('PASSWORD_CHANGE_REQUIREMENT_REQUIRES_EMAIL');

      const sent = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${targetId}/send-password-reset`,
        {},
        bearer,
      );
      expect(sent.status).toBe(200);
      expect(provider.messages).toHaveLength(1);
      const resetToken = extractToken(provider.messages[0]!.message.text);

      const gated = await requestJson(
        local.url, 'GET', `/auth/admin/users/${targetId}`, undefined, bearer,
      );
      expect(gated.data.user.passwordChangeRequired).toBe(true);

      const selfClear = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${adminId}/clear-password-change-requirement`,
        {},
        bearer,
      );
      expect(selfClear.status).toBe(400);
      expect(selfClear.data.code).toBe('SELF_ADMIN_TRANSITION_FORBIDDEN');

      const cleared = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${targetId}/clear-password-change-requirement`,
        {},
        bearer,
      );
      expect(cleared.status).toBe(200);
      expect(cleared.data.user.passwordChangeRequired).toBe(false);

      const staleResetLink = await requestJson(
        local.url, 'GET', `/auth/action-token/${resetToken}`,
      );
      expect(staleResetLink.status).toBe(400);
      expect(staleResetLink.data.code).toBe('ACTION_TOKEN_INVALID');

      const login = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'recovery-worker',
        password: 'oldpassword1',
      });
      expect(login.status).toBe(200);

      const redundantClear = await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${targetId}/clear-password-change-requirement`,
        {},
        bearer,
      );
      expect(redundantClear.status).toBe(409);
      expect(redundantClear.data.code).toBe('PASSWORD_CHANGE_NOT_REQUIRED');

      await requestJson(
        local.url,
        'POST',
        `/auth/admin/users/${targetId}/send-password-reset`,
        {},
        bearer,
      );
      const compatibleClear = await requestJson(
        local.url,
        'PATCH',
        `/auth/admin/users/${targetId}`,
        { passwordChangeRequired: false },
        bearer,
      );
      expect(compatibleClear.status).toBe(200);
      expect(compatibleClear.data.user.passwordChangeRequired).toBe(false);
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });
});
