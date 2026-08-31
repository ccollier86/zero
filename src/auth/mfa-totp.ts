/**
 * mfa-totp.ts
 *
 * Generates and verifies RFC 6238-compatible TOTP codes for authenticator
 * apps. This file owns TOTP math and otpauth URI construction only.
 */

import { createHmac, randomBytes } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_DIGITS = 6;

/** Generate a new base32 TOTP secret. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Create an otpauth URI compatible with common authenticator apps. */
export function createTotpUri(params: {
  issuer: string;
  accountName: string;
  secret: string;
  digits?: number;
  period?: number;
}): string {
  const digits = params.digits ?? DEFAULT_DIGITS;
  const period = params.period ?? DEFAULT_PERIOD_SECONDS;
  const label = `${params.issuer}:${params.accountName}`;
  const url = new URL(`otpauth://totp/${encodeURIComponent(label)}`);
  url.searchParams.set('secret', params.secret);
  url.searchParams.set('issuer', params.issuer);
  url.searchParams.set('algorithm', 'SHA1');
  url.searchParams.set('digits', String(digits));
  url.searchParams.set('period', String(period));
  return url.toString();
}

/** Generate a TOTP code for a base32 secret and point in time. */
export function generateTotpCode(params: {
  secret: string;
  now?: number;
  digits?: number;
  period?: number;
}): string {
  const digits = params.digits ?? DEFAULT_DIGITS;
  const period = params.period ?? DEFAULT_PERIOD_SECONDS;
  const counter = Math.floor((params.now ?? Date.now()) / 1000 / period);
  return hotp(params.secret, counter, digits);
}

/** Verify a TOTP code, allowing a small clock-skew window by default. */
export function verifyTotpCode(params: {
  secret: string;
  code: string;
  now?: number;
  digits?: number;
  period?: number;
  window?: number;
}): boolean {
  const code = normalizeCode(params.code);
  const digits = params.digits ?? DEFAULT_DIGITS;
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return false;

  const period = params.period ?? DEFAULT_PERIOD_SECONDS;
  const window = params.window ?? 1;
  const now = params.now ?? Date.now();
  const currentCounter = Math.floor(now / 1000 / period);

  for (let offset = -window; offset <= window; offset += 1) {
    if (constantTimeEqual(code, hotp(params.secret, currentCounter + offset, digits))) {
      return true;
    }
  }
  return false;
}

function hotp(secret: string, counter: number, digits: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

function base32Encode(value: Uint8Array): string {
  let bits = 0;
  let bitCount = 0;
  let output = '';

  for (const byte of value) {
    bits = (bits << 8) | byte;
    bitCount += 8;

    while (bitCount >= 5) {
      output += BASE32_ALPHABET[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
  }

  if (bitCount > 0) {
    output += BASE32_ALPHABET[(bits << (5 - bitCount)) & 31];
  }

  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = value.replaceAll(/\s|=/g, '').toUpperCase();
  let bits = 0;
  let bitCount = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 TOTP secret');

    bits = (bits << 5) | index;
    bitCount += 5;

    if (bitCount >= 8) {
      bytes.push((bits >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
  }

  return Buffer.from(bytes);
}

function normalizeCode(code: string): string {
  return code.replaceAll(/\s|-/g, '');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
