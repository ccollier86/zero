/**
 * sdk.test.ts
 *
 * Verifies frontend SDK configuration contracts that do not need a browser
 * renderer. The SDK owns auth transport mode and state-sync prerequisites.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { AUTH_DISABLED_MESSAGE } from './auth-client';
import { createClient, getClient } from './sdk';

const tables = {
  todos: { _pk: 'id', id: 'text', title: 'text' },
};

afterEach(() => {
  getClient()?.disconnect();
});

describe('createClient auth configuration', () => {
  test('defaults auth to disabled and gives clear auth-action errors', async () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      autoConnect: false,
    });

    expect(client.user).toBeNull();
    expect(client.isAuthenticated).toBe(false);
    expect(client.token).toBeNull();
    await expect(client.login('alice', 'password')).rejects.toThrow(AUTH_DISABLED_MESSAGE);
    await expect(client.forgotPassword('alice@example.com')).rejects.toThrow(AUTH_DISABLED_MESSAGE);
  });

  test('rejects state sync unless auth is enabled', () => {
    expect(() =>
      createClient({
        url: 'http://localhost:3000',
        tables,
        stateSync: true,
        autoConnect: false,
      }),
    ).toThrow('[client] stateSync requires auth: true');
  });
});
