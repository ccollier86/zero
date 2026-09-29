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
import type {
  NativeAccessSessionClaims,
  NativeAccessSessionValidator,
} from './oidc/native-access-session';
import { AuthSessionService } from './auth-session-service';
import { AuthSessionStore } from './auth-session-store';
import type {
  AuthSessionRecord,
  WebSessionIssueOptions,
} from './auth-session-types';
import type { AuthAuditRequestContext } from './auth-audit-types';
import { canUserReceiveAuthTokens as canUserReceiveTokens } from './auth-user-eligibility';
import { readAuthAuthorityRevision } from './auth-authority-revision';
import { loadOrCreateAuthSigningKeys } from './auth-signing-keys';
import { AuthTokenCodec } from './auth-token-codec';
import { AuthWebSessionTokenService } from './auth-web-session-token-service';
import {
  authContextAuthorityReferenceFingerprint,
  authContextMatchesAuthorityReference,
  snapshotAuthContextAuthorityReference,
} from './auth-context-authority';
import { parseTokenTTL } from '../tokens/token-utils';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { createAuthStateInvariantError } from './auth-observability';

/** Page credential bound to one persisted refresh-session record. */
export interface IssuedPageSession {
  token: string;
  expiresAt: number;
}

/** Server-only proof resolved from a live browser refresh/session family. */
export interface WebRefreshProof {
  user: UserRecord;
  /** Exact user security generation validated with this refresh family. */
  authGeneration: number;
  record: RefreshTokenRecord;
  session: AuthSessionRecord;
  tenantKind: import('./tenancy/tenancy-types').TenantKind | null;
  tenantRole: string | null;
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
  private readonly nativeIssuer?: string;
  private readonly nativeAudience?: string;
  private readonly codec: AuthTokenCodec;
  private readonly authSessionService: AuthSessionService;
  private readonly webSessions: AuthWebSessionTokenService;
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
  private readonly emitCode: TokenServiceConfig['emitCode'];

