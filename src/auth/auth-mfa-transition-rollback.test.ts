import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { resolveAuthBehaviorConfig } from './auth-config';
import { authContextAuthorityReferenceFingerprint } from './auth-context-authority';
import { createAuthMfaPlugin } from './auth-mfa.plugin';
import { buildAuthCompletionResponse } from './auth-mfa-response';
import type {
  MfaChallengeService,
  MfaEnrollmentRollbackReceipt,
  MfaLoginChallengeRollbackReceipt,
} from './mfa-challenge-service';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import type { TokenService } from './token-service';
import type { UserStore } from './user-store';
import type {
  AuthContext,
  AuthContextAuthorityReference,
  AuthMfaMethodRecord,
  UserRecord,
} from './types';

describe('MFA transition-token rollback boundaries', () => {
  test('setup route rolls back its exact pending enrollment when signing fails', async () => {
    const user = userRecord();
    const signingError = new Error('signing unavailable');
    const receipt: MfaEnrollmentRollbackReceipt = Object.freeze({
      kind: 'enrollment',
      userId: user.userId,
      methodId: 'mfa_pending',
      methodCreatedAt: 100,
      challengeId: null,
      challengeCreatedAt: null,
    });
    const rolledBack: MfaEnrollmentRollbackReceipt[] = [];
    const tokenService = {
      verifyTransitionToken: async () => ({
        sub: user.userId,
        email: user.email,
        role: user.role,
        authGeneration: 3,
        purpose: 'mfa_setup',
        flow: 'auth',
      }),
      signTransitionToken: async () => {
        throw signingError;
      },
    } as unknown as TokenService;
    const mfa = {
      startEnrollment: async () => ({
        method: publicMethod('mfa_pending', 'pending'),
        rollbackReceipt: receipt,
      }),
      rollbackEnrollment(value: MfaEnrollmentRollbackReceipt) {
        rolledBack.push(value);
        return { methodDisabled: true, challengeConsumed: false };
      },
    } as unknown as MfaChallengeService;
    const app = new Elysia().use(createAuthMfaPlugin({
      getUserStore: () => ({ getUserById: () => user }) as unknown as UserStore,
      getTokenService: () => tokenService,
      getMfaChallengeService: () => mfa,
      getAuthConfig: () => resolveAuthBehaviorConfig({
        mfa: {
          enabled: true,
          policy: 'optional',
          methods: ['totp'],
          totp: { encryptionKey: 'test-key' },
        },
      }),
      getAuthTenantSessionService: () => ({}) as AuthTenantSessionService,
    }));

    const response = await app.handle(new Request('http://localhost/mfa/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupToken: 'setup-token', method: 'totp' }),
    }));

    expect(response.status).toBe(500);
    expect(rolledBack).toEqual([receipt]);
  });

  test('login completion consumes its exact OTP challenge when signing fails', async () => {
    const user = userRecord();
    const method = methodRecord();
    const signingError = new Error('signing unavailable');
    const receipt: MfaLoginChallengeRollbackReceipt = Object.freeze({
      kind: 'login-challenge',
      userId: user.userId,
      methodId: method.methodId,
      challengeId: 'mfach_pending',
      challengeCreatedAt: 200,
    });
    const rolledBack: MfaLoginChallengeRollbackReceipt[] = [];
    const mfa = {
      getActiveChallengeMethod: () => method,
      startLoginChallenge: async () => ({
        method: publicMethod(method.methodId, 'active', 'email'),
        challenge: {
          challengeId: receipt.challengeId,
          methodType: 'email' as const,
          expiresAt: 1_000,
          delivery: 'email' as const,
        },
        rollbackReceipt: receipt,
      }),
      rollbackLoginChallenge(value: MfaLoginChallengeRollbackReceipt) {
        rolledBack.push(value);
        return { challengeConsumed: true };
      },
    } as unknown as MfaChallengeService;
    const tokenService = {
      signTransitionToken: async () => {
        throw signingError;
      },
    } as unknown as TokenService;

    await expect(buildAuthCompletionResponse({
      user,
      tokenService,
      authConfig: resolveAuthBehaviorConfig({
        mfa: { enabled: true, policy: 'optional', methods: ['email'] },
      }),
      mfaChallengeService: mfa,
      tenantSessionService: {} as AuthTenantSessionService,
      expectedAuthGeneration: 3,
    })).rejects.toBe(signingError);
    expect(rolledBack).toEqual([receipt]);
  });

  test('profile activation rejects a different live session before method activation', async () => {
    const user = userRecord();
    const origin = authorityReference('session-origin');
    const other = authorityReference('session-other');
    const contexts = new Map<string, AuthContext>([
      ['origin-token', authContext(origin)],
      ['other-token', authContext(other)],
    ]);
    let verificationAttempts = 0;
    const tokenService = {
      verifyTransitionToken: async () => ({
        sub: user.userId,
        email: user.email,
        role: user.role,
        authGeneration: origin.authGeneration,
        purpose: 'mfa_setup',
        methodId: 'mfa_pending',
        methodType: 'totp',
        flow: 'profile',
        profileAuthorityFingerprint:
          authContextAuthorityReferenceFingerprint(origin),
      }),
      resolveAuthContext: async (token: string) => contexts.get(token) ?? null,
      captureAuthContextAuthority: (context: AuthContext) => (
        context.sessionId === origin.sessionId ? origin : other
      ),
      resolveAuthContextAuthority: (reference: AuthContextAuthorityReference) => (
        contexts.get(reference.sessionId === origin.sessionId
          ? 'origin-token'
          : 'other-token') ?? null
      ),
    } as unknown as TokenService;
    const mfa = {
      verifyEnrollment: async () => {
        verificationAttempts += 1;
        return publicMethod('mfa_pending', 'active');
      },
      listPublicMethods: () => [],
    } as unknown as MfaChallengeService;
    const app = new Elysia().use(createAuthMfaPlugin({
      getUserStore: () => ({ getUserById: () => user }) as unknown as UserStore,
      getTokenService: () => tokenService,
      getMfaChallengeService: () => mfa,
      getAuthConfig: () => resolveAuthBehaviorConfig({
        mfa: {
          enabled: true,
          policy: 'optional',
          methods: ['totp'],
          totp: { encryptionKey: 'test-key' },
        },
      }),
      getAuthTenantSessionService: () => ({}) as AuthTenantSessionService,
    }));

    const response = await app.handle(new Request('http://localhost/mfa/setup/verify', {
      method: 'POST',
      headers: {
        authorization: 'Bearer other-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ verificationToken: 'profile-token', code: '123456' }),
    }));

    expect(response.status).toBe(409);
    expect(verificationAttempts).toBe(0);
  });
});

