/** Internal browser/page token-family lifecycle owned behind TokenService. */

import type { UserStore } from './user-store';
import type { AuthTokenCodec } from './auth-token-codec';
import type { AuthSessionService } from './auth-session-service';
import type {
  AuthSessionRecord,
  WebSessionIssueOptions,
} from './auth-session-types';
import type { AuthAuditRequestContext } from './auth-audit-types';
import { canUserReceiveAuthTokens as canUserReceiveTokens } from './auth-user-eligibility';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { hashToken } from '../tokens/token-utils';
import {
  AuthError,
  type AuthContext,
  type RefreshTokenRecord,
  type TokenPair,
  type TokenServiceConfig,
  type UserRecord,
} from './types';
import type { TenantKind } from './tenancy/tenancy-types';
import { createAuthStateInvariantError } from './auth-observability';

export interface WebSessionRefreshProof {
  user: UserRecord;
  record: RefreshTokenRecord;
  session: AuthSessionRecord;
  tenantKind: TenantKind | null;
  tenantRole: string | null;
}

export interface PageSessionTokenResult {
  token: string;
  expiresAt: number;
}

export interface AuthWebSessionTokenServiceOptions {
  readonly codec: AuthTokenCodec;
  readonly authSessionService: AuthSessionService;
  readonly refreshTokenTTLMs: number;
  readonly emitCode: TokenServiceConfig['emitCode'];
  getUserStore(): UserStore | null;
  assertCurrentProfile(): void;
  signAccessToken(
    user: Pick<UserRecord, 'userId' | 'email' | 'role'>,
    expectedAuthGeneration: number,
    session: AuthSessionRecord,
  ): Promise<string>;
  withAuthorizationRevision(context: AuthContext): AuthContext;
  /** Preserve TokenService's public proof-resolution instrumentation seam. */
  resolveWebRefreshProof(rawToken: string): WebSessionRefreshProof | null;
}

/**
 * Coordinates durable browser refresh families and their page-cookie view.
 * All credential storage remains in UserStore/AuthSessionService transactions;
 * this class only owns the lifecycle orchestration formerly in TokenService.
 */
export class AuthWebSessionTokenService {
  constructor(private readonly options: AuthWebSessionTokenServiceOptions) {}

  async issuePageSessionToken(
    rawRefreshToken: string,
  ): Promise<PageSessionTokenResult | null> {
    this.options.assertCurrentProfile();
    const userStore = this.options.getUserStore();
    if (!userStore || !rawRefreshToken) return null;

    const record = userStore.getRefreshTokenByHash(hashToken(rawRefreshToken));
    if (!record || record.revokedAt !== null || record.expiresAt <= Date.now()) {
      return null;
    }

    const user = userStore.getUserById(record.userId);
    if (!user || !canUserReceiveTokens(user)) return null;
    const parent = this.resolveOrAdoptRefreshParent(record);
    if (!parent) return null;
    const { session } = parent;
    const expiresAt = Math.min(record.expiresAt, session.expiresAt);
    const token = await this.options.codec.signPageSessionToken({
      tokenId: record.tokenId,
      userId: user.userId,
      expiresAtSeconds: Math.floor(expiresAt / 1_000),
    });
    this.options.assertCurrentProfile();
    return { token, expiresAt };
  }

  async resolvePageSessionToken(token: string): Promise<AuthContext | null> {
    this.options.assertCurrentProfile();
    const record = await this.resolvePageSessionRecord(token);
    this.options.assertCurrentProfile();
    const userStore = this.options.getUserStore();
    if (!record || !userStore) return null;

    const user = userStore.getUserById(record.userId);
    if (!user || !canUserReceiveTokens(user)) return null;
    const parent = this.resolveOrAdoptRefreshParent(record);
    return parent ? this.options.withAuthorizationRevision(this.toWebAuthContext(
      user,
      parent.session,
      parent.tenantRole,
      parent.tenantKind,
    )) : null;
  }

