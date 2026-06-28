/**
 * storage-hooks.test.ts
 *
 * Guards the frontend storage hooks transport boundary. The hooks own UI state,
 * but SDK auth remains the single source for tokens and refresh behavior.
 */

import { describe, expect, test } from 'bun:test';

const source = await Bun.file(new URL('./storage-hooks.ts', import.meta.url)).text();

describe('storage hooks transport contract', () => {
  test('delegates JSON requests to the SDK client instead of browser token storage', () => {
    expect(source).toContain('useClientMaybe');
    expect(source).toContain('client).fetch<T>(apiUrl(path), init)');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('access_token');
    expect(source).not.toContain('getItem');
  });

  test('retries uploads through the SDK refresh flow after an unauthorized response', () => {
    expect(source).toContain('XMLHttpRequest');
    expect(source).toContain('client.token');
    expect(source).toContain('client.refresh()');
  });
});
