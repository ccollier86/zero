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
  AuthContextAuthorityReference,
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
import { AuthSessionService } from './auth-session-service';
import { AuthSessionStore } from './auth-session-store';
import type {
  AuthSessionRecord,
  WebSessionIssueOptions,
} from './auth-session-types';
import type { AuthAuditRequestContext } from './auth-audit-types';
import { canUserReceiveAuthTokens as canUserReceiveTokens } from './auth-user-eligibility';
import { readAuthAuthorityRevision } from './auth-authority-revision';

/** Page credential bound to one persisted refresh-session record. */
export interface IssuedPageSession {
  token: string;
  expiresAt: number;
}

/** Server-only proof resolved from a live browser refresh/session family. */
export interface WebRefreshProof {
  user: UserRecord;
  record: RefreshTokenRecord;
  session: AuthSessionRecord;
  tenantRole: string | null;
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
  private readonly db: TokenServiceConfig['db'];
  private readonly accessTokenTTL: string;
  private readonly refreshTokenTTLMs: number;
  private readonly nativeIssuer?: string;
  private readonly nativeAudience?: string;
  private readonly authSessionService: AuthSessionService;
  /**
   * Tokens issued before this process enabled the parent-session boundary may
   * finish their existing access-token lifetime in single-tenant mode. The
   * JWT's own expiry is still enforced by jose, and tokens minted after this
   * cutoff cannot enter the compatibility path.
   */
  private readonly legacyWebAccessIssuedAtCutoffSeconds: number;
  private nativeSessionValidator: NativeAccessSessionValidator | null = null;
  private authorizationRevisionResolver: ((context: AuthContext) => string | null) | null = null;
  private runtimeProfileGuard: (() => void) | null = null;

  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
    private readonly publicKeyJWK: JWK,
    private readonly keyId: string,
    private userStore: UserStore | null,
    config: TokenServiceConfig,
  ) {
    this.db = config.db;
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
    this.legacyWebAccessIssuedAtCutoffSeconds = Math.floor(Date.now() / 1_000);
    this.authSessionService = config.authSessionService
      ?? new AuthSessionService(new AuthSessionStore(config.db), 'single', null);
  }

  /**
   * Wire up the UserStore dependency after creation.
   * Called by the auth plugin after both services are initialized.
   */
  setUserStore(store: UserStore): void {
    this.userStore = store;
    store.setAuthSessionRevoker(this.authSessionService);
  }

  /** Attach the live native refresh-family boundary after auth startup. */
  setNativeSessionValidator(validator: NativeAccessSessionValidator): void {
    this.nativeSessionValidator = validator;
  }

  /** Attach the app-local live advanced-assignment revision resolver. */
  setAuthorizationRevisionResolver(
    resolver: (context: AuthContext) => string | null,
  ): void {
    this.authorizationRevisionResolver = resolver;
  }

  /** Fence token authority after another runtime commits a profile change. */
  setRuntimeProfileGuard(guard: () => void): void {
    this.runtimeProfileGuard = guard;
  }

  /** Recheck the exact committed profile for cached request-level facades. */
  assertCurrentProfile(): void {
    this.assertRuntimeProfileCurrent();
  }

  /** Lifetime advertised by OAuth token responses. */
  getAccessTokenTTLSeconds(): number {
    return Math.floor(parseTTLtoMs(this.accessTokenTTL) / 1_000);
  }

  /** Shared revision used by managed Sync to detect cross-replica invalidation. */
  getAuthorityRevision(): number | null {
    this.assertRuntimeProfileCurrent();
    return readAuthAuthorityRevision(this.db);
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
  }, expectedAuthGeneration?: number, session?: AuthSessionRecord): Promise<string> {
    this.assertRuntimeProfileCurrent();
    const authGeneration = expectedAuthGeneration
      ?? currentAuthGeneration(this.userStore, user.userId);
    const token = await new SignJWT({
      sub: user.userId,
      email: user.email,
      role: user.role,
      authGeneration,
      sessionKind: session ? 'web' : undefined,
      sid: session?.sessionId,
      sessionGeneration: session?.generation,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .setIssuedAt()
      .setExpirationTime(this.accessTokenTTL)
      .setIssuer('auth')
      .sign(this.privateKey);
    this.assertRuntimeProfileCurrent();
    return token;
  }

  /** Verify token crypto while fencing use through this installed runtime. */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    this.assertRuntimeProfileCurrent();
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['ES256'],
        issuer: 'auth',
      });
      this.assertRuntimeProfileCurrent();
      return {
        sub: payload.sub!,
        email: payload.email as string,
        role: payload.role as string,
        authGeneration: readAuthGeneration(payload.authGeneration),
        sessionKind: payload.sessionKind === 'web' ? 'web' : undefined,
        sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
        sessionGeneration: readOptionalGeneration(payload.sessionGeneration),
      };
    } catch (error) {
      if (error instanceof AuthError && error.code === 'AUTH_PROFILE_CHANGED') {
        throw error;
      }
      if (!this.nativeIssuer || !this.nativeAudience) return null;
      const payload = await verifyNativeAccessToken({
        token, publicKey: this.publicKey,
        issuer: this.nativeIssuer, audience: this.nativeAudience,
      });
      this.assertRuntimeProfileCurrent();
      return payload;
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
    this.assertRuntimeProfileCurrent();
    if (!this.nativeIssuer || !this.nativeAudience) {
      throw new Error('TokenService: native token issuer is not configured');
    }
    const token = await signOidcAccessToken({
      privateKey: this.privateKey, keyId: this.keyId, issuer: this.nativeIssuer,
      audience: this.nativeAudience, clientId, scope, user,
      authGeneration, sessionId,
      ttl: this.accessTokenTTL,
    });
    this.assertRuntimeProfileCurrent();
    return token;
  }

  /** Sign an OpenID Connect ID token for the native client itself. */
  async signNativeIdToken(
    user: UserRecord,
    clientId: string,
    nonce: string | undefined,
    scope: string
  ): Promise<string> {
    this.assertRuntimeProfileCurrent();
    if (!this.nativeIssuer) throw new Error('TokenService: native token issuer is not configured');
    const token = await signOidcIdToken({
      privateKey: this.privateKey, keyId: this.keyId, issuer: this.nativeIssuer,
      clientId, nonce, scope, user,
    });
    this.assertRuntimeProfileCurrent();
    return token;
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
    this.assertRuntimeProfileCurrent();
    const authGeneration = currentAuthGeneration(this.userStore, user.userId);
    const token = await new SignJWT({
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
    this.assertRuntimeProfileCurrent();
    return token;
  }

  /**
   * Verify a short-lived auth transition token.
   */
  async verifyTransitionToken(
    token: string,
    allowedPurpose: AuthTransitionPurpose | AuthTransitionPurpose[]
  ): Promise<AuthTransitionTokenPayload | null> {
    this.assertRuntimeProfileCurrent();
    const allowed = Array.isArray(allowedPurpose) ? allowedPurpose : [allowedPurpose];
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['ES256'],
        issuer: 'auth-transition',
      });
      // Do not let verification begun by an old runtime become authority
      // after another process commits a profile generation change.
      this.assertRuntimeProfileCurrent();
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
    } catch (error) {
      if (error instanceof AuthError && error.code === 'AUTH_PROFILE_CHANGED') {
        throw error;
      }
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
    this.assertRuntimeProfileCurrent();
    const payload = await this.verifyAccessToken(token);
    this.assertRuntimeProfileCurrent();
    if (!payload) return null;

    if (!this.userStore) return null;

    const user = this.userStore.getUserById(payload.sub);
    if (!user || !canUserReceiveTokens(user)) return null;
    if (!isCurrentAuthGeneration(this.userStore, user.userId, payload.authGeneration)) return null;
    if (payload.sessionKind === 'native') {
      if (!payload.sessionId || !payload.clientId || !this.nativeSessionValidator) return null;
      const authority = this.nativeSessionValidator.resolveAuthority({
        sessionId: payload.sessionId, userId: user.userId,
        clientId: payload.clientId, authGeneration: payload.authGeneration,
      });
      if (!authority) return null;
      return this.withAuthorizationRevision({
        userId: user.userId,
        email: user.email,
        role: user.role,
        clientId: payload.clientId,
        sessionKind: 'native',
        scope: payload.scope,
        sessionId: payload.sessionId,
        sessionScopeKind: authority.snapshot.scopeKind,
        sessionScopeId: authority.snapshot.scopeId,
        ...(authority.snapshot.scopeKind === 'tenant' ? {
          tenantId: authority.snapshot.tenantId!,
          membershipId: authority.snapshot.membershipId!,
          tenantRole: authority.tenantRole,
          tenantAuthorizationGeneration:
            authority.snapshot.tenantAuthorizationGeneration!,
          membershipAuthorizationGeneration:
            authority.snapshot.membershipAuthorizationGeneration!,
        } : {}),
      });
    } else if (payload.sessionKind === 'web') {
      if (!payload.sessionId || payload.sessionGeneration === undefined) return null;
      const authority = this.authSessionService.resolveWebSessionAuthority({
        sessionId: payload.sessionId,
        userId: user.userId,
        generation: payload.sessionGeneration,
      });
      if (!authority) return null;
      return this.withAuthorizationRevision(this.toWebAuthContext(
        user,
        authority.session,
        authority.tenantRole,
      ));
    } else {
      // Upgrade compatibility only: an already-issued single-tenant browser
      // JWT has no kind/sid. It may finish its original short TTL while still
      // passing live user and auth-generation checks. Multi-tenant mode cannot
      // infer an authority scope, so the same token always fails closed there.
      if (!this.authSessionService.allowsLegacyUnboundWebAccess()
        || !await this.isPreBoundaryLegacyWebAccess(token)) {
        return null;
      }
      this.assertRuntimeProfileCurrent();
      return this.withAuthorizationRevision({
        userId: user.userId,
        email: user.email,
        role: user.role,
      });
    }

    return null;
  }

  /**
   * Capture a non-credential reference to the exact live request authority.
   * Background systems persist this reference instead of persisting a bearer
   * token, then call `resolveAuthContextAuthority()` at each commit boundary.
   */
  captureAuthContextAuthority(
    context: AuthContext,
  ): AuthContextAuthorityReference | null {
    this.assertRuntimeProfileCurrent();
    if (!this.userStore
      || !context.sessionKind
      || !context.sessionId
      || !context.sessionScopeKind
      || !context.sessionScopeId) return null;

    const reference: AuthContextAuthorityReference = Object.freeze({
      version: 1,
      userId: context.userId,
      platformRole: context.role,
      authGeneration: this.userStore.getAuthGeneration(context.userId),
      sessionKind: context.sessionKind,
      sessionId: context.sessionId,
      sessionGeneration: context.sessionGeneration ?? null,
      clientId: context.clientId ?? null,
      identityScopes: Object.freeze([...(context.scope ?? [])].sort(compareText)),
      sessionScopeKind: context.sessionScopeKind,
      sessionScopeId: context.sessionScopeId,
      tenantId: context.tenantId ?? null,
      membershipId: context.membershipId ?? null,
      tenantRole: context.tenantRole ?? null,
      tenantAuthorizationGeneration: context.tenantAuthorizationGeneration ?? null,
      membershipAuthorizationGeneration:
        context.membershipAuthorizationGeneration ?? null,
      authorizationAssignmentRevision:
        context.authorizationAssignmentRevision ?? null,
    });
    const current = this.resolveAuthContextAuthority(reference);
    return current && authContextMatchesAuthorityReference(current, reference)
      ? reference
      : null;
  }

  /**
   * Re-resolve a captured request authority without retaining a bearer token.
   * Session revocation/expiry, account security changes, tenant suspension,
   * membership changes, and advanced-role revisions all fail closed.
   */
  resolveAuthContextAuthority(
    reference: AuthContextAuthorityReference,
  ): AuthContext | null {
    this.assertRuntimeProfileCurrent();
    if (!this.userStore || reference.version !== 1) return null;
    const user = this.userStore.getUserById(reference.userId);
    if (!user || !canUserReceiveTokens(user)) return null;
    if (!isCurrentAuthGeneration(
      this.userStore,
      reference.userId,
      reference.authGeneration,
    )) return null;

    let current: AuthContext | null = null;
    if (reference.sessionKind === 'web') {
      if (reference.sessionGeneration === null || reference.clientId !== null) return null;
      const authority = this.authSessionService.resolveWebSessionAuthority({
        sessionId: reference.sessionId,
        userId: reference.userId,
        generation: reference.sessionGeneration,
      });
      if (!authority) return null;
      current = this.withAuthorizationRevision(this.toWebAuthContext(
        user,
        authority.session,
        authority.tenantRole,
      ));
    } else {
      if (!reference.clientId
        || reference.sessionGeneration !== null
        || !this.nativeSessionValidator) return null;
      const authority = this.nativeSessionValidator.resolveAuthority({
        sessionId: reference.sessionId,
        userId: reference.userId,
        clientId: reference.clientId,
        authGeneration: reference.authGeneration,
      });
      if (!authority) return null;
      current = this.withAuthorizationRevision({
        userId: user.userId,
        email: user.email,
        role: user.role,
        clientId: reference.clientId,
        sessionKind: 'native',
        scope: Object.freeze(authority.session.scope
          .split(/\s+/u)
          .filter(Boolean)
          .sort(compareText)),
        sessionId: reference.sessionId,
        sessionScopeKind: authority.snapshot.scopeKind,
        sessionScopeId: authority.snapshot.scopeId,
        ...(authority.snapshot.scopeKind === 'tenant' ? {
          tenantId: authority.snapshot.tenantId!,
          membershipId: authority.snapshot.membershipId!,
          tenantRole: authority.tenantRole,
          tenantAuthorizationGeneration:
            authority.snapshot.tenantAuthorizationGeneration!,
          membershipAuthorizationGeneration:
            authority.snapshot.membershipAuthorizationGeneration!,
        } : {}),
      });
    }

    this.assertRuntimeProfileCurrent();
    return current && authContextMatchesAuthorityReference(current, reference)
      ? current
      : null;
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
    this.assertRuntimeProfileCurrent();
    if (!this.userStore || !rawRefreshToken) return null;

    const record = this.userStore.getRefreshTokenByHash(
      this.hashToken(rawRefreshToken)
    );
    if (!record || record.revokedAt !== null || record.expiresAt <= Date.now()) {
      return null;
    }

    const user = this.userStore.getUserById(record.userId);
    if (!user || !canUserReceiveTokens(user)) return null;
    const parent = this.resolveOrAdoptRefreshParent(record);
    if (!parent) return null;
    const { session } = parent;

    const token = await new SignJWT({ sid: record.tokenId })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .setSubject(user.userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Math.min(record.expiresAt, session.expiresAt) / 1_000))
      .setIssuer('auth-page-session')
      .sign(this.privateKey);
    this.assertRuntimeProfileCurrent();

    return { token, expiresAt: Math.min(record.expiresAt, session.expiresAt) };
  }

  /**
   * Resolve a page-only JWT against its live refresh-session row and current
   * user record. Rotation, logout, session revocation, password actions,
   * suspension, deletion, and expiry therefore invalidate SSR authentication
   * immediately without granting cookie access to APIs.
   */
  async resolvePageSessionToken(token: string): Promise<AuthContext | null> {
    this.assertRuntimeProfileCurrent();
    const record = await this.resolvePageSessionRecord(token);
    this.assertRuntimeProfileCurrent();
    if (!record || !this.userStore) return null;

    const user = this.userStore.getUserById(record.userId);
    if (!user || !canUserReceiveTokens(user)) return null;
    const parent = this.resolveOrAdoptRefreshParent(record);
    return parent ? this.withAuthorizationRevision(this.toWebAuthContext(
      user,
      parent.session,
      parent.tenantRole,
    )) : null;
  }

  /** Revoke the refresh session referenced by an existing page cookie. */
  async revokePageSessionToken(
    token: string,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<boolean> {
    this.assertRuntimeProfileCurrent();
    const record = await this.resolvePageSessionRecord(token);
    this.assertRuntimeProfileCurrent();
    if (!record || !this.userStore) return false;

    if (record.sessionId) {
      this.authSessionService.revoke(
        record.sessionId,
        'page-session-replaced',
        Date.now(),
        { provenance: 'authenticated-request', request: auditRequest },
      );
    }
    this.userStore.revokeRefreshToken(record.tokenId);
    return true;
  }

  /**
   * Issue a full token pair (access + refresh) for a user.
   * Stores the refresh token hash in the database.
   */
  async issueTokenPair(
    user: UserRecord,
    options: WebSessionIssueOptions = {},
  ): Promise<TokenPair> {
    const tokens = await this.issueTokenPairInternal(user, options);
    this.assertRuntimeProfileCurrent();
    if (!tokens) {
      throw new AuthError(
        'Authentication state changed; sign in again',
        'AUTH_STATE_CHANGED',
        409
      );
    }
    return tokens;
  }

  /**
   * Issue a pair only if a one-time admission proof is consumed in the same
   * transaction as the new parent and refresh row.
   */
  async issueTokenPairAfterAdmission(
    user: UserRecord,
    options: WebSessionIssueOptions,
    admit: () => boolean,
  ): Promise<TokenPair | null> {
    const tokens = await this.issueTokenPairInternal(user, options, admit);
    this.assertRuntimeProfileCurrent();
    return tokens;
  }

  private async issueTokenPairInternal(
    user: UserRecord,
    options: WebSessionIssueOptions,
    admit?: () => boolean,
  ): Promise<TokenPair | null> {
    this.assertRuntimeProfileCurrent();
    if (!this.userStore) {
      throw new Error('TokenService: UserStore not wired');
    }
    assertUserCanReceiveTokens(user);

    const authGeneration = this.userStore.getAuthGeneration(user.userId);
    const createdAt = Date.now();
    const expiresAt = createdAt + this.refreshTokenTTLMs;
    const session = this.authSessionService.prepareWebSession({
      userId: user.userId,
      expiresAt,
      binding: options.binding,
    });
    const accessToken = await this.signAccessToken(user, authGeneration, session);
    const refreshToken = crypto.randomUUID();
    const refreshHash = this.hashToken(refreshToken);
    const tokenId = crypto.randomUUID();
    const stored = this.authSessionService.persistPreparedWebSession(
      session,
      () => this.userStore!.storeRefreshTokenIfCurrent(
        tokenId,
        user,
        refreshHash,
        expiresAt,
        createdAt,
        authGeneration,
        session.sessionId,
      ),
      admit,
    );
    if (!stored) return null;

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
    this.assertRuntimeProfileCurrent();
    if (!this.userStore) {
      throw new Error('TokenService: UserStore not wired');
    }

    const hash = this.hashToken(rawToken);
    const record = this.userStore.getRefreshTokenByHash(hash);

    if (!record) return null;

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
    const parent = this.resolveOrAdoptRefreshParent(record);
    if (!parent) return null;
    const currentRecord = parent.record;
    const { session } = parent;
    const accessToken = await this.signAccessToken(user, authGeneration, session);
    const refreshToken = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + this.refreshTokenTTLMs;
    const rotated = this.authSessionService.withActiveWebSession(
      {
        sessionId: session.sessionId,
        userId: user.userId,
        generation: session.generation,
      },
      expiresAt,
      () => this.userStore!.rotateRefreshTokenAtomically(currentRecord, {
        tokenId: crypto.randomUUID(),
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
        createdAt,
      }, authGeneration, createdAt),
    );
    if (!rotated || rotated.value !== 'rotated') return null;
    return { accessToken, refreshToken };
  }

  /** Resolve a raw refresh credential into its live durable web authority. */
  resolveWebRefreshProof(rawToken: string): WebRefreshProof | null {
    this.assertRuntimeProfileCurrent();
    if (!this.userStore || !rawToken) return null;
    const record = this.userStore.getRefreshTokenByHash(this.hashToken(rawToken));
    if (!record) return null;
    // A consumed refresh credential is a replay even when the caller reaches
    // a proof-gated tenant endpoint before the rotation method. Invalidate the
    // winning family consistently instead of making event-loop scheduling
    // decide whether the replay response has security side effects.
    if (record.revokedAt !== null) {
      this.userStore.invalidateRefreshTokenReplay(record.userId);
      return null;
    }
    if (record.expiresAt <= Date.now()) return null;
    const user = this.userStore.getUserById(record.userId);
    if (!user || !canUserReceiveTokens(user)) return null;
    const parent = this.resolveOrAdoptRefreshParent(record);
    return parent ? { user, ...parent } : null;
  }

  /**
   * Replace a live browser parent with a new tenant-bound parent while
   * consuming its current refresh child exactly once.
   */
  async replaceWebSession(
    rawToken: string,
    binding: NonNullable<WebSessionIssueOptions['binding']>,
    admit: () => boolean = () => true,
    onReplaced?: (input: {
      user: UserRecord;
      previous: AuthSessionRecord;
      replacement: AuthSessionRecord;
    }) => void,
  ): Promise<{ user: UserRecord; tokens: TokenPair } | null> {
    this.assertRuntimeProfileCurrent();
    if (!this.userStore) {
      throw new Error('TokenService: UserStore not wired');
    }
    const hash = this.hashToken(rawToken);
    const initial = this.userStore.getRefreshTokenByHash(hash);
    if (!initial) return null;
    if (initial.revokedAt !== null) {
      this.userStore.invalidateRefreshTokenReplay(initial.userId);
      return null;
    }
    if (initial.expiresAt <= Date.now()) return null;

    const proof = this.resolveWebRefreshProof(rawToken);
    if (!proof) return null;
    const { user, record: current, session: previous } = proof;
    const authGeneration = this.userStore.getAuthGeneration(user.userId);
    const createdAt = Date.now();
    const expiresAt = createdAt + this.refreshTokenTTLMs;
    const replacement = this.authSessionService.prepareWebSession({
      userId: user.userId,
      binding,
      expiresAt,
      authenticatedAt: previous.authenticatedAt,
    });
    const accessToken = await this.signAccessToken(
      user,
      authGeneration,
      replacement,
    );
    const refreshToken = crypto.randomUUID();
    const rotated = this.userStore.replaceRefreshSessionAtomically(
      current,
      {
        tokenId: crypto.randomUUID(),
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
        createdAt,
      },
      replacement.sessionId,
      authGeneration,
      () => {
        if (!admit() || !this.authSessionService.replacePreparedWebSession(
          previous,
          replacement,
        )) return false;
        onReplaced?.({ user, previous, replacement });
        return true;
      },
      createdAt,
    );
    return rotated === 'rotated'
      ? { user, tokens: { accessToken, refreshToken } }
      : null;
  }

  /**
   * Revoke a refresh token by raw token string (for logout).
   * Returns true if the token was found and revoked.
   */
  revokeRefreshTokenByRaw(
    rawToken: string,
    auditRequest?: AuthAuditRequestContext,
  ): boolean {
    this.assertRuntimeProfileCurrent();
    if (!this.userStore) return false;

    const hash = this.hashToken(rawToken);
    const record = this.userStore.getRefreshTokenByHash(hash);
    if (!record) return false;

    if (record.sessionId) {
      this.authSessionService.revoke(
        record.sessionId,
        'logout',
        Date.now(),
        { provenance: 'authenticated-request', request: auditRequest },
      );
    }
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

  private toWebAuthContext(
    user: UserRecord,
    session: AuthSessionRecord,
    tenantRole: string | null,
  ): AuthContext {
    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      sessionKind: 'web',
      sessionId: session.sessionId,
      sessionGeneration: session.generation,
      sessionScopeKind: session.scopeKind,
      sessionScopeId: session.scopeId,
      ...(session.scopeKind === 'tenant' ? {
        tenantId: session.tenantId!,
        membershipId: session.membershipId!,
        tenantRole,
        tenantAuthorizationGeneration: session.tenantAuthorizationGeneration!,
        membershipAuthorizationGeneration:
          session.membershipAuthorizationGeneration!,
      } : {}),
    };
  }

  private withAuthorizationRevision(context: AuthContext): AuthContext {
    const revision = this.authorizationRevisionResolver?.(context) ?? null;
    this.assertRuntimeProfileCurrent();
    return revision ? { ...context, authorizationAssignmentRevision: revision } : context;
  }

  private resolveOrAdoptRefreshParent(record: RefreshTokenRecord): {
    record: RefreshTokenRecord;
    session: AuthSessionRecord;
    tenantRole: string | null;
  } | null {
    if (!this.userStore) return null;
    let current = record;
    if (!current.sessionId) {
      const adopted = this.authSessionService.adoptLegacySingleRefresh({
        tokenId: current.tokenId,
        userId: current.userId,
        createdAt: current.createdAt,
        expiresAt: current.expiresAt,
      });
      if (adopted) {
        current = { ...current, sessionId: adopted.sessionId };
      } else {
        // A concurrent request may have completed the same one-row adoption.
        current = this.userStore.getRefreshTokenById(current.tokenId) ?? current;
      }
    }
    if (!current.sessionId) return null;
    const authority = this.authSessionService.resolveWebSessionAuthority({
      sessionId: current.sessionId,
      userId: current.userId,
    });
    return authority ? { record: current, ...authority } : null;
  }

  /**
   * Re-read the verified auth JWT's issuance time for the narrow migration
   * exception. This intentionally verifies the signature and issuer again;
   * no unverified decoded claim can opt a token into compatibility.
   */
  private async isPreBoundaryLegacyWebAccess(token: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['ES256'],
        issuer: 'auth',
      });
      return typeof payload.iat === 'number'
        && Number.isSafeInteger(payload.iat)
        && payload.iat <= this.legacyWebAccessIssuedAtCutoffSeconds;
    } catch {
      return false;
    }
  }

  /** SHA-256 hash a token string. Returns hex-encoded hash. */
  private hashToken(token: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(token);
    return hasher.digest('hex');
  }

  private assertRuntimeProfileCurrent(): void {
    this.runtimeProfileGuard?.();
  }
}