  async revokePageSessionToken(
    token: string,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<boolean> {
    this.options.assertCurrentProfile();
    const record = await this.resolvePageSessionRecord(token);
    this.options.assertCurrentProfile();
    const userStore = this.options.getUserStore();
    if (!record || !userStore) return false;

    if (record.sessionId) {
      this.options.authSessionService.revoke(
        record.sessionId,
        'page-session-replaced',
        Date.now(),
        { provenance: 'authenticated-request', request: auditRequest },
      );
    }
    userStore.revokeRefreshToken(record.tokenId);
    return true;
  }

  async issueTokenPair(
    user: UserRecord,
    options: WebSessionIssueOptions = {},
  ): Promise<TokenPair> {
    const tokens = await this.issueTokenPairInternal(user, options);
    this.options.assertCurrentProfile();
    if (!tokens) {
      throw new AuthError(
        'Authentication state changed; sign in again',
        'AUTH_STATE_CHANGED',
        409,
      );
    }
    return tokens;
  }

  async issueTokenPairAfterAdmission(
    user: UserRecord,
    options: WebSessionIssueOptions,
    admit: () => boolean,
  ): Promise<TokenPair | null> {
    const tokens = await this.issueTokenPairInternal(user, options, admit);
    this.options.assertCurrentProfile();
    return tokens;
  }

  async rotateRefreshToken(rawToken: string): Promise<TokenPair | null> {
    this.options.assertCurrentProfile();
    const userStore = this.requireUserStore();
    const record = userStore.getRefreshTokenByHash(hashToken(rawToken));
    if (!record) return null;

    // A consumed token is a replay. Forced-password families were already
    // invalidated, and UserStore avoids a redundant generation bump there.
    if (record.revokedAt !== null) {
      userStore.invalidateRefreshTokenReplay(record.userId);
      return null;
    }
    if (record.expiresAt < Date.now()) return null;

    // Sign before consuming the old token. The atomic rotation invalidates a
    // losing concurrent candidate before that response can remain usable.
    const user = userStore.getUserById(record.userId);
    if (!user) return null;
    assertUserCanReceiveTokens(user);
    const authGeneration = userStore.getAuthGeneration(user.userId);
    const parent = this.resolveOrAdoptRefreshParent(record);
    if (!parent) return null;
    const currentRecord = parent.record;
    const { session } = parent;
    const accessToken = await this.options.signAccessToken(
      user,
      authGeneration,
      session,
    );
    const refreshToken = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + this.options.refreshTokenTTLMs;
    const rotated = this.options.authSessionService.withActiveWebSession(
      {
        sessionId: session.sessionId,
        userId: user.userId,
        generation: session.generation,
      },
      expiresAt,
      () => this.requireUserStore().rotateRefreshTokenAtomically(currentRecord, {
        tokenId: crypto.randomUUID(),
        tokenHash: hashToken(refreshToken),
        expiresAt,
        createdAt,
      }, authGeneration, createdAt),
    );
    if (!rotated || rotated.value !== 'rotated') return null;
    return { accessToken, refreshToken };
  }

  resolveWebRefreshProof(rawToken: string): WebSessionRefreshProof | null {
    this.options.assertCurrentProfile();
    const userStore = this.options.getUserStore();
    if (!userStore || !rawToken) return null;
    const record = userStore.getRefreshTokenByHash(hashToken(rawToken));
    if (!record) return null;
    if (record.revokedAt !== null) {
      userStore.invalidateRefreshTokenReplay(record.userId);
      return null;
    }
    if (record.expiresAt <= Date.now()) return null;
    const user = userStore.getUserById(record.userId);
    if (!user || !canUserReceiveTokens(user)) return null;
    const parent = this.resolveOrAdoptRefreshParent(record);
    return parent ? { user, ...parent } : null;
  }

  resolveWebRefreshAuthContext(rawToken: string): AuthContext | null {
    const proof = this.options.resolveWebRefreshProof(rawToken);
    if (!proof) return null;
    return this.options.withAuthorizationRevision(this.toWebAuthContext(
      proof.user,
      proof.session,
      proof.tenantRole,
      proof.tenantKind,
    ));
  }

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
    this.options.assertCurrentProfile();
    const userStore = this.requireUserStore();
    const initial = userStore.getRefreshTokenByHash(hashToken(rawToken));
    if (!initial) return null;
    if (initial.revokedAt !== null) {
      userStore.invalidateRefreshTokenReplay(initial.userId);
      return null;
    }
    if (initial.expiresAt <= Date.now()) return null;

    const proof = this.options.resolveWebRefreshProof(rawToken);
    if (!proof) return null;
    const { user, record: current, session: previous } = proof;
    const authGeneration = userStore.getAuthGeneration(user.userId);
    const createdAt = Date.now();
    const expiresAt = createdAt + this.options.refreshTokenTTLMs;
    const replacement = this.options.authSessionService.prepareWebSession({
      userId: user.userId,
      binding,
      expiresAt,
      authenticatedAt: previous.authenticatedAt,
      mfaVerifiedAt: previous.mfaVerifiedAt,
    });
    const accessToken = await this.options.signAccessToken(
      user,
      authGeneration,
      replacement,
    );
    const refreshToken = crypto.randomUUID();
    const rotated = this.requireUserStore().replaceRefreshSessionAtomically(
      current,
      {
        tokenId: crypto.randomUUID(),
        tokenHash: hashToken(refreshToken),
        expiresAt,
        createdAt,
      },
      replacement.sessionId,
      authGeneration,
      () => {
        const admitted = invokeSynchronousAuthCallback(admit, {
          component: 'token-service',
          invariant: 'web-session-replacement-admission-async',
          message: '[auth] Web session replacement admission must be synchronous.',
          emitCode: this.options.emitCode,
        });
        if (!admitted || !this.options.authSessionService.replacePreparedWebSession(
          previous,
          replacement,
        )) return false;
        if (onReplaced) {
          invokeSynchronousAuthCallback(
            () => onReplaced({ user, previous, replacement }),
            {
              component: 'token-service',
              invariant: 'web-session-replaced-callback-async',
              message: '[auth] Web session replacement callback must be synchronous.',
              emitCode: this.options.emitCode,
            },
          );
        }
        return true;
      },
      createdAt,
    );
    return rotated === 'rotated'
      ? { user, tokens: { accessToken, refreshToken } }
      : null;
  }

