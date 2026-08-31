/** HTTP regression coverage for canonical auth email identities. */

import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { configureEmail, MemoryEmailProvider } from '../email';
import { createReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin, getAuthEmailOutbox } from './auth.plugin';

async function startAuthApp() {
  const db = createReactiveDB({ mode: 'memory' });
  const app = new Elysia().use(createAuthPlugin({
    db,
    accountEmails: { passwordReset: true },
  }));
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

async function requestJson(
  url: string,
  method: string,
  path: string,
  body: object,
  token?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  if (path === '/auth/forgot-password') await getAuthEmailOutbox()?.processDue();
  return {
    status: response.status,
    data: await response.json().catch(() => null) as any,
  };
}

describe('Auth Plugin — Canonical Email Identity', () => {
  test('registration stores canonical email and mixed-case whitespace email can log in', async () => {
    const local = await startAuthApp();
    try {
      const registered = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'CaseSensitiveUsername',
        email: '  Login.Person@Example.COM  ',
        password: 'password123',
      });
      expect(registered.status).toBe(200);
      expect(registered.data.user.username).toBe('CaseSensitiveUsername');
      expect(registered.data.user.email).toBe('login.person@example.com');

      const byEmail = await requestJson(local.url, 'POST', '/auth/login', {
        username: '  LOGIN.PERSON@EXAMPLE.COM ',
        password: 'password123',
      });
      expect(byEmail.status).toBe(200);
      expect(byEmail.data.user.userId).toBe(registered.data.user.userId);

      const wrongUsernameCase = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'casesensitiveusername',
        password: 'password123',
      });
      expect(wrongUsernameCase.status).toBe(401);

      const invalid = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'invalid-email',
        email: ' definitely-not-email ',
        password: 'password123',
      });
      expect(invalid.status).toBe(422);
      expect(invalid.data).toEqual({
        error: 'Invalid auth request',
        code: 'AUTH_VALIDATION_FAILED',
      });
    } finally {
      await local.stop();
    }
  });

  test('admin create/update and password recovery use the canonical email', async () => {
    const provider = new MemoryEmailProvider();
    configureEmail({
      from: 'Zero <noreply@test.com>',
      provider,
    }, {
      name: 'Zero Test',
      publicUrl: 'https://app.test',
    });
    const local = await startAuthApp();

    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'email-admin',
        email: ' email-admin@example.com ',
        password: 'password123',
      });
      const created = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'email-worker',
        email: '  New.Worker@Example.COM ',
        password: 'password123',
      }, admin.data.accessToken);
      expect(created.status).toBe(200);
      expect(created.data.user.email).toBe('new.worker@example.com');

      const updated = await requestJson(
        local.url,
        'PATCH',
        `/auth/admin/users/${created.data.user.userId}`,
        { email: '  Updated.Worker@Example.COM ' },
        admin.data.accessToken,
      );
      expect(updated.status).toBe(200);
      expect(updated.data.user.email).toBe('updated.worker@example.com');

      const duplicate = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'email-worker-duplicate',
        email: ' UPDATED.WORKER@example.com ',
        password: 'password123',
      }, admin.data.accessToken);
      expect(duplicate.status).toBe(409);
      expect(duplicate.data.code).toBe('DUPLICATE_EMAIL');

      const forgot = await requestJson(local.url, 'POST', '/auth/forgot-password', {
        email: '  UPDATED.WORKER@EXAMPLE.COM ',
      });
      expect(forgot.status).toBe(200);
      expect(provider.messages).toHaveLength(1);
      expect(provider.messages[0].message.to).toBe('updated.worker@example.com');
    } finally {
      await local.stop();
      configureEmail(false);
    }
  });

  test('email-shaped login resolves only the email namespace', async () => {
    const local = await startAuthApp();
    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'namespace-admin',
        email: 'namespace-admin@example.com',
        password: 'password123',
      });
      await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'shared.identity@example.com',
        email: 'username-owner@example.com',
        password: 'username-password',
      }, admin.data.accessToken);
      const emailOwner = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'email-owner',
        email: 'shared.identity@example.com',
        password: 'email-password',
      }, admin.data.accessToken);

      const shadowAttempt = await requestJson(local.url, 'POST', '/auth/login', {
        username: 'shared.identity@example.com',
        password: 'username-password',
      });
      expect(shadowAttempt.status).toBe(401);

      const emailLogin = await requestJson(local.url, 'POST', '/auth/login', {
        username: ' SHARED.IDENTITY@EXAMPLE.COM ',
        password: 'email-password',
      });
      expect(emailLogin.status).toBe(200);
      expect(emailLogin.data.user.userId).toBe(emailOwner.data.user.userId);
    } finally {
      await local.stop();
    }
  });

  test('legacy canonical email collisions fail closed at login', async () => {
    const local = await startAuthApp();
    try {
      const admin = await requestJson(local.url, 'POST', '/auth/register', {
        username: 'collision-admin',
        email: 'collision-admin@example.com',
        password: 'password123',
      });
      const first = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'collision-one',
        email: 'collision-one@example.com',
        password: 'first-password',
      }, admin.data.accessToken);
      const second = await requestJson(local.url, 'POST', '/auth/admin/users', {
        username: 'collision-two',
        email: 'collision-two@example.com',
        password: 'second-password',
      }, admin.data.accessToken);

      const writeLegacyEmail = local.db.prepare(
        'UPDATE users SET email = ? WHERE user_id = ?'
      );
      writeLegacyEmail.run('Legacy.Login@Example.com', first.data.user.userId);
      writeLegacyEmail.run(' legacy.login@example.com ', second.data.user.userId);

      for (const password of ['first-password', 'second-password']) {
        const login = await requestJson(local.url, 'POST', '/auth/login', {
          username: 'legacy.login@example.com',
          password,
        });
        expect(login.status).toBe(401);
        expect(login.data.code).toBe('INVALID_CREDENTIALS');
      }
    } finally {
      await local.stop();
    }
  });
});
