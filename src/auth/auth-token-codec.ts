/** Internal ES256 JWT/JWKS codec used by the public TokenService facade. */

import { SignJWT, jwtVerify, type JWK, type JWTPayload } from 'jose';
import { readAuthGeneration } from './auth-token-generation';
import type { AuthSigningKeys } from './auth-signing-keys';
import {
  signNativeAccessToken,
  signNativeIdToken,
  verifyNativeAccessToken,
} from './oidc/native-jwt';
import type {
  AccessTokenPayload,
  AuthTransitionTokenPayload,
  UserRecord,
} from './types';
import type { AuthSessionRecord } from './auth-session-types';

interface BrowserAccessSubject {
  userId: string;
  email: string;
  role: string;
}

interface TransitionTokenSubject extends BrowserAccessSubject {
  authGeneration: number;
}

export interface TransitionTokenClaims {
  purpose: AuthTransitionTokenPayload['purpose'];
  methodId?: string;
  methodType?: AuthTransitionTokenPayload['methodType'];
  challengeId?: string;
  flow?: AuthTransitionTokenPayload['flow'];
  profileAuthorityFingerprint?: string;
}

export interface LegacyPageSessionClaims {
  readonly version: 1;
  readonly tokenId: string;
  readonly userId: string;
  /** Null only for a verified page cookie issued before this claim existed. */
  readonly authGeneration: number | null;
}

/** Parent-bound page proof remains stable while its refresh children rotate. */
export interface ParentPageSessionClaims {
  readonly version: 2;
  readonly sessionId: string;
  readonly sessionGeneration: number;
  readonly userId: string;
  readonly authGeneration: number;
}

export type PageSessionClaims = LegacyPageSessionClaims | ParentPageSessionClaims;

/**
 * Owns compact-token encoding, cryptographic verification, and JWKS projection.
 * Live user/session/tenant authority remains the responsibility of TokenService.
 */
export class AuthTokenCodec {
  constructor(private readonly keys: AuthSigningKeys) {}

  async signBrowserAccessToken(input: {
    user: BrowserAccessSubject;
    authGeneration: number;
    session?: AuthSessionRecord;
    ttl: string;
  }): Promise<string> {
    return new SignJWT({
      sub: input.user.userId,
      email: input.user.email,
      role: input.user.role,
      authGeneration: input.authGeneration,
      sessionKind: input.session ? 'web' : undefined,
      sid: input.session?.sessionId,
      sessionGeneration: input.session?.generation,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.keys.keyId })
      .setIssuedAt()
      .setExpirationTime(input.ttl)
      .setIssuer('auth')
      .sign(this.keys.privateKey);
  }

