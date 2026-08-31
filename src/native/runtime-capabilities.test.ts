import { describe, expect, test } from 'bun:test';
import { NativeAuthError } from './errors';
import { assertNativeRuntimeCapabilities } from './runtime-capabilities';

describe('native runtime capability checks', () => {
  test('fails before network work without WebCrypto subtle support', () => {
    try {
      assertNativeRuntimeCapabilities({
        crypto: {}, URL, TextEncoder, AbortController, Request, Response, Headers, URLSearchParams,
      });
      throw new Error('expected capability rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeAuthError);
      expect((error as NativeAuthError).code).toBe('NATIVE_WEBCRYPTO_UNAVAILABLE');
    }
  });

  test('requires Fetch/URL primitives instead of failing later opaquely', () => {
    expect(() => assertNativeRuntimeCapabilities({
      crypto: { subtle: {} }, URL, TextEncoder, AbortController,
      Response, Headers, URLSearchParams,
    })).toThrow('Fetch/URL platform globals');
  });
});
