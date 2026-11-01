import { afterEach, describe, expect, test } from 'bun:test';

import { AuthClient } from './auth-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('auth property transport coherence', () => {
  for (const single of [false, true]) test(`late ${single ? '404 single-property' : 'full snapshot'} read cannot undo an acknowledged write`, async () => {
    let release!: (response: Response) => void;
    globalThis.fetch = (async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/auth/login')) return Response.json({ user: authUser({ department: 'old' }), accessToken: 'property-access', refreshToken: 'property-refresh' });
      if (init?.method === 'PUT') return Response.json({ ok: true });
      if (url.endsWith(single ? '/auth/me/properties/department' : '/auth/me/properties')) return new Promise<Response>(resolve => { release = resolve; });
      return Response.json({ error: 'Unexpected request' }, { status: 500 });
    }) as typeof fetch;
    const client = new AuthClient('http://zero.test');
    try {
      await client.login('ada', 'password');
      const pending = single ? client.getProperty('department') : client.getProperties(); void pending.catch(() => {});
      await client.setProperty('department', 'accepted');
      release(single ? Response.json({ code: 'USER_PROPERTY_NOT_FOUND' }, { status: 404 }) : Response.json({ properties: { department: 'old' } }));
      await expect(pending).rejects.toMatchObject({ code: 'AUTH_PROPERTIES_READ_SUPERSEDED' });
      expect(client.user?.properties).toEqual({ department: 'accepted' });
    } finally { client.dispose(); }
  });

  test('a 404 refresh removes a previously cached user property', async () => {
    globalThis.fetch = (async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser({ department: 'clinical' }),
          accessToken: 'property-access',
          refreshToken: 'property-refresh',
        });
      }
      if (url.endsWith('/auth/me/properties/department')) {
        return Response.json({ code: 'USER_PROPERTY_NOT_FOUND' }, { status: 404 });
      }
      return Response.json({ error: 'Unexpected request' }, { status: 500 });
    }) as typeof fetch;

    const client = new AuthClient('http://zero.test');
    try {
      await client.login('ada', 'password');
      expect(client.user?.properties).toEqual({ department: 'clinical' });

      await expect(client.getProperty('department')).resolves.toBeNull();
      expect(client.user?.properties).toEqual({});
    } finally {
      client.dispose();
    }
  });
});

function authUser(properties: Record<string, string>) {
  return {
    userId: 'u_property',
    username: 'ada',
    email: 'ada@example.com',
    firstName: null,
    lastName: null,
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: 1,
    emailVerificationRequired: false,
    mfaRequired: false,
    properties,
    createdAt: 1,
    updatedAt: null,
  } as const;
}