  /** Verify only the browser issuer; callers own native fallback semantics. */
  async verifyBrowserAccessToken(token: string): Promise<AccessTokenPayload | null> {
    const { payload } = await jwtVerify(token, this.keys.publicKey, {
      algorithms: ['ES256'],
      issuer: 'auth',
    });
    if (typeof payload.sub !== 'string'
      || !payload.sub
      || typeof payload.email !== 'string'
      || typeof payload.role !== 'string') return null;
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      authGeneration: readAuthGeneration(payload.authGeneration),
      sessionKind: payload.sessionKind === 'web' ? 'web' : undefined,
      sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
      sessionGeneration: readOptionalGeneration(payload.sessionGeneration),
    };
  }

  verifyNativeAccessToken(input: {
    token: string;
    issuer: string;
    audience: string;
  }): Promise<AccessTokenPayload | null> {
    return verifyNativeAccessToken({
      ...input,
      publicKey: this.keys.publicKey,
    });
  }

  signNativeAccessToken(input: {
    user: UserRecord;
    issuer: string;
    audience: string;
    clientId: string;
    scope: string;
    authGeneration: number;
    sessionId: string;
    ttl: string;
  }): Promise<string> {
    return signNativeAccessToken({
      ...input,
      privateKey: this.keys.privateKey,
      keyId: this.keys.keyId,
    });
  }

  signNativeIdToken(input: {
    user: UserRecord;
    issuer: string;
    clientId: string;
    nonce?: string;
    scope: string;
  }): Promise<string> {
    return signNativeIdToken({
      ...input,
      privateKey: this.keys.privateKey,
      keyId: this.keys.keyId,
    });
  }

  async signTransitionToken(input: {
    subject: TransitionTokenSubject;
    claims: TransitionTokenClaims;
    ttl: string;
  }): Promise<string> {
    return new SignJWT({
      sub: input.subject.userId,
      email: input.subject.email,
      role: input.subject.role,
      authGeneration: input.subject.authGeneration,
      purpose: input.claims.purpose,
      methodId: input.claims.methodId,
      methodType: input.claims.methodType,
      challengeId: input.claims.challengeId,
      flow: input.claims.flow,
      profileAuthorityFingerprint: input.claims.profileAuthorityFingerprint,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.keys.keyId })
      .setIssuedAt()
      .setExpirationTime(input.ttl)
      .setIssuer('auth-transition')
      .sign(this.keys.privateKey);
  }

  async verifyTransitionToken(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.keys.publicKey, {
      algorithms: ['ES256'],
      issuer: 'auth-transition',
    });
    return payload;
  }

  async signPageSessionToken(input: {
    sessionId: string;
    sessionGeneration: number;
    userId: string;
    authGeneration: number;
    expiresAtSeconds: number;
  }): Promise<string> {
    return new SignJWT({
      pageSessionVersion: 2,
      sid: input.sessionId,
      sessionGeneration: input.sessionGeneration,
      authGeneration: input.authGeneration,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.keys.keyId })
      .setSubject(input.userId)
      .setIssuedAt()
      .setExpirationTime(input.expiresAtSeconds)
      .setIssuer('auth-page-session')
      .sign(this.keys.privateKey);
  }

  /** Verify cryptographic page-cookie claims; durable authority is resolved later. */
  async verifyPageSessionToken(token: string): Promise<PageSessionClaims | null> {
    const { payload } = await jwtVerify(token, this.keys.publicKey, {
      algorithms: ['ES256'],
      issuer: 'auth-page-session',
      requiredClaims: ['exp'],
    });
    // Framework page proofs use whole-second NumericDates. jose enforces the
    // deadline when present; reject missing, non-finite or unsupported values
    // instead of admitting an internally malformed unbounded proof.
    if (typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= 0) return null;
    const subjectId = typeof payload.sid === 'string' && payload.sid ? payload.sid : null;
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    const authGeneration = payload.authGeneration === undefined
      ? null
      : readOptionalGeneration(payload.authGeneration);
    if (!subjectId || !userId || authGeneration === undefined) return null;
    if (payload.pageSessionVersion === 2) {
      const sessionGeneration = readOptionalGeneration(payload.sessionGeneration);
      if (authGeneration === null || sessionGeneration === undefined) return null;
      return { version: 2, sessionId: subjectId, sessionGeneration, userId, authGeneration };
    }
    // Only absence denotes the original child-bound format. Unknown versions
    // cannot fall through to a more permissive legacy interpretation.
    if (payload.pageSessionVersion !== undefined || payload.sessionGeneration !== undefined) return null;
    return {
      version: 1,
      tokenId: subjectId,
      userId,
      authGeneration,
    };
  }

  /** Re-verify issuance time for the narrow unbound-browser migration window. */
  async wasBrowserAccessIssuedBy(
    token: string,
    cutoffSeconds: number,
  ): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(token, this.keys.publicKey, {
        algorithms: ['ES256'],
        issuer: 'auth',
      });
      return typeof payload.iat === 'number'
        && Number.isSafeInteger(payload.iat)
        && payload.iat <= cutoffSeconds;
    } catch {
      return false;
    }
  }

  getJWKS(): { keys: JWK[] } {
    return {
      keys: [{
        kty: this.keys.publicKeyJWK.kty,
        crv: this.keys.publicKeyJWK.crv,
        x: this.keys.publicKeyJWK.x,
        y: this.keys.publicKeyJWK.y,
        kid: this.keys.keyId,
        alg: 'ES256',
        use: 'sig',
      }],
    };
  }
}

function readOptionalGeneration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
