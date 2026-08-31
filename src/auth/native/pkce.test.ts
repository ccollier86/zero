import { describe, expect, test } from 'bun:test';
import {
  derivePkceS256Challenge,
  isValidPkceS256Challenge,
  isValidPkceVerifier,
  verifyPkceS256,
} from './pkce';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('native PKCE S256', () => {
  test('implements the RFC 7636 S256 vector', async () => {
    expect(await derivePkceS256Challenge(VERIFIER)).toBe(CHALLENGE);
    expect(await verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
  });

  test('rejects malformed verifiers and challenges', async () => {
    expect(isValidPkceVerifier('a'.repeat(42))).toBe(false);
    expect(isValidPkceVerifier(`${'a'.repeat(42)}!`)).toBe(false);
    expect(isValidPkceVerifier('a'.repeat(129))).toBe(false);
    expect(isValidPkceS256Challenge(`${CHALLENGE}=`)).toBe(false);
    expect(await verifyPkceS256(`${VERIFIER}!`, CHALLENGE)).toBe(false);
    expect(await verifyPkceS256(VERIFIER, `${CHALLENGE.slice(0, 42)}x`)).toBe(false);
  });
});
