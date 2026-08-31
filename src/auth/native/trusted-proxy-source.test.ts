import { describe, expect, test } from 'bun:test';
import { resolveNativeRequestPolicy } from './policy-config';
import { createNativePeerSourceResolver, normalizeForwardedAddress } from './trusted-proxy-source';

function resolve(
  resolver: ReturnType<typeof createNativePeerSourceResolver>,
  peerAddress: string,
  forwarded?: string,
): string | null | undefined {
  const headers = forwarded ? { 'x-forwarded-for': forwarded } : undefined;
  return resolver({
    request: new Request('https://auth.example.com/auth/oauth/authorize', { headers }),
    clientId: 'desktop',
    peerAddress,
  });
}

describe('native trusted proxy source', () => {
  test('uses the socket peer and ignores spoofed headers from untrusted peers', () => {
    const resolver = createNativePeerSourceResolver({ trustedProxyRanges: ['10.0.0.0/8'] });
    expect(resolve(resolver, '203.0.113.9', '198.51.100.10')).toBe('203.0.113.9');
    expect(resolve(resolver, '203.0.113.9')).toBe('203.0.113.9');
  });

  test('walks a trusted proxy chain from the socket toward the client', () => {
    const resolver = createNativePeerSourceResolver({
      trustedProxyRanges: ['10.0.0.0/8', '2001:db8:ffff::/48'],
    });
    expect(resolve(resolver, '10.0.0.4', '198.51.100.7, 10.0.0.3')).toBe('198.51.100.7');
    expect(resolve(resolver, '10.0.0.4', 'malformed, 198.51.100.7')).toBe('198.51.100.7');
    expect(resolve(resolver, '2001:db8:ffff::2', '2001:db8::7')).toBe('2001:db8::7');
    expect(resolve(resolver, '::ffff:10.0.0.4', '198.51.100.8')).toBe('198.51.100.8');
  });

  test('resolved policy wires its validated custom forwarded header into the cached resolver', () => {
    const policy = resolveNativeRequestPolicy({
      trustedProxyRanges: ['10.0.0.0/8'],
      forwardedForHeader: 'x-zero-client-chain',
    });
    expect(policy.sourceKey?.({
      request: new Request('https://auth.example.com/auth/oauth/authorize', {
        headers: { 'x-zero-client-chain': '198.51.100.12, 10.0.0.3' },
      }),
      clientId: 'desktop',
      peerAddress: '10.0.0.4',
    })).toBe('198.51.100.12');
  });

  test('falls back to the trusted socket peer for a malformed or oversized chain', () => {
    const resolver = createNativePeerSourceResolver({ trustedProxyRanges: ['10.0.0.0/8'] });
    expect(resolve(resolver, '10.0.0.4', 'unknown')).toBe('10.0.0.4');
    expect(resolve(resolver, '10.0.0.4', Array(33).fill('10.0.0.3').join(',')))
      .toBe('10.0.0.4');
  });

  test('normalizes common address and port forms', () => {
    expect(normalizeForwardedAddress('192.0.2.5:443')).toBe('192.0.2.5');
    expect(normalizeForwardedAddress('[2001:0db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeForwardedAddress('fe80::1%lo0')).toBe('fe80::1');
    expect(normalizeForwardedAddress('unknown')).toBeNull();
  });

  test('rejects ambiguous proxy policy instead of silently trusting a header', () => {
    expect(() => resolveNativeRequestPolicy({ forwardedForHeader: 'x-client-ip' })).toThrow();
    expect(() => resolveNativeRequestPolicy({
      trustedProxyRanges: ['10.0.0.0/8'], sourceKey: () => 'custom',
    })).toThrow();
    expect(() => resolveNativeRequestPolicy({ trustedProxyRanges: ['bad-range'] })).toThrow();
    expect(() => resolveNativeRequestPolicy({ trustedProxyRanges: ['0.0.0.0/0'] })).toThrow();
    expect(() => resolveNativeRequestPolicy({ trustedProxyRanges: ['::/0'] })).toThrow();
  });
});
