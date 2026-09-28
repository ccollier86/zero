/** ES256/JWKS validation and OpenID Connect claim checks for ID tokens. */

import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import type { NativeCryptoAdapter, NativeFetch } from './adapter-types';
import { NativeAuthError } from './errors';
import type { NativeIdTokenClaims, NativeOidcMetadata } from './oidc-types';
import { matchesAccessTokenHash } from './token-hash';

interface IdTokenValidationInput {
  token: string;
  accessToken: string;
  expectedNonce?: string;
  expectedSubject?: string;
}

interface VerifiedIdTokenClaims extends NativeIdTokenClaims {
  at_hash?: unknown;
  [claim: string]: unknown;
}

/** Issuer-bound verifier with jose's bounded, rotation-aware remote JWKS cache. */
export class NativeIdTokenValidator {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly metadata: NativeOidcMetadata,
    private readonly clientId: string,
    fetcher: NativeFetch,
    private readonly crypto: NativeCryptoAdapter,
    private readonly clockSkewSeconds: number,
    private readonly now: () => number,
  ) {
    this.jwks = createRemoteJWKSet(new URL(metadata.jwks_uri), {
      [customFetch]: (url, options) => fetcher(url, {
        ...options, cache: 'no-store', credentials: 'omit', redirect: 'error',
      }),
    });
  }

  async validate(input: IdTokenValidationInput): Promise<NativeIdTokenClaims> {
    let payload;
    try {
      ({ payload } = await jwtVerify(input.token, this.jwks, {
        algorithms: ['ES256'],
        issuer: this.metadata.issuer,
        audience: this.clientId,
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
        clockTolerance: this.clockSkewSeconds,
        currentDate: new Date(this.now()),
      }));
    } catch (cause) {
      throw new NativeAuthError('ID token validation failed.', 'OIDC_ID_TOKEN_INVALID', undefined, {
        cause,
      });
    }

    const claims = payload as VerifiedIdTokenClaims;
    this.validateClaims(claims, input);
    if (claims.at_hash !== undefined) {
      if (typeof claims.at_hash !== 'string'
        || !await matchesAccessTokenHash(input.accessToken, claims.at_hash, this.crypto)) {
        throw new NativeAuthError('ID token access-token hash did not match.', 'OIDC_AT_HASH_MISMATCH');
      }
    }
    return publicIdentityClaims(claims);
  }

  private validateClaims(claims: VerifiedIdTokenClaims, input: IdTokenValidationInput): void {
    if (typeof claims.sub !== 'string' || !claims.sub) invalid('subject');
    if (typeof claims.iat !== 'number' || claims.iat > this.now() / 1000 + this.clockSkewSeconds) {
      invalid('issued-at time');
    }
    const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
    if (!Array.isArray(audiences) || audiences.some((value) => typeof value !== 'string')) {
      invalid('audience');
    }
    if (audiences.length > 1 && typeof claims.azp !== 'string') invalid('authorized party');
    if (claims.azp !== undefined && claims.azp !== this.clientId) invalid('authorized party');
    if (input.expectedNonce !== undefined && claims.nonce !== input.expectedNonce) {
      throw new NativeAuthError('ID token nonce did not match.', 'OIDC_NONCE_MISMATCH');
    }
    if (input.expectedSubject !== undefined && claims.sub !== input.expectedSubject) {
      throw new NativeAuthError('ID token subject changed during refresh.', 'OIDC_SUBJECT_MISMATCH');
    }
  }
}

/**
 * Return only Zero's documented public identity contract. A signed ID token
 * can carry arbitrary private claims, but those claims must not silently enter
 * persisted SDK state or cross a native/browser broker boundary.
 */
function publicIdentityClaims(claims: VerifiedIdTokenClaims): NativeIdTokenClaims {
  const aud = Array.isArray(claims.aud) ? [...claims.aud] : claims.aud;
  if (Array.isArray(aud)) Object.freeze(aud);
  return Object.freeze({
    iss: claims.iss,
    sub: claims.sub,
    aud,
    exp: claims.exp,
    iat: claims.iat,
    ...(claims.azp === undefined ? {} : { azp: claims.azp }),
    ...(claims.nonce === undefined ? {} : { nonce: claims.nonce }),
    ...(claims.auth_time === undefined ? {} : { auth_time: claims.auth_time }),
    ...(claims.email === undefined ? {} : { email: claims.email }),
    ...(claims.email_verified === undefined
      ? {}
      : { email_verified: claims.email_verified }),
    ...(claims.preferred_username === undefined
      ? {}
      : { preferred_username: claims.preferred_username }),
    ...(claims.name === undefined ? {} : { name: claims.name }),
    ...(claims.given_name === undefined ? {} : { given_name: claims.given_name }),
    ...(claims.family_name === undefined ? {} : { family_name: claims.family_name }),
  });
}

function invalid(field: string): never {
  throw new NativeAuthError(`ID token ${field} was invalid.`, 'OIDC_ID_TOKEN_INVALID');
}
