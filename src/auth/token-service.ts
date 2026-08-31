import { SignJWT, jwtVerify, importJWK, calculateJwkThumbprint } from 'jose';
import type { JWK } from 'jose';
import type { UserStore } from './user-store';
import type {
  TokenServiceConfig,
  TokenPair,
  AccessTokenPayload,
  AuthTransitionPurpose,
  AuthTransitionTokenPayload,
  RefreshTokenRecord,
  UserRecord,
  AuthContext,
} from './types';
import { AUTH_DEFAULTS, AuthError } from './types';
import {
  currentAuthGeneration,
  isCurrentAuthGeneration,
  readAuthGeneration,
} from './auth-token-generation';
import {
  signNativeAccessToken as signOidcAccessToken,
  signNativeIdToken as signOidcIdToken,
  verifyNativeAccessToken,
} from './oidc/native-jwt';
import type { NativeAccessSessionValidator } from './oidc/native-access-session';

/** Page credential bound to one persisted refresh-session record. */
export interface IssuedPageSession {
  token: string;
  expiresAt: number;
}

// ─── TTL Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a jose-style duration string to milliseconds.
 * Supports: '15m', '1h', '7d', '30s', etc.
 */
function parseTTLtoMs(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    case 'd':
      return value * 86_400_000;
    default:
      throw new Error(`Invalid TTL unit: ${match[2]}`);
  }
}

// ─── TokenService ──────────────────────────────────────────────────────────

/**
 * JWT signing, verification, keypair management, and refresh token rotation.
 *
 * Uses ECDSA P-256 (ES256) for asymmetric signing:
 * - Compact 64-byte signatures
 * - Public key verification (supports JWKS endpoint)
 * - No shared secrets
 *
 * Access tokens are signed JWTs. Signature verification is stateless, while
 * normal request authentication also resolves the current user generation
 * and, for native sessions, the live refresh family. Refresh tokens are
 * opaque values stored as SHA-256 hashes in the database.
 */
