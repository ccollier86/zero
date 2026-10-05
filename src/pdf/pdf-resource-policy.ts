/**
 * pdf-resource-policy.ts
 *
 * Evaluates renderer resource URLs against Zero's explicit network policy.
 * This file is pure policy logic and performs no DNS or browser operations.
 */

import type { ResolvedPdfResourcePolicy } from './pdf-types';

/** Result of evaluating one document resource URL. */
export interface PdfResourceDecision {
  allowed: boolean;
  reason?: string;
}

/** Decide whether Chromium may load one resource requested by document markup. */
export function evaluatePdfResource(
  value: string,
  baseUrl: string | undefined,
  policy: ResolvedPdfResourcePolicy
): PdfResourceDecision {
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return { allowed: false, reason: 'invalid-url' };
  }

  if (url.protocol === 'about:') return { allowed: url.href === 'about:blank', reason: 'about-url' };
  if (url.protocol === 'data:') return decision(policy.allowDataUrls, 'data-url');
  if (url.protocol === 'blob:') return decision(policy.allowBlobUrls, 'blob-url');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: 'unsupported-protocol' };
  }
  if (policy.blockPrivateNetworks && isPrivateNetworkHost(url.hostname)) {
    return { allowed: false, reason: 'private-network' };
  }

  if (policy.remote === 'allow') return { allowed: true };
  if (policy.remote === 'deny') return { allowed: false, reason: 'remote-denied' };
  if (policy.remote === 'allowlist') {
    return decision(policy.allowedOrigins.has(url.origin), 'origin-not-allowed');
  }

  if (!baseUrl) return { allowed: false, reason: 'base-url-required' };
  try {
    return decision(new URL(baseUrl).origin === url.origin, 'cross-origin');
  } catch {
    return { allowed: false, reason: 'invalid-base-url' };
  }
}

/** Return an operationally useful URL with credentials, query, and hash removed. */
export function sanitizePdfResourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '[invalid-url]';
  }
}

function decision(allowed: boolean, deniedReason: string): PdfResourceDecision {
  return allowed ? { allowed: true } : { allowed: false, reason: deniedReason };
}

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    const firstWord = Number.parseInt(host.split(':', 1)[0] || '0', 16);
    if ((firstWord & 0xfe00) === 0xfc00 || (firstWord & 0xffc0) === 0xfe80) return true;
    // URL normalizes IPv4-mapped literals into two final hexadecimal words.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(host);
    if (!mapped) return false;
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return isPrivateIpv4Host(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return isPrivateIpv4Host(host);
}

function isPrivateIpv4Host(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return first === 10
    || first === 127
    || first === 0
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127);
}