  private constructor(
    privateKey: CryptoKey,
    publicKey: CryptoKey,
    publicKeyJWK: JWK,
    keyId: string,
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

    const refreshTokenTTLMs = parseTokenTTL(refreshTTL, 'auth refresh token TTL');
    this.nativeIssuer = config.nativeIssuer;
    this.nativeAudience = config.nativeAudience;
    this.codec = new AuthTokenCodec({
      privateKey,
      publicKey,
      publicKeyJWK,
      keyId,
    });
    this.emitCode = config.emitCode;
    this.legacyWebAccessIssuedAtCutoffSeconds = Math.floor(Date.now() / 1_000);
    this.authSessionService = config.authSessionService
      ?? new AuthSessionService(
        new AuthSessionStore(config.db),
        'single',
        null,
        undefined,
        config.emitCode,
      );
    this.webSessions = new AuthWebSessionTokenService({
      codec: this.codec,
      authSessionService: this.authSessionService,
      refreshTokenTTLMs,
      emitCode: this.emitCode,
      getUserStore: () => this.userStore,
      assertCurrentProfile: () => this.assertRuntimeProfileCurrent(),
      signAccessToken: (user, authGeneration, session) => (
        this.signAccessToken(user, authGeneration, session)
      ),
      withAuthorizationRevision: (context) => this.withAuthorizationRevision(context),
      resolveWebRefreshProof: (rawToken) => this.resolveWebRefreshProof(rawToken),
    });
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
    return Math.floor(parseTokenTTL(this.accessTokenTTL, 'auth access token TTL') / 1_000);
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
    const keys = await loadOrCreateAuthSigningKeys(config);
    return new TokenService(
      keys.privateKey,
      keys.publicKey,
      keys.publicKeyJWK,
      keys.keyId,
      null,
      config,
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
    const token = await this.codec.signBrowserAccessToken({
      user,
      authGeneration,
      session,
      ttl: this.accessTokenTTL,
    });
    this.assertRuntimeProfileCurrent();
    return token;
  }

  /** Verify token crypto while fencing use through this installed runtime. */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    this.assertRuntimeProfileCurrent();
    try {
      const payload = await this.codec.verifyBrowserAccessToken(token);
      this.assertRuntimeProfileCurrent();
      return payload;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (!this.nativeIssuer || !this.nativeAudience) return null;
      const payload = await this.codec.verifyNativeAccessToken({
        token,
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
    const token = await this.codec.signNativeAccessToken({
      issuer: this.nativeIssuer,
      audience: this.nativeAudience,
      clientId,
      scope,
      user,
      authGeneration,
      sessionId,
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
    const token = await this.codec.signNativeIdToken({
      issuer: this.nativeIssuer,
      clientId,
      nonce,
      scope,
      user,
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
   * Authentication ceremonies must pass the exact generation proved by their
   * password or durable transition receipt. Omitting it is reserved for
   * trusted server issuance that did not authenticate an earlier credential.
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
      /** Preserve the generation proven by the ceremony that requested this token. */
      expectedAuthGeneration?: number;
      /**
       * Exact live session authority that began a profile MFA enrollment.
       * The credential-free reference is checked before and after signing; only
       * its opaque fingerprint is placed in the transition token.
       */
      profileAuthority?: AuthContextAuthorityReference;
    }
  ): Promise<string> {
    this.assertRuntimeProfileCurrent();
    const capturedUser = Object.freeze({
      userId: user.userId,
      email: user.email,
      role: user.role,
    });
    const authGeneration = params.expectedAuthGeneration
      ?? currentAuthGeneration(this.userStore, capturedUser.userId);
    const profileAuthority = params.profileAuthority
      ? snapshotAuthContextAuthorityReference(params.profileAuthority)
      : null;
    if ((params.flow === 'profile' && params.purpose !== 'mfa_setup')
      || (params.flow === 'profile') !== Boolean(profileAuthority)
      || (profileAuthority
        && (profileAuthority.userId !== capturedUser.userId
          || profileAuthority.authGeneration !== authGeneration))) {
      throw createAuthStateInvariantError(this.emitCode, {
        component: 'token-service',
        invariant: 'profile-transition-authority-invalid',
        message: '[auth] Profile transition token authority is invalid.',
      });
    }
    if (this.userStore && !isCurrentAuthGeneration(
      this.userStore,
      capturedUser.userId,
      authGeneration,
    )) throw authenticationStateChanged();
    if (profileAuthority && !this.resolveAuthContextAuthority(profileAuthority)) {
      throw authenticationStateChanged();
    }
    const token = await this.codec.signTransitionToken({
      subject: { ...capturedUser, authGeneration },
      claims: {
        purpose: params.purpose,
        methodId: params.methodId,
        methodType: params.methodType,
        challengeId: params.challengeId,
        flow: params.flow,
        profileAuthorityFingerprint: profileAuthority
          ? authContextAuthorityReferenceFingerprint(profileAuthority)
          : undefined,
      },
      ttl: params.ttl,
    });
    this.assertRuntimeProfileCurrent();
    if (this.userStore && !isCurrentAuthGeneration(
      this.userStore,
      capturedUser.userId,
      authGeneration,
    )) throw authenticationStateChanged();
    if (profileAuthority && !this.resolveAuthContextAuthority(profileAuthority)) {
      throw authenticationStateChanged();
    }
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
      const payload = await this.codec.verifyTransitionToken(token);
      // Do not let verification begun by an old runtime become authority
      // after another process commits a profile generation change.
      this.assertRuntimeProfileCurrent();
      const purpose = payload.purpose as AuthTransitionPurpose | undefined;
      if (!purpose || !allowed.includes(purpose)) return null;

      const userId = payload.sub;
      if (typeof userId !== 'string' || !userId) return null;
      if (typeof payload.email !== 'string' || typeof payload.role !== 'string') {
        return null;
      }
      const authGeneration = readAuthGeneration(payload.authGeneration);
      const flow = payload.flow === 'auth' || payload.flow === 'profile'
        ? payload.flow
        : undefined;
      const profileAuthorityFingerprint = isAuthorityFingerprint(
        payload.profileAuthorityFingerprint,
      ) ? payload.profileAuthorityFingerprint : undefined;
      if (flow === 'profile' && purpose !== 'mfa_setup') return null;
      if ((flow === 'profile') !== Boolean(profileAuthorityFingerprint)) return null;
      if (this.userStore) {
        const user = this.userStore.getUserById(userId);
        if (!user || !isCurrentAuthGeneration(this.userStore, userId, authGeneration)) {
          return null;
        }
      }

      return {
        sub: userId,
        email: payload.email,
        role: payload.role,
        authGeneration,
        purpose,
        methodId: typeof payload.methodId === 'string' ? payload.methodId : undefined,
        methodType: isMfaMethodType(payload.methodType) ? payload.methodType : undefined,
        challengeId: typeof payload.challengeId === 'string' ? payload.challengeId : undefined,
        flow,
        profileAuthorityFingerprint,
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      return null;
    }
  }

  /**
   * Resolve an access token into request auth context.
   *
   * Unlike `verifyAccessToken`, this requires the current user row so
   * suspended and forced-reset accounts fail closed.
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
      if (!payload.sessionId || !payload.clientId) return null;
      const authority = this.resolveNativeSessionAuthority({
        sessionId: payload.sessionId, userId: user.userId,
        clientId: payload.clientId, authGeneration: payload.authGeneration,
      });
      if (!authority) return null;
      return this.withAuthorizationRevision({
        userId: user.userId,
        email: user.email,
        role: user.role,
        authGeneration: payload.authGeneration,
        clientId: payload.clientId,
        sessionKind: 'native',
        scope: payload.scope,
        sessionId: payload.sessionId,
        ...(authority.session.mfaVerifiedAt !== null
          ? { mfaVerifiedAt: authority.session.mfaVerifiedAt }
          : {}),
        sessionScopeKind: authority.snapshot.scopeKind,
        sessionScopeId: authority.snapshot.scopeId,
        ...(authority.snapshot.scopeKind === 'tenant' ? {
          tenantId: authority.snapshot.tenantId!,
          membershipId: authority.snapshot.membershipId!,
          tenantKind: authority.tenantKind!,
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
        authority.tenantKind,
        payload.authGeneration,
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
        authGeneration: payload.authGeneration,
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
      || !context.sessionScopeId
      || context.authGeneration === undefined) return null;

    const reference: AuthContextAuthorityReference = Object.freeze({
      version: 1,
      userId: context.userId,
      platformRole: context.role,
      authGeneration: context.authGeneration,
      sessionKind: context.sessionKind,
      sessionId: context.sessionId,
      mfaVerifiedAt: context.mfaVerifiedAt ?? null,
      sessionGeneration: context.sessionGeneration ?? null,
      clientId: context.clientId ?? null,
      identityScopes: Object.freeze([...(context.scope ?? [])].sort(compareText)),
      sessionScopeKind: context.sessionScopeKind,
      sessionScopeId: context.sessionScopeId,
      tenantId: context.tenantId ?? null,
      membershipId: context.membershipId ?? null,
      tenantKind: context.tenantKind ?? null,
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
        authority.tenantKind,
        reference.authGeneration,
      ));
    } else {
      if (!reference.clientId
        || reference.sessionGeneration !== null
      ) return null;
      const authority = this.resolveNativeSessionAuthority({
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
        authGeneration: reference.authGeneration,
        clientId: reference.clientId,
        sessionKind: 'native',
        scope: Object.freeze(authority.session.scope
          .split(/\s+/u)
          .filter(Boolean)
          .sort(compareText)),
        sessionId: reference.sessionId,
        ...(authority.session.mfaVerifiedAt !== null
          ? { mfaVerifiedAt: authority.session.mfaVerifiedAt }
          : {}),
        sessionScopeKind: authority.snapshot.scopeKind,
        sessionScopeId: authority.snapshot.scopeId,
        ...(authority.snapshot.scopeKind === 'tenant' ? {
          tenantId: authority.snapshot.tenantId!,
          membershipId: authority.snapshot.membershipId!,
          tenantKind: authority.tenantKind!,
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
    return this.webSessions.issuePageSessionToken(rawRefreshToken);
  }

  /**
   * Resolve a page-only JWT against its live refresh-session row and current
   * user record. Rotation, logout, session revocation, password actions,
   * suspension, deletion, and expiry therefore invalidate SSR authentication
   * immediately without granting cookie access to APIs.
   */
  async resolvePageSessionToken(token: string): Promise<AuthContext | null> {
    return this.webSessions.resolvePageSessionToken(token);
  }

  /** Revoke the refresh session referenced by an existing page cookie. */
  async revokePageSessionToken(
    token: string,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<boolean> {
    return this.webSessions.revokePageSessionToken(token, auditRequest);
  }

  /**
   * Issue a full token pair (access + refresh) for a user.
   * Stores the refresh token hash in the database.
   * Authentication ceremonies must pass `expectedAuthGeneration` from their
   * exact proof/receipt; the optional fallback exists only for compatible,
   * trusted server issuance with no earlier credential-verification gap.
   */
  async issueTokenPair(
    user: UserRecord,
    options: WebSessionIssueOptions = {},
  ): Promise<TokenPair> {
    return this.webSessions.issueTokenPair(user, options);
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
    return this.webSessions.issueTokenPairAfterAdmission(user, options, admit);
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
    return this.webSessions.rotateRefreshToken(rawToken);
  }

  /** Resolve a raw refresh credential into its live durable web authority. */
  resolveWebRefreshProof(rawToken: string): WebRefreshProof | null {
    return this.webSessions.resolveWebRefreshProof(rawToken);
  }

  /**
   * Hydrate a refresh credential into the same live, server-derived context
   * used by bearer authorization. This exposes no credential material and is
   * intended only for commit-fenced server ceremonies such as tenant creation.
   */
  resolveWebRefreshAuthContext(rawToken: string): AuthContext | null {
    return this.webSessions.resolveWebRefreshAuthContext(rawToken);
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
    return this.webSessions.replaceWebSession(
      rawToken,
      binding,
      admit,
      onReplaced,
    );
  }

  /**
   * Revoke a refresh token by raw token string (for logout).
   * Returns true if the token was found and revoked.
   */
  revokeRefreshTokenByRaw(
    rawToken: string,
    auditRequest?: AuthAuditRequestContext,
  ): boolean {
    return this.webSessions.revokeRefreshTokenByRaw(rawToken, auditRequest);
  }

  // ─── JWKS ────────────────────────────────────────────────────────────

  /**
   * Get the public key in JWK Set format for the /auth/jwks endpoint.
   * Standard OIDC-compatible format for external token verification.
   */
  getJWKS(): { keys: JWK[] } {
    return this.codec.getJWKS();
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private toWebAuthContext(
    user: UserRecord,
    session: AuthSessionRecord,
    tenantRole: string | null,
    tenantKind: import('./tenancy/tenancy-types').TenantKind | null,
    authGeneration: number,
  ): AuthContext {
    return this.webSessions.toWebAuthContext(
      user,
      session,
      tenantRole,
      tenantKind,
      authGeneration,
    );
  }

  private withAuthorizationRevision(context: AuthContext): AuthContext {
    const revision = this.authorizationRevisionResolver
      ? invokeSynchronousAuthCallback(
        () => this.authorizationRevisionResolver!(context),
        {
          component: 'token-service',
          invariant: 'authorization-revision-resolver-async',
          message: '[auth] Authorization revision resolution must be synchronous.',
          emitCode: this.emitCode,
        },
      )
      : null;
    this.assertRuntimeProfileCurrent();
    return revision ? { ...context, authorizationAssignmentRevision: revision } : context;
  }

  /**
   * Re-read the verified auth JWT's issuance time for the narrow migration
   * exception. This intentionally verifies the signature and issuer again;
   * no unverified decoded claim can opt a token into compatibility.
   */
  private async isPreBoundaryLegacyWebAccess(token: string): Promise<boolean> {
    return this.codec.wasBrowserAccessIssuedBy(
      token,
      this.legacyWebAccessIssuedAtCutoffSeconds,
    );
  }

  private assertRuntimeProfileCurrent(): void {
    if (!this.runtimeProfileGuard) return;
    invokeSynchronousAuthCallback(this.runtimeProfileGuard, {
      component: 'token-service',
      invariant: 'runtime-profile-guard-async',
      message: '[auth] Token runtime profile guard must be synchronous.',
      emitCode: this.emitCode,
    });
  }

  private resolveNativeSessionAuthority(
    claims: NativeAccessSessionClaims,
  ): ReturnType<NativeAccessSessionValidator['resolveAuthority']> {
    const validator = this.nativeSessionValidator;
    if (!validator) return null;
    return invokeSynchronousAuthCallback(
      () => validator.resolveAuthority(claims),
      {
        component: 'token-service',
        invariant: 'native-session-validator-async',
        message: '[auth] Native session authority resolution must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }
}

function isMfaMethodType(value: unknown): value is AuthTransitionTokenPayload['methodType'] {
  return value === 'email' || value === 'totp';
}

function isAuthorityFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function authenticationStateChanged(): AuthError {
  return new AuthError(
    'Authentication state changed; sign in again',
    'AUTH_STATE_CHANGED',
    409,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