  revokeRefreshTokenByRaw(
    rawToken: string,
    auditRequest?: AuthAuditRequestContext,
  ): boolean {
    this.options.assertCurrentProfile();
    const userStore = this.options.getUserStore();
    if (!userStore) return false;

    const record = userStore.getRefreshTokenByHash(hashToken(rawToken));
    if (!record) return false;
    if (record.sessionId) {
      this.options.authSessionService.revoke(
        record.sessionId,
        'logout',
        Date.now(),
        { provenance: 'authenticated-request', request: auditRequest },
      );
    }
    userStore.revokeRefreshToken(record.tokenId);
    return true;
  }

  toWebAuthContext(
    user: UserRecord,
    session: AuthSessionRecord,
    tenantRole: string | null,
    tenantKind: TenantKind | null,
  ): AuthContext {
    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      sessionKind: 'web',
      sessionId: session.sessionId,
      ...(session.mfaVerifiedAt !== null
        ? { mfaVerifiedAt: session.mfaVerifiedAt }
        : {}),
      sessionGeneration: session.generation,
      sessionScopeKind: session.scopeKind,
      sessionScopeId: session.scopeId,
      ...(session.scopeKind === 'tenant' ? {
        tenantId: session.tenantId!,
        membershipId: session.membershipId!,
        tenantKind: tenantKind!,
        tenantRole,
        tenantAuthorizationGeneration: session.tenantAuthorizationGeneration!,
        membershipAuthorizationGeneration:
          session.membershipAuthorizationGeneration!,
      } : {}),
    };
  }

  private async issueTokenPairInternal(
    user: UserRecord,
    options: WebSessionIssueOptions,
    admit?: () => boolean,
  ): Promise<TokenPair | null> {
    this.options.assertCurrentProfile();
    const userStore = this.requireUserStore();
    assertUserCanReceiveTokens(user);

    const authGeneration = userStore.getAuthGeneration(user.userId);
    const createdAt = Date.now();
    const expiresAt = createdAt + this.options.refreshTokenTTLMs;
    const session = this.options.authSessionService.prepareWebSession({
      userId: user.userId,
      expiresAt,
      binding: options.binding,
      mfaVerifiedAt: options.mfaVerifiedAt,
    });
    const accessToken = await this.options.signAccessToken(
      user,
      authGeneration,
      session,
    );
    const refreshToken = crypto.randomUUID();
    const refreshHash = hashToken(refreshToken);
    const tokenId = crypto.randomUUID();
    const stored = this.options.authSessionService.persistPreparedWebSession(
      session,
      () => this.requireUserStore().storeRefreshTokenIfCurrent(
        tokenId,
        user,
        refreshHash,
        expiresAt,
        createdAt,
        authGeneration,
        session.sessionId,
      ),
      admit
        ? () => invokeSynchronousAuthCallback(admit, {
          component: 'token-service',
          invariant: 'web-session-issuance-admission-async',
          message: '[auth] Web session issuance admission must be synchronous.',
          emitCode: this.options.emitCode,
        })
        : undefined,
    );
    if (!stored) return null;
    return { accessToken, refreshToken };
  }

  private async resolvePageSessionRecord(
    token: string,
  ): Promise<RefreshTokenRecord | null> {
    if (!this.options.getUserStore() || !token) return null;
    try {
      const claims = await this.options.codec.verifyPageSessionToken(token);
      if (!claims) return null;
      const userStore = this.options.getUserStore();
      if (!userStore) return null;
      const record = userStore.getRefreshTokenById(claims.tokenId);
      if (!record || record.userId !== claims.userId) return null;
      if (record.revokedAt !== null || record.expiresAt <= Date.now()) return null;
      return record;
    } catch {
      return null;
    }
  }

  private resolveOrAdoptRefreshParent(record: RefreshTokenRecord): {
    record: RefreshTokenRecord;
    session: AuthSessionRecord;
    tenantKind: TenantKind | null;
    tenantRole: string | null;
  } | null {
    const userStore = this.options.getUserStore();
    if (!userStore) return null;
    let current = record;
    if (!current.sessionId) {
      const adopted = this.options.authSessionService.adoptLegacySingleRefresh({
        tokenId: current.tokenId,
        userId: current.userId,
        createdAt: current.createdAt,
        expiresAt: current.expiresAt,
      });
      if (adopted) {
        current = { ...current, sessionId: adopted.sessionId };
      } else {
        current = userStore.getRefreshTokenById(current.tokenId) ?? current;
      }
    }
    if (!current.sessionId) return null;
    const authority = this.options.authSessionService.resolveWebSessionAuthority({
      sessionId: current.sessionId,
      userId: current.userId,
    });
    return authority ? { record: current, ...authority } : null;
  }

  private requireUserStore(): UserStore {
    const store = this.options.getUserStore();
    if (!store) {
      throw createAuthStateInvariantError(this.options.emitCode, {
        component: 'auth-web-session-token-service',
        invariant: 'user-store-unavailable',
        message: '[auth] Browser token persistence is unavailable.',
      });
    }
    return store;
  }
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
