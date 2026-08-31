/** Resolve a client source without trusting attacker-supplied forwarding headers. */

import { isIP } from 'node:net';
import type { NativeAuthorizationSourceResolver } from './policy-types';
import { createTrustedProxyMatcher } from './trusted-proxy-ranges';

const HEADER_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function createNativePeerSourceResolver(options: {
  trustedProxyRanges?: readonly string[];
  forwardedForHeader?: string;
} = {}): NativeAuthorizationSourceResolver {
  const ranges = options.trustedProxyRanges ?? [];
  const trusted = createTrustedProxyMatcher(ranges);
  const header = normalizeHeader(options.forwardedForHeader ?? 'x-forwarded-for');
  return ({ request, peerAddress }) => {
    const peer = normalizeForwardedAddress(peerAddress);
    if (!peer || ranges.length === 0 || !trusted.has(peer)) return peer;
    const value = request.headers.get(header);
    if (!value) return peer;
    const parts = value.split(',');
    let current = peer;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (!trusted.has(current)) return current;
      if (parts.length - index > 32) return peer;
      const next = normalizeForwardedAddress(parts[index]);
      if (!next) return peer;
      current = next;
    }
    return current;
  };
}

export function normalizeForwardedAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  let candidate = value.trim();
  if (candidate.startsWith('[')) {
    const end = candidate.indexOf(']');
    if (end < 0 || (candidate.length > end + 1 && !/^:\d+$/.test(candidate.slice(end + 1)))) {
      return null;
    }
    candidate = candidate.slice(1, end);
  } else if (isIP(candidate) === 0) {
    const port = candidate.match(/^(.+):(\d+)$/);
    if (!port || isIP(port[1]) !== 4) return null;
    candidate = port[1];
  }
  if (isIP(candidate) === 6 && candidate.includes('%')) {
    candidate = candidate.slice(0, candidate.indexOf('%'));
  }
  if (isIP(candidate) === 0) return null;
  return canonicalIp(candidate);
}

function canonicalIp(address: string): string {
  return isIP(address) === 6
    ? new URL(`http://[${address}]/`).hostname.slice(1, -1)
    : address;
}

function normalizeHeader(value: string): string {
  const header = value.trim().toLowerCase();
  if (!HEADER_PATTERN.test(header)) {
    throw new Error('[native-auth] forwardedForHeader must be a valid HTTP header name.');
  }
  return header;
}
