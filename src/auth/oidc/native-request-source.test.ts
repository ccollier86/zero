import { describe, expect, test } from 'bun:test';
import { resolveNativeRequestPolicy } from '../native/policy-config';
import { resolveNativeRequestSource } from './native-request-source';

describe('native request source resolution', () => {
  test('rejects and consumes an asynchronous deployment resolver', async () => {
    const policy = resolveNativeRequestPolicy({
      sourceKey: (async () => {
        throw new Error('private resolver rejection');
      }) as never,
    });

    expect(() => resolveNativeRequestSource(
      policy,
      new Request('https://zero.test/auth/native/authorize'),
      'desktop-app',
    )).toThrow(expect.objectContaining({
      code: 'temporarily_unavailable',
      status: 503,
    }));
    await Promise.resolve();
  });
});
