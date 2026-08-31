/** Native OIDC ID-token and audience-bound JWT access-token primitives. */

import { SignJWT, jwtVerify } from 'jose';
import { readAuthGeneration } from '../auth-token-generation';
import type { AccessTokenPayload, UserRecord } from '../types';

interface SignNativeTokenInput {
  privateKey: CryptoKey;
  keyId: string;
  issuer: string;
  user: UserRecord;
}

export async function signNativeAccessToken(
  input: SignNativeTokenInput & {
    audience: string; clientId: string; scope: string; ttl: string;
    authGeneration: number; sessionId: string;
  }
): Promise<string> {
  return new SignJWT({
    authGeneration: input.authGeneration, client_id: input.clientId,
    scope: input.scope, sid: input.sessionId,
  })
    .setProtectedHeader({ alg: 'ES256', kid: input.keyId, typ: 'at+jwt' })
    .setSubject(input.user.userId).setIssuer(input.issuer).setAudience(input.audience)
    .setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime(input.ttl)
    .sign(input.privateKey);
}

export async function signNativeIdToken(
  input: SignNativeTokenInput & { clientId: string; nonce?: string; scope: string }
): Promise<string> {
  const scopes = new Set(input.scope.split(' '));
  const name = [input.user.firstName, input.user.lastName].filter(Boolean).join(' ');
  return new SignJWT({
    email: scopes.has('email') ? input.user.email : undefined,
    email_verified: scopes.has('email') ? Boolean(input.user.emailVerifiedAt) : undefined,
    preferred_username: scopes.has('profile') ? input.user.username : undefined,
    given_name: scopes.has('profile') ? input.user.firstName ?? undefined : undefined,
    family_name: scopes.has('profile') ? input.user.lastName ?? undefined : undefined,
    name: scopes.has('profile') ? name || undefined : undefined,
    nonce: input.nonce,
  })
    .setProtectedHeader({ alg: 'ES256', kid: input.keyId, typ: 'JWT' })
    .setSubject(input.user.userId).setIssuer(input.issuer).setAudience(input.clientId)
    .setIssuedAt().setExpirationTime('5m').sign(input.privateKey);
}

export async function verifyNativeAccessToken(input: {
  token: string; publicKey: CryptoKey; issuer: string; audience: string;
}): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(input.token, input.publicKey, {
      algorithms: ['ES256'], issuer: input.issuer, audience: input.audience,
      typ: 'at+jwt',
    });
    if (!payload.sub) return null;
    if (typeof payload.client_id !== 'string' || typeof payload.jti !== 'string'
      || typeof payload.sid !== 'string' || !payload.sid) return null;
    return {
      sub: payload.sub,
      authGeneration: readAuthGeneration(payload.authGeneration),
      clientId: payload.client_id, sessionKind: 'native',
      scope: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
      audience: input.audience, jti: payload.jti, sessionId: payload.sid,
    };
  } catch {
    return null;
  }
}