export class TokenService {
  private readonly accessTokenTTL: string;
  private readonly refreshTokenTTLMs: number;
  private readonly nativeIssuer?: string;
  private readonly nativeAudience?: string;
  private nativeSessionValidator: NativeAccessSessionValidator | null = null;

  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
    private readonly publicKeyJWK: JWK,
    private readonly keyId: string,
    private userStore: UserStore | null,
    config: {
      accessTokenTTL?: string;
      refreshTokenTTL?: string;
      nativeIssuer?: string;
      nativeAudience?: string;
    }
  ) {
    this.accessTokenTTL =
      config.accessTokenTTL ??
      process.env[AUTH_DEFAULTS.accessTokenTTLEnvKey] ??
      AUTH_DEFAULTS.accessTokenTTL;

    const refreshTTL =
      config.refreshTokenTTL ??
      process.env[AUTH_DEFAULTS.refreshTokenTTLEnvKey] ??
      AUTH_DEFAULTS.refreshTokenTTL;

    this.refreshTokenTTLMs = parseTTLtoMs(refreshTTL);
    this.nativeIssuer = config.nativeIssuer;
    this.nativeAudience = config.nativeAudience;
  }

  /**
   * Wire up the UserStore dependency after creation.
   * Called by the auth plugin after both services are initialized.
   */
  setUserStore(store: UserStore): void {
    this.userStore = store;
  }

  /** Attach the live native refresh-family boundary after auth startup. */
  setNativeSessionValidator(validator: NativeAccessSessionValidator): void {
    this.nativeSessionValidator = validator;
  }

  /** Lifetime advertised by OAuth token responses. */
  getAccessTokenTTLSeconds(): number {
    return Math.floor(parseTTLtoMs(this.accessTokenTTL) / 1_000);
  }

  // ─── Factory ─────────────────────────────────────────────────────────

  /**
   * Create a TokenService instance. Handles keypair initialization:
   * 1. Check AUTH_SIGNING_KEY env var
   * 2. Check _auth_config table in the database
   * 3. Generate a fresh ECDSA P-256 keypair and persist it
   */
  static async create(config: TokenServiceConfig): Promise<TokenService> {
    const { db } = config;

    // 1. Try env var
    const envKey = process.env[AUTH_DEFAULTS.signingKeyEnvKey];
    if (envKey) {
      return TokenService.fromEnvKey(envKey, config);
    }

    // 2. Try database
    const getConfigStmt = db.prepare(
      'SELECT value FROM _auth_config WHERE key = ?'
    );
    const stored = getConfigStmt.get('signing_key_private') as {
      value: string;
    } | null;

    if (stored) {
      const jwk = JSON.parse(stored.value) as JWK;
      const kidRow = getConfigStmt.get('signing_key_id') as {
        value: string;
      } | null;
      const kid = kidRow?.value ?? crypto.randomUUID();
      return TokenService.fromJWK(jwk, kid, config);
    }

    // 3. Generate fresh keypair
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, // extractable — needed for JWK export
      ['sign', 'verify']
    );

    const kid = crypto.randomUUID();
    const privateJWK = await crypto.subtle.exportKey(
      'jwk',
      keyPair.privateKey
    );
    const publicJWK = await crypto.subtle.exportKey(
      'jwk',
      keyPair.publicKey
    );

    // Persist for next startup
    const setConfigStmt = db.prepare(
      'INSERT OR REPLACE INTO _auth_config (key, value) VALUES (?, ?)'
    );
    setConfigStmt.run('signing_key_private', JSON.stringify(privateJWK));
    setConfigStmt.run('signing_key_id', kid);

    // Import as jose KeyLike objects
    const privateKey = await importJWK(privateJWK as JWK, 'ES256');
    const publicKey = await importJWK(publicJWK as JWK, 'ES256');

    return new TokenService(
      privateKey as CryptoKey,
      publicKey as CryptoKey,
      publicJWK as JWK,
      kid,
      null,
      config
    );
  }

  /**
   * Import keypair from env var (PEM or base64 JWK).
   */
  private static async fromEnvKey(
    envKey: string,
    config: TokenServiceConfig
  ): Promise<TokenService> {
    let jwk: JWK;

    if (envKey.startsWith('{')) {
      // Raw JWK JSON
      jwk = JSON.parse(envKey) as JWK;
    } else if (envKey.startsWith('-----BEGIN')) {
      // PEM — not supported in this implementation, use JWK
      throw new Error(
        'PEM signing keys not yet supported. Use JWK format (JSON object or base64-encoded JWK).'
      );
    } else {
      // Base64-encoded JWK
      jwk = JSON.parse(
        Buffer.from(envKey, 'base64').toString('utf-8')
      ) as JWK;
    }

    const kid = jwk.kid ?? await calculateJwkThumbprint(jwk, 'sha256');
    return TokenService.fromJWK(jwk, kid, config);
  }

  /**
   * Import keypair from a JWK (private key — public key derived).
   */
  private static async fromJWK(
    jwk: JWK,
    kid: string,
    config: TokenServiceConfig
  ): Promise<TokenService> {
    const privateKey = await importJWK(jwk, 'ES256');

    // Derive public key by stripping private components
    const publicJWK: JWK = {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      kid,
      alg: 'ES256',
      use: 'sig',
    };
    const publicKey = await importJWK(publicJWK, 'ES256');

    return new TokenService(
      privateKey as CryptoKey,
      publicKey as CryptoKey,
      publicJWK,
      kid,
      null,
      config
    );
  }

  // ─── Access Token ────────────────────────────────────────────────────

  /**
   * Sign a browser JWT access token for the given user. Request middleware
   * still rehydrates the current user and validates its security generation.
   */
  async signAccessToken(user: {
    userId: string;
    email: string;
    role: string;
  }, expectedAuthGeneration?: number): Promise<string> {
    const authGeneration = expectedAuthGeneration
      ?? currentAuthGeneration(this.userStore, user.userId);
    return new SignJWT({
      sub: user.userId,
      email: user.email,
      role: user.role,
      authGeneration,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .setIssuedAt()
      .setExpirationTime(this.accessTokenTTL)
      .setIssuer('auth')
      .sign(this.privateKey);
  }

  /**
   * Verify an access token. Returns claims or null if invalid/expired.
   * Stateless — no database lookup. Public key check only.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['ES256'],
        issuer: 'auth',
      });

      return {
        sub: payload.sub!,
        email: payload.email as string,
        role: payload.role as string,
        authGeneration: readAuthGeneration(payload.authGeneration),
      };
    } catch {
      if (!this.nativeIssuer || !this.nativeAudience) return null;
      return verifyNativeAccessToken({
        token, publicKey: this.publicKey,
        issuer: this.nativeIssuer, audience: this.nativeAudience,
      });
    }
  }

  /** Sign an audience-bound access token for a registered native client. */
  async signNativeAccessToken(
    user: UserRecord,
    clientId: string,
    scope: string,
    authGeneration: number,
    sessionId: string,
  ): Promise<string> {
    if (!this.nativeIssuer || !this.nativeAudience) {
      throw new Error('TokenService: native token issuer is not configured');
    }
    return signOidcAccessToken({
      privateKey: this.privateKey, keyId: this.keyId, issuer: this.nativeIssuer,
      audience: this.nativeAudience, clientId, scope, user,
      authGeneration, sessionId,
      ttl: this.accessTokenTTL,
    });
  }

  /** Sign an OpenID Connect ID token for the native client itself. */
  async signNativeIdToken(
    user: UserRecord,
    clientId: string,
    nonce: string | undefined,
    scope: string
  ): Promise<string> {
    if (!this.nativeIssuer) throw new Error('TokenService: native token issuer is not configured');
    return signOidcIdToken({
      privateKey: this.privateKey, keyId: this.keyId, issuer: this.nativeIssuer,
      clientId, nonce, scope, user,
    });
  }

  /**
   * Sign a short-lived auth transition token.
   *
   * Transition tokens are not app sessions and cannot be used with normal
   * auth middleware. They let auth routes carry users through MFA setup or
   * challenge flows before a full access/refresh pair is issued.
   */
  async signTransitionToken(
    user: {
      userId: string;
      email: string;
      role: string;
    },
    params: {
      purpose: AuthTransitionPurpose;
      ttl: string;
      methodId?: string;
      methodType?: AuthTransitionTokenPayload['methodType'];
      challengeId?: string;
      flow?: AuthTransitionTokenPayload['flow'];
    }
  ): Promise<string> {
    const authGeneration = currentAuthGeneration(this.userStore, user.userId);
    return new SignJWT({
      sub: user.userId,
      email: user.email,
      role: user.role,
      authGeneration,
      purpose: params.purpose,
      methodId: params.methodId,
      methodType: params.methodType,
      challengeId: params.challengeId,
      flow: params.flow,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .setIssuedAt()
      .setExpirationTime(params.ttl)
      .setIssuer('auth-transition')
      .sign(this.privateKey);
  }

  /**
   * Verify a short-lived auth transition token.
   */
  async verifyTransitionToken(
    token: string,
    allowedPurpose: AuthTransitionPurpose | AuthTransitionPurpose[]
  ): Promise<AuthTransitionTokenPayload | null> {
    const allowed = Array.isArray(allowedPurpose) ? allowedPurpose : [allowedPurpose];
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['ES256'],
        issuer: 'auth-transition',
      });
      const purpose = payload.purpose as AuthTransitionPurpose | undefined;
      if (!purpose || !allowed.includes(purpose)) return null;

      const userId = payload.sub;
      if (!userId) return null;
      const authGeneration = readAuthGeneration(payload.authGeneration);
      if (this.userStore) {
        const user = this.userStore.getUserById(userId);
        if (!user || !isCurrentAuthGeneration(this.userStore, userId, authGeneration)) {
          return null;
        }
      }

      return {
        sub: userId,
        email: payload.email as string,
        role: payload.role as string,
        authGeneration,
        purpose,
        methodId: typeof payload.methodId === 'string' ? payload.methodId : undefined,
        methodType: isMfaMethodType(payload.methodType) ? payload.methodType : undefined,
        challengeId: typeof payload.challengeId === 'string' ? payload.challengeId : undefined,
        flow: payload.flow === 'auth' || payload.flow === 'profile'
          ? payload.flow
          : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve an access token into request auth context.
   *
   * Unlike `verifyAccessToken`, this checks the current user row when the
   * UserStore is wired so suspended and forced-reset accounts fail closed.
   */
  async resolveAuthContext(token: string): Promise<AuthContext | null> {
    const payload = await this.verifyAccessToken(token);
    if (!payload) return null;

    if (!this.userStore) {
      return toAuthContext(payload);
    }

    const user = this.userStore.getUserById(payload.sub);
    if (!user || !canUserReceiveTokens(user)) return null;
    if (!isCurrentAuthGeneration(this.userStore, user.userId, payload.authGeneration)) return null;
    if (payload.sessionKind === 'native') {
      if (!payload.sessionId || !payload.clientId || !this.nativeSessionValidator) return null;
      if (!this.nativeSessionValidator.isActive({
        sessionId: payload.sessionId, userId: user.userId,
        clientId: payload.clientId, authGeneration: payload.authGeneration,
      })) return null;
    }

    return {
      userId: user.userId, email: user.email, role: user.role,
      clientId: payload.clientId, sessionKind: payload.sessionKind,
      scope: payload.scope, sessionId: payload.sessionId,
    };
  }

  // ─── Token Pair Issuance ─────────────────────────────────────────────

  /**
   * Mint a page-only JWT bound to the persisted refresh session represented by
   * `rawRefreshToken`. The browser receives this token only in an HttpOnly
   * cookie; it is never returned in the auth JSON response.
   */
  async issuePageSessionToken(
    rawRefreshToken: string
  ): Promise<IssuedPageSession | null> {
    if (!this.userStore || !rawRefreshToken) return null;

    const record = this.userStore.getRefreshTokenByHash(
      this.hashToken(rawRefreshToken)
    );
    if (!record || record.revokedAt !== null || record.expiresAt <= Date.now()) {
      return null;
    }

    const user = this.userStore.getUserById(record.userId);
    if (!user || !canUserReceiveTokens(user)) return null;

    const token = await new SignJWT({ sid: record.tokenId })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .setSubject(user.userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(record.expiresAt / 1_000))
      .setIssuer('auth-page-session')
      .sign(this.privateKey);

    return { token, expiresAt: record.expiresAt };
  }

  /**
   * Resolve a page-only JWT against its live refresh-session row and current
   * user record. Rotation, logout, session revocation, password actions,
   * suspension, deletion, and expiry therefore invalidate SSR authentication
   * immediately without granting cookie access to APIs.
   */
  async resolvePageSessionToken(token: string): Promise<AuthContext | null> {
    const record = await this.resolvePageSessionRecord(token);
    if (!record || !this.userStore) return null;

    const user = this.userStore.getUserById(record.userId);
    if (!user || !canUserReceiveTokens(user)) return null;

    return { userId: user.userId, email: user.email, role: user.role };
  }

  /** Revoke the refresh session referenced by an existing page cookie. */
  async revokePageSessionToken(token: string): Promise<boolean> {
    const record = await this.resolvePageSessionRecord(token);
    if (!record || !this.userStore) return false;

    this.userStore.revokeRefreshToken(record.tokenId);
    return true;
  }

  /**
   * Issue a full token pair (access + refresh) for a user.
   * Stores the refresh token hash in the database.
   */
  async issueTokenPair(user: UserRecord): Promise<TokenPair> {
    if (!this.userStore) {
      throw new Error('TokenService: UserStore not wired');
    }
    assertUserCanReceiveTokens(user);

    const authGeneration = this.userStore.getAuthGeneration(user.userId);
    const accessToken = await this.signAccessToken(user, authGeneration);
    const refreshToken = crypto.randomUUID();
    const refreshHash = this.hashToken(refreshToken);
    const createdAt = Date.now();
    const expiresAt = createdAt + this.refreshTokenTTLMs;
    const tokenId = crypto.randomUUID();
    const stored = this.userStore.storeRefreshTokenIfCurrent(
      tokenId,
      user,
      refreshHash,
      expiresAt,
      createdAt,
      authGeneration
    );
    if (!stored) {
      throw new AuthError(
        'Authentication state changed; sign in again',
        'AUTH_STATE_CHANGED',
        409
      );
    }

    return { accessToken, refreshToken };
  }

  // ─── Refresh Token Rotation ──────────────────────────────────────────

  /**
   * Rotate a refresh token:
   * 1. Hash the incoming token, look up in DB
   * 2. If revoked → replay attack → revoke ALL user tokens → null
   * 3. If expired → null
   * 4. Sign a generation-bound candidate access token
   * 5. Atomically consume the old token and insert its replacement
   *
   * One-time use: each refresh token is used exactly once.
   */
  async rotateRefreshToken(rawToken: string): Promise<TokenPair | null> {
    if (!this.userStore) {
      throw new Error('TokenService: UserStore not wired');
    }

    const hash = this.hashToken(rawToken);
    const record = this.userStore.getRefreshTokenByHash(hash);

    if (!record) return null; // Unknown token

    // Replay detection — if already revoked, revoke ALL tokens for this user.
    // A forced-password gate already revoked the complete family and prevents
    // issuing replacements, so another bump would only invalidate the recovery
    // link when a stale browser predictably retries its old refresh token.
    if (record.revokedAt !== null) {
      this.userStore.invalidateRefreshTokenReplay(record.userId);
      return null;
    }

    // Check expiry
    if (record.expiresAt < Date.now()) return null;

    // Sign before atomically consuming the old token. If another request wins
    // the consume race, its replacement is revoked and this JWT's generation
    // is invalidated before either concurrent result can remain usable.
    const user = this.userStore.getUserById(record.userId);
    if (!user) return null; // User deleted between token issuance and refresh
    assertUserCanReceiveTokens(user);
    const authGeneration = this.userStore.getAuthGeneration(user.userId);
    const accessToken = await this.signAccessToken(user, authGeneration);
    const refreshToken = crypto.randomUUID();
    const createdAt = Date.now();
    const result = this.userStore.rotateRefreshTokenAtomically(record, {
      tokenId: crypto.randomUUID(),
      tokenHash: this.hashToken(refreshToken),
      expiresAt: createdAt + this.refreshTokenTTLMs,
      createdAt,
    }, authGeneration, createdAt);
    if (result !== 'rotated') return null;
    return { accessToken, refreshToken };
  }

  /**
   * Revoke a refresh token by raw token string (for logout).
   * Returns true if the token was found and revoked.
   */
  revokeRefreshTokenByRaw(rawToken: string): boolean {
    if (!this.userStore) return false;

    const hash = this.hashToken(rawToken);
    const record = this.userStore.getRefreshTokenByHash(hash);
    if (!record) return false;

    this.userStore.revokeRefreshToken(record.tokenId);
    return true;
  }

  // ─── JWKS ────────────────────────────────────────────────────────────

  /**
   * Get the public key in JWK Set format for the /auth/jwks endpoint.
   * Standard OIDC-compatible format for external token verification.
   */
  getJWKS(): { keys: JWK[] } {
    return {
      keys: [
        {
          kty: this.publicKeyJWK.kty,
          crv: this.publicKeyJWK.crv,
          x: this.publicKeyJWK.x,
          y: this.publicKeyJWK.y,
          kid: this.keyId,
          alg: 'ES256',
          use: 'sig',
        },
      ],
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async resolvePageSessionRecord(
    token: string
  ): Promise<RefreshTokenRecord | null> {
    if (!this.userStore || !token) return null;

    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['ES256'],
        issuer: 'auth-page-session',
      });
      const sessionId = typeof payload.sid === 'string' ? payload.sid : null;
      const userId = typeof payload.sub === 'string' ? payload.sub : null;
      if (!sessionId || !userId) return null;

      const record = this.userStore.getRefreshTokenById(sessionId);
      if (!record || record.userId !== userId) return null;
      if (record.revokedAt !== null || record.expiresAt <= Date.now()) return null;
      return record;
    } catch {
      return null;
    }
  }

  /** SHA-256 hash a token string. Returns hex-encoded hash. */
  private hashToken(token: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(token);
    return hasher.digest('hex');
  }
}

function isMfaMethodType(value: unknown): value is AuthTransitionTokenPayload['methodType'] {
  return value === 'email' || value === 'totp';
}

function canUserReceiveTokens(user: UserRecord): boolean {
  if (user.status === 'suspended' || user.passwordChangeRequired) return false;
  return !user.emailVerificationRequired || Boolean(user.emailVerifiedAt);
}

function assertUserCanReceiveTokens(user: UserRecord): void {
  if (user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
  }
  if (user.passwordChangeRequired) {
    throw new AuthError('Password change required', 'PASSWORD_CHANGE_REQUIRED', 403);
  }
  if (user.emailVerificationRequired && !user.emailVerifiedAt) {
    throw new AuthError('Email verification required', 'EMAIL_VERIFICATION_REQUIRED', 403);
  }
}

function toAuthContext(payload: AccessTokenPayload): AuthContext | null {
  if (typeof payload.email !== 'string' || typeof payload.role !== 'string') {
    return null;
  }
  return {
    userId: payload.sub,
    email: payload.email,
    role: payload.role,
    clientId: payload.clientId,
    sessionKind: payload.sessionKind,
    scope: payload.scope,
    sessionId: payload.sessionId,
  };
}