function isMfaMethodType(value: unknown): value is AuthTransitionTokenPayload['methodType'] {
  return value === 'email' || value === 'totp';
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

function readOptionalGeneration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function authContextMatchesAuthorityReference(
  context: AuthContext,
  reference: AuthContextAuthorityReference,
): boolean {
  const scopes = [...(context.scope ?? [])].sort(compareText);
  return context.userId === reference.userId
    && context.role === reference.platformRole
    && context.sessionKind === reference.sessionKind
    && context.sessionId === reference.sessionId
    && (context.sessionGeneration ?? null) === reference.sessionGeneration
    && (context.clientId ?? null) === reference.clientId
    && JSON.stringify(scopes) === JSON.stringify(reference.identityScopes)
    && context.sessionScopeKind === reference.sessionScopeKind
    && context.sessionScopeId === reference.sessionScopeId
    && (context.tenantId ?? null) === reference.tenantId
    && (context.membershipId ?? null) === reference.membershipId
    && (context.tenantRole ?? null) === reference.tenantRole
    && (context.tenantAuthorizationGeneration ?? null)
      === reference.tenantAuthorizationGeneration
    && (context.membershipAuthorizationGeneration ?? null)
      === reference.membershipAuthorizationGeneration
    && (context.authorizationAssignmentRevision ?? null)
      === reference.authorizationAssignmentRevision;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
