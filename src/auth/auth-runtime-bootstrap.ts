/** Construct the app-local Auth service graph during AuthRuntime startup. */

import type { EmailRuntime } from '../email';
import type { PlatformTokenService } from '../tokens';
import { parseTokenTTL } from '../tokens/token-utils';
import { AccountEmailService } from './account-email-service';
import { AuthApiKeyService } from './auth-api-key-service';
import { AuthApiKeyStore } from './auth-api-key-store';
import { GuardianRequestCredentialResolver } from './auth-request-credential-resolver';
import { AuthActionTokenService } from './action-token-service';
import { createAdministrationMemberResolver } from './auth-administration-membership';
import { AuthApplicationAdministrationService } from './auth-application-administration-service';
import { AuthAuditService } from './auth-audit-service';
import { AuthEmailOutbox } from './auth-email-outbox';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { AuthPlatformTenantAdministrationService } from './auth-platform-tenant-administration-service';
import { AuthRequestAdmissionService } from './auth-request-admission-service';
import { resolveAuthRequestAdmissionConfig } from './auth-request-admission-config';
import {
  emitAuthRuntimeProfileReconciliation,
  reconcileAuthRuntimeProfile,
} from './auth-runtime-profile-reconciliation';
import type { AuthRuntimeServiceGraph } from './auth-runtime-service-graph';
import { defineAuthTables } from './auth-schema';
import { AuthSessionContinuationStore } from './auth-session-continuation-store';
import { AuthSessionService } from './auth-session-service';
import { AuthSessionStore } from './auth-session-store';
import { AuthTenantAdministrationService } from './auth-tenant-administration-service';
import { resolveAuthTenantOnboardingConfig } from './auth-tenant-onboarding-config';
import { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import { AuthTenantSessionService } from './auth-tenant-session-service';
import type { AuthorizationKernel } from './authorization-kernel';
import { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleStore } from './authorization-role-store';
import { MfaChallengeService } from './mfa-challenge-service';
import { MfaChallengeStore } from './mfa-challenge-store';
import { MfaMethodStore } from './mfa-method-store';
import { MfaService } from './mfa-service';
import { createNativeAccessSessionValidator } from './oidc/native-access-session';
import { NativeAuthorizationService } from './oidc/native-authorization-service';
import { NativeCodeStore } from './oidc/native-code-store';
import { NativeRequestStore } from './oidc/native-request-store';
import { resolveNativeRuntimeConfig } from './oidc/native-runtime-config';
import { NativeSessionStore } from './oidc/native-session-store';
import { NativeTenantAuthorityService } from './oidc/native-tenant-authority';
import { RegistrationIntentStore } from './registration-intent-store';
import { TenancyService } from './tenancy/tenancy-service';
import { TenantStore } from './tenancy/tenant-store';
import { TokenService } from './token-service';
import type { AuthPluginConfig, ResolvedAuthBehaviorConfig } from './types';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';
import { VerifiedDomainOnboardingService } from './verified-domain-service';

export interface AuthRuntimeBootstrapInput {
  config: AuthPluginConfig;
  authConfig: ResolvedAuthBehaviorConfig;
  authorizationKernel: AuthorizationKernel;
  services: AuthRuntimeServiceGraph;
  emitCode: AuthPlatformCodeEmitter;
  resolveEmailRuntime: () => EmailRuntime;
  resolvePlatformTokenService: () => PlatformTokenService | null;
}

/**
 * Populate one runtime's service graph in dependency order.
 *
 * Every assignment is intentionally made as soon as a service exists so a
 * startup failure can tear down the exact partially constructed graph.
 */
export async function bootstrapAuthRuntimeServices(
  input: AuthRuntimeBootstrapInput,
): Promise<void> {
  const {
    config,
    authConfig,
    authorizationKernel,
    services,
    emitCode,
  } = input;

  config.db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(config.db);
  await config.identityProjection?.initialize?.();

  services.auditService = new AuthAuditService(
    config.db,
    authConfig.audit,
    emitCode,
  );
  services.userStore = new UserStore(config.db, {
    tenancyMode: authConfig.tenancy?.mode ?? 'single',
    auditService: services.auditService,
    emitCode,
    identityProjection: config.identityProjection,
  });
  services.requestAdmissionService = new AuthRequestAdmissionService(
    config.db,
    authConfig.requestAdmission ?? resolveAuthRequestAdmissionConfig(),
    Date.now,
    emitCode,
  );

  let advancedRoles: AuthorizationRoleService | null = null;
  if (authConfig.tenancy?.mode === 'multi') {
    services.tenancyService = new TenancyService(new TenantStore(config.db, {
      assertCurrentProfile: () => services.installedProfileGuard?.assertCurrent(),
      onOwnerCreated: (owner) => advancedRoles?.establishTenantOwner(owner),
      onOwnerRoleChanged: (owner) => advancedRoles?.syncTenantOwnerRole(owner),
      emitCode,
      identityProjection: config.identityProjection,
    }));
  }
  if (authConfig.authorization?.mode === 'advanced') {
    advancedRoles = new AuthorizationRoleService(
      config.db,
      new AuthorizationRoleStore(config.db, Date.now, undefined, emitCode),
      authorizationKernel,
      services.userStore,
      services.tenancyService,
      services.auditService,
    );
    services.authorizationRoleService = advancedRoles;
    services.userStore.setAuthorizationBootstrapper(advancedRoles);
  }

  const profileReconciliation = reconcileAuthRuntimeProfile({
    db: config.db,
    authConfig,
    authorizationKernel,
    userStore: services.userStore,
    auditService: services.auditService,
    tenancyService: services.tenancyService,
    authorizationRoleService: services.authorizationRoleService,
    emitCode,
  });
  services.installedProfileGuard = profileReconciliation.guard;
  emitAuthRuntimeProfileReconciliation(profileReconciliation, emitCode);
  services.userStore.setRuntimeProfileGuard(() => {
    services.installedProfileGuard!.assertCurrent();
  });

  services.authSessionService = new AuthSessionService(
    new AuthSessionStore(config.db),
    authConfig.tenancy?.mode ?? 'single',
    services.tenancyService,
    services.auditService,
    emitCode,
  );
  services.authSessionService.setRuntimeProfileGuard(() => {
    services.installedProfileGuard!.assertCurrent();
  });
  services.propertyService = new UserPropertyService(authConfig);
  services.actionTokenService = new AuthActionTokenService(
    services.userStore,
    authConfig.accountEmails.actionTokenTTL,
    authConfig.accountEmails.requestCooldown,
    input.resolvePlatformTokenService(),
    emitCode,
  );
  services.accountEmailService = new AccountEmailService(
    input.resolveEmailRuntime,
    authConfig,
  );
  services.mfaMethodStore = new MfaMethodStore(config.db);
  services.mfaService = new MfaService(authConfig);
  services.mfaChallengeStore = new MfaChallengeStore(config.db);
  const isAdministrationMember = createAdministrationMemberResolver(
    services.tenancyService,
  );
  services.mfaChallengeService = new MfaChallengeService(
    authConfig,
    services.mfaMethodStore,
    services.mfaChallengeStore,
    services.accountEmailService,
    services.auditService,
    isAdministrationMember,
    emitCode,
    (userId) => services.userStore!.getAuthGeneration(userId),
  );
  const requiresMfaAssurance = (userId: string): boolean => {
    const current = services.userStore!.getUserById(userId);
    return !current || services.mfaChallengeService!.isMfaRequiredForUser(current);
  };
  services.authSessionService.setMfaAssuranceValidator(
    (session) => !requiresMfaAssurance(session.userId)
      || session.mfaVerifiedAt !== null,
    {
      rejectLegacyWithoutAssurance: authConfig.mfa.enabled
        && authConfig.mfa.policy !== 'optional',
    },
  );
  services.registrationIntentStore = new RegistrationIntentStore(config.db);

  const nativeRuntime = resolveNativeRuntimeConfig(config, authConfig);
  services.tokenService = await TokenService.create({
    db: config.db,
    accessTokenTTL: config.accessTokenTTL,
    refreshTokenTTL: config.refreshTokenTTL,
    nativeIssuer: nativeRuntime?.issuer,
    nativeAudience: nativeRuntime?.audience,
    authSessionService: services.authSessionService,
    emitCode,
  });
  // Another process may have completed a different pristine correction while
  // key material was importing. Do not finish a stale startup.
  services.installedProfileGuard.assertCurrent();
  services.tokenService.setUserStore(services.userStore);
  services.tokenService.setRuntimeProfileGuard(() => {
    services.installedProfileGuard!.assertCurrent();
  });
  if (services.authorizationRoleService) {
    const roleService = services.authorizationRoleService;
    services.tokenService.setAuthorizationRevisionResolver((context) => {
      if (authorizationKernel.tenancy.mode === 'single') {
        return roleService.resolveApplicationRoles(context.userId)?.revision ?? null;
      }
      if (!context.tenantId || !context.membershipId) return null;
      return roleService.resolveTenantRoles({
        tenantId: context.tenantId,
        membershipId: context.membershipId,
        userId: context.userId,
      })?.revision ?? null;
    });
  }

  services.apiKeyStore = new AuthApiKeyStore(config.db);
  services.apiKeyService = new AuthApiKeyService({
    config: authConfig.apiKeys,
    store: services.apiKeyStore,
    users: services.userStore,
    tenancy: services.tenancyService,
    authorization: authorizationKernel,
    roles: services.authorizationRoleService,
    audit: services.auditService,
    emitCode,
    assertCurrentProfile: () => services.installedProfileGuard!.assertCurrent(),
  });
  services.requestCredentialResolver = new GuardianRequestCredentialResolver(
    services.tokenService,
    services.apiKeyService,
  );

  services.authTenantSessionService = new AuthTenantSessionService(
    new AuthSessionContinuationStore(config.db, { emitCode }),
    authConfig,
    services.tenancyService,
    services.userStore,
    services.tokenService,
    services.auditService,
    authorizationKernel,
    services.authorizationRoleService,
  );
  if (services.authorizationRoleService
    && authorizationKernel.tenancy.mode === 'single') {
    services.applicationAdministrationService =
      new AuthApplicationAdministrationService(
        config.db,
        authorizationKernel,
        services.userStore,
        services.authorizationRoleService,
        services.auditService,
        emitCode,
      );
  }
  if (services.tenancyService) {
    services.tenantAdministrationService = new AuthTenantAdministrationService(
      config.db,
      authorizationKernel,
      services.userStore,
      services.tenancyService,
      services.authorizationRoleService,
      services.auditService,
      emitCode,
    );
    services.platformTenantAdministrationService =
      new AuthPlatformTenantAdministrationService(
        config.db,
        authorizationKernel,
        services.userStore,
        services.tenancyService,
        services.authorizationRoleService,
        services.auditService,
        emitCode,
      );
    services.tenantOnboardingService = new AuthTenantOnboardingService(
      config.db,
      authConfig.tenancy?.onboarding
        ?? resolveAuthTenantOnboardingConfig(undefined),
      authorizationKernel,
      services.userStore,
      services.propertyService,
      services.tenancyService,
      services.authorizationRoleService,
      services.auditService,
      Date.now,
      emitCode,
    );
    services.verifiedDomainOnboardingService = new VerifiedDomainOnboardingService(
      config.db,
      authConfig.tenancy?.onboarding?.verifiedDomains
        ?? resolveAuthTenantOnboardingConfig(undefined).verifiedDomains,
      authorizationKernel,
      services.userStore,
      services.tenancyService,
      services.authTenantSessionService.continuations.applicationId,
      Date.now,
      services.auditService,
      emitCode,
    );
  }

  if (nativeRuntime) {
    const nativeSessions = new NativeSessionStore(
      config.db,
      authConfig.nativeApps.refreshRotation,
      emitCode,
    );
    const nativeAuthority = new NativeTenantAuthorityService(
      authConfig.tenancy?.mode ?? 'single',
      services.tenancyService,
    );
    services.tokenService.setNativeSessionValidator(
      createNativeAccessSessionValidator(
        authConfig.nativeApps,
        nativeSessions,
        nativeAuthority,
        requiresMfaAssurance,
      ),
    );
    services.nativeAuthorizationService = new NativeAuthorizationService(
      { native: authConfig.nativeApps, ...nativeRuntime },
      new NativeRequestStore(config.db, {
        limits: authConfig.nativeApps.requestAdmission,
      }, emitCode),
      new NativeCodeStore(
        config.db,
        authConfig.nativeApps.requestAdmission.cleanupBatchSize,
        emitCode,
      ),
      nativeSessions,
      services.userStore,
      services.tokenService,
      nativeAuthority,
      services.auditService,
      requiresMfaAssurance,
      emitCode,
    );
  }

  services.authEmailOutbox = new AuthEmailOutbox(config.db, {
    store: services.userStore,
    tokens: services.actionTokenService,
    email: services.accountEmailService,
    registrationIntents: services.registrationIntentStore,
    config: authConfig,
    getNative: () => services.nativeAuthorizationService,
    getTenantOnboarding: () => services.tenantOnboardingService,
    getVerifiedDomainOnboarding: () => services.verifiedDomainOnboardingService,
    emitCode,
  }, {
    requestWindowMs: parseTokenTTL(
      authConfig.accountEmails.requestCooldown,
      'auth email request cooldown',
    ),
  });
}
