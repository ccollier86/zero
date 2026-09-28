import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin, getAuthStore } from './auth.plugin';
import type { AuthRegistrationMode } from './types';

interface RegistrationResult {
  status: number;
  body: {
    code?: string;
    user?: { role: string };
  };
}

let active: { app: any; db: ReactiveDB } | null = null;

afterEach(async () => {
  if (!active) return;
  await active.app.stop();
  active.db.dispose();
  active = null;
});

async function start(mode: AuthRegistrationMode) {
  const db = createReactiveDB({ mode: 'memory' });
  const app = new Elysia().use(createAuthPlugin({
    db,
    bootstrap: 'public',
    registration: { mode },
  }));
  app.listen(0);
  active = { app, db };
  return `http://localhost:${app.server!.port}`;
}

async function register(baseUrl: string, index: number): Promise<RegistrationResult> {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `concurrent-${index}`,
      email: `concurrent-${index}@example.test`,
      password: 'password123',
    }),
  });
  return { status: response.status, body: await response.json() as RegistrationResult['body'] };
}

describe('concurrent first-user registration', () => {
  test('explicit public bootstrap creates one admin and makes every other winner a user', async () => {
    const baseUrl = await start('public');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => register(baseUrl, index))
    );

    expect(results.every(({ status }) => status === 200)).toBe(true);
    expect(results.filter(({ body }) => body.user?.role === 'admin')).toHaveLength(1);
    expect(results.filter(({ body }) => body.user?.role === 'user')).toHaveLength(7);
    expect(getAuthStore()!.countUsersByRole('admin')).toBe(1);
    expect(getAuthStore()!.countUsersByRole('user')).toBe(7);
  });

  test('admin-only registration with explicit public bootstrap admits one winner', async () => {
    const baseUrl = await start('admin-only');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => register(baseUrl, index))
    );
    const admitted = results.filter(({ status }) => status === 200);
    const rejected = results.filter(({ status }) => status === 403);

    expect(admitted).toHaveLength(1);
    expect(admitted[0]?.body.user?.role).toBe('admin');
    expect(rejected).toHaveLength(7);
    expect(rejected.every(({ body }) => body.code === 'REGISTRATION_DISABLED')).toBe(true);
    expect(getAuthStore()!.countUsers()).toBe(1);
    expect(getAuthStore()!.countUsersByRole('admin')).toBe(1);
  });
});
