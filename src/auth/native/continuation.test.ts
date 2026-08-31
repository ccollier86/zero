import { describe, expect, test } from 'bun:test';
import {
  normalizeNativeAuthContinuation,
  parseNativeAuthContinuation,
} from './continuation';

const requestId = 'r'.repeat(43);

describe('native auth continuation', () => {
  test('accepts only one local pending authorization request', () => {
    expect(normalizeNativeAuthContinuation(
      `/auth/oauth/authorize?request_id=${requestId}`
    )).toBe(`/auth/oauth/authorize?request_id=${requestId}`);
    expect(normalizeNativeAuthContinuation(
      `https://attacker.example/auth/oauth/authorize?request_id=${requestId}`
    )).toBeNull();
    expect(normalizeNativeAuthContinuation(
      `/auth/oauth/authorize?request_id=${requestId}&next=https://attacker.example`
    )).toBeNull();
    expect(normalizeNativeAuthContinuation('/admin')).toBeNull();
    expect(parseNativeAuthContinuation(
      `/auth/oauth/authorize?request_id=${requestId}`
    )).toEqual({
      continuation: `/auth/oauth/authorize?request_id=${requestId}`,
      requestId,
    });
  });
});
