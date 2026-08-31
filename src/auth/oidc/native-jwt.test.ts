import { describe, expect, test } from 'bun:test';
import { SignJWT, exportJWK, importJWK } from 'jose';
import { signNativeAccessToken, verifyNativeAccessToken } from './native-jwt';
import type { UserRecord } from '../types';

const issuer = 'https://zero.example/auth';
const audience = 'https://zero.example';

describe('native access JWT session binding', () => {
  test('round-trips the opaque OIDC sid claim', async () => {
    const keys = await keyPair();
    const token = await signNativeAccessToken({
      ...keys, issuer, audience, user: user(), keyId: 'test', clientId: 'desktop',
      scope: 'openid', ttl: '5m', authGeneration: 4, sessionId: 'family',
    });
    await expect(verifyNativeAccessToken({
      token, publicKey: keys.publicKey, issuer, audience,
    })).resolves.toMatchObject({
      sub: 'user', clientId: 'desktop', sessionKind: 'native', sessionId: 'family',
    });
  });

  test('rejects legacy native tokens without sid while browser tokens stay separate', async () => {
    const keys = await keyPair();
    const legacy = await new SignJWT({
      authGeneration: 0, client_id: 'desktop', scope: 'openid',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test', typ: 'at+jwt' })
      .setSubject('user').setIssuer(issuer).setAudience(audience)
      .setJti('legacy').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    await expect(verifyNativeAccessToken({
      token: legacy, publicKey: keys.publicKey, issuer, audience,
    })).resolves.toBeNull();
  });
});

async function keyPair() {
  const generated = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const privateKey = await importJWK(await exportJWK(generated.privateKey), 'ES256');
  const publicKey = await importJWK(await exportJWK(generated.publicKey), 'ES256');
  return { privateKey: privateKey as CryptoKey, publicKey: publicKey as CryptoKey };
}

function user(): UserRecord {
  return {
    userId: 'user', username: 'user', email: 'user@example.test', role: 'user',
    status: 'active', passwordChangeRequired: false, emailVerifiedAt: null,
    emailVerificationRequired: false, mfaRequired: false, firstName: null,
    lastName: null, createdAt: 1, updatedAt: null, properties: {},
  };
}
