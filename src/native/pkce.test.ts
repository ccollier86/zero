import { describe, expect, test } from 'bun:test';
import { createAuthorizationProof } from './pkce';

describe('native PKCE proof creation', () => {
  test('uses independent 256-bit verifier, state, and nonce values', async () => {
    let call = 0;
    const proof = await createAuthorizationProof({
      randomBytes(length) {
        call += 1;
        return new Uint8Array(length).fill(call);
      },
      async sha256(value) {
        expect(value.byteLength).toBe(43);
        return new Uint8Array(32).fill(9);
      },
    });

    expect(call).toBe(3);
    expect(proof.codeVerifier).toHaveLength(43);
    expect(proof.state).toHaveLength(43);
    expect(proof.nonce).toHaveLength(43);
    expect(new Set([proof.codeVerifier, proof.state, proof.nonce]).size).toBe(3);
    expect(proof.codeChallenge).toHaveLength(43);
  });
});
