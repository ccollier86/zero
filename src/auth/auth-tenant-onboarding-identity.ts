import { createRequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationScopeSnapshot } from './authorization-kernel';
import { extractAuthContext } from './auth-context';
import {
  authAuditActorFromContext,
} from './auth-audit-service';
import type { AuthAuditActor } from './auth-audit-types';
import { captureAuthSessionIdentityAdmission } from './auth-session-identity-proof';
import {
  captureAuthTenantMutationAuthority,
  type AssertAuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import type { AuthTenantOnboardingPluginConfig } from './auth-tenant-onboarding-plugin-config';
import type { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import type { TokenService } from './token-service';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';
import { AuthError, type AuthContext } from './types';

export interface TenantOnboardingActor {
  auth: AuthContext;
  scope: AuthorizationScopeSnapshot & {
    scopeKind: 'tenant';
    tenantId: string;
    membershipId: string;
  };
  access: ReturnType<typeof createRequestAuthorizationAccess>;
  service: AuthTenantOnboardingService;
  assertCurrentAuthority: AssertAuthTenantMutationAuthority;
}

export interface TenantOnboardingIdentityProof {
  userId: string;
  /** Exact generation proven by the admitted session or continuation. */
  authGeneration: number;
  /** Live server-derived assurance from the admitted bearer/continuation. */
  mfaVerifiedAt: number | null;
  consume?: () => boolean;
  auditActor: AuthAuditActor;
}

/** Resolve a live tenant-scoped actor and capture its mutation authority fence. */
export async function requireTenantOnboardingActor(
  config: AuthTenantOnboardingPluginConfig,
  request: Request,
): Promise<TenantOnboardingActor> {
  const store = requireOnboardingStore(config);
  const tokenService = requireOnboardingTokenService(config);
  const service = requireOnboardingService(config);
  const kernel = config.getAuthorizationKernel();
  if (kernel.tenancy.mode !== 'multi') {
    throw new AuthError(
      'Tenant onboarding administration is unavailable',
      'TENANT_ONBOARDING_UNAVAILABLE',
      404,
    );
  }
  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw unauthorized();
  const access = createRequestAuthorizationAccess({
    authContext: auth,
    kernel,
    propertyStore: store,
    roleAssignments: config.getAuthorizationRoleService(),
  });
  const scope = access.requireTenant();
  const assertCurrentAuthority = captureAuthTenantMutationAuthority({
    auth,
    tokenService,
    kernel,
    store,
    roles: config.getAuthorizationRoleService(),
  });
  return { auth, scope, access, service, assertCurrentAuthority };
}

/** Admit exactly one bearer or onboarding-continuation identity proof. */
export async function resolveInvitationIdentityProof(
  config: AuthTenantOnboardingPluginConfig,
  request: Request,
  body: {
    token: string;
    continuation?: string;
  },
): Promise<TenantOnboardingIdentityProof> {
  const tokenService = requireOnboardingTokenService(config);
  if (request.headers.has('authorization')) {
    if (body.continuation) throw ambiguousProof();
    const auth = await extractAuthContext(request, tokenService);
    if (!auth) throw unauthorized();
    return proofFromAuthContext(auth, tokenService);
  }
  if (body.continuation) {
    return resolveOnboardingContinuation(config, body.continuation);
  }
  throw new AuthError(
    'Complete authentication for the invitation email account to continue',
    'TENANT_INVITATION_IDENTITY_PROOF_REQUIRED',
    401,
  );
}

/** Admit exactly one identity proof for a tenant join request. */
export async function resolveJoinRequestIdentityProof(
  config: AuthTenantOnboardingPluginConfig,
  request: Request,
  continuation: string | undefined,
): Promise<TenantOnboardingIdentityProof> {
  if (request.headers.has('authorization')) {
    if (continuation) throw ambiguousProof();
    const tokenService = requireOnboardingTokenService(config);
    const auth = await extractAuthContext(request, tokenService);
    if (!auth) throw unauthorized();
    return proofFromAuthContext(auth, tokenService);
  }
  if (!continuation) {
    throw new AuthError(
      'Authentication or onboarding continuation is required',
      'TENANT_ONBOARDING_PROOF_REQUIRED',
      401,
    );
  }
  return resolveOnboardingContinuation(config, continuation);
}

export function requireOnboardingService(
  config: AuthTenantOnboardingPluginConfig,
): AuthTenantOnboardingService {
  const service = config.getService();
  if (!service) throw notReady();
  return service;
}

export function requireOnboardingStore(
  config: AuthTenantOnboardingPluginConfig,
): UserStore {
  const store = config.getUserStore();
  if (!store) throw notReady();
  return store;
}

export function requireOnboardingTokenService(
  config: AuthTenantOnboardingPluginConfig,
): TokenService {
  const service = config.getTokenService();
  if (!service) throw notReady();
  return service;
}

export function requireOnboardingProperties(
  config: AuthTenantOnboardingPluginConfig,
): UserPropertyService {
  const service = config.getPropertyService();
  if (!service) throw notReady();
  return service;
}

export function requireOnboardingTenantSessions(
  config: AuthTenantOnboardingPluginConfig,
): AuthTenantSessionService {
  const service = config.getTenantSessionService();
  if (!service) throw notReady();
  return service;
}

function proofFromAuthContext(
  auth: AuthContext,
  tokenService: TokenService,
): TenantOnboardingIdentityProof {
  const admission = captureAuthSessionIdentityAdmission(auth, tokenService);
  return {
    userId: auth.userId,
    authGeneration: admission.authGeneration,
    mfaVerifiedAt: auth.mfaVerifiedAt ?? null,
    consume: admission.consume,
    auditActor: authAuditActorFromContext(auth),
  };
}

function resolveOnboardingContinuation(
  config: AuthTenantOnboardingPluginConfig,
  raw: string,
): TenantOnboardingIdentityProof {
  const sessions = requireOnboardingTenantSessions(config);
  const store = requireOnboardingStore(config);
  const record = sessions.continuations.inspect(raw, 'tenant_onboarding');
  if (!record || store.getAuthGeneration(record.userId) !== record.authGeneration) {
    throw new AuthError(
      'Onboarding continuation is invalid',
      'TENANT_ONBOARDING_PROOF_INVALID',
      400,
    );
  }
  const user = store.getUserById(record.userId);
  if (!user || user.status !== 'active' || user.passwordChangeRequired
    || (user.emailVerificationRequired && !user.emailVerifiedAt)) {
    throw new AuthError(
      'Onboarding continuation is invalid',
      'TENANT_ONBOARDING_PROOF_INVALID',
      400,
    );
  }
  return {
    userId: user.userId,
    authGeneration: record.authGeneration,
    mfaVerifiedAt: record.mfaVerifiedAt,
    auditActor: { userId: user.userId, provenance: 'authenticated-request' },
    consume: () => store.getAuthGeneration(user.userId) === record.authGeneration
      && sessions.continuations.consumeInspected(
        record,
        'tenant_onboarding',
        user.userId,
        record.authGeneration,
      ),
  };
}

function ambiguousProof(): AuthError {
  return new AuthError(
    'Provide exactly one identity proof',
    'TENANT_ONBOARDING_PROOF_AMBIGUOUS',
    422,
  );
}

function unauthorized(): AuthError {
  return new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
}

function notReady(): AuthError {
  return new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
}