function userRecord(): UserRecord {
  return {
    userId: 'user-mfa-rollback',
    username: 'mfa-rollback',
    email: 'mfa-rollback@example.test',
    firstName: null,
    lastName: null,
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: 1,
    emailVerificationRequired: false,
    mfaRequired: false,
    createdAt: 1,
    updatedAt: null,
    properties: {},
  };
}

function methodRecord(): AuthMfaMethodRecord {
  return {
    methodId: 'mfa_active',
    userId: 'user-mfa-rollback',
    type: 'email',
    label: 'Email',
    status: 'active',
    isPrimary: true,
    secretCiphertext: null,
    createdAt: 1,
    verifiedAt: 1,
    disabledAt: null,
    lastUsedAt: null,
    metadata: {},
  };
}

function publicMethod(
  methodId: string,
  status: 'pending' | 'active',
  type: 'email' | 'totp' = 'totp',
) {
  return {
    methodId,
    type,
    label: null,
    status,
    isPrimary: status === 'active',
    createdAt: 1,
    verifiedAt: status === 'active' ? 1 : null,
    lastUsedAt: null,
  };
}

function authorityReference(sessionId: string): AuthContextAuthorityReference {
  return Object.freeze({
    version: 1,
    userId: 'user-mfa-rollback',
    platformRole: 'user',
    authGeneration: 3,
    sessionKind: 'web',
    sessionId,
    mfaVerifiedAt: null,
    sessionGeneration: 0,
    clientId: null,
    identityScopes: Object.freeze([]),
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
    tenantId: null,
    membershipId: null,
    tenantKind: null,
    tenantRole: null,
    tenantAuthorizationGeneration: null,
    membershipAuthorizationGeneration: null,
    authorizationAssignmentRevision: null,
  });
}

function authContext(reference: AuthContextAuthorityReference): AuthContext {
  return {
    userId: reference.userId,
    email: 'mfa-rollback@example.test',
    role: reference.platformRole,
    authGeneration: reference.authGeneration,
    sessionKind: reference.sessionKind,
    sessionId: reference.sessionId,
    sessionGeneration: reference.sessionGeneration ?? undefined,
    sessionScopeKind: reference.sessionScopeKind,
    sessionScopeId: reference.sessionScopeId,
  };
}
