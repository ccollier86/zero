/**
 * App-local Auth service lifetime and service composition.
 *
 * Every `createAuthPlugin()` owns one AuthRuntime. Route plugins close over
 * that instance. Legacy no-argument adapters live in
 * `auth-runtime-compatibility.ts`.
 */

import type { EmailRuntime } from '../email';
import { getEmailRuntime as getLegacyEmailRuntime } from '../email';
import { OBS_CODES } from '../observability/codes';
import {
  ZERO_AUTH_AUDIT_SERVICE,
  ZERO_AUTH_STORE,
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_SESSION_SERVICE,
  ZERO_AUTH_TENANCY_SERVICE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_EMAIL_RUNTIME,
  ZERO_PLATFORM_TOKEN_SERVICE,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import {
  getPlatformTokenService as getLegacyPlatformTokenService,
  type PlatformTokenService,
} from '../tokens';
import { parseTokenTTL } from '../tokens/token-utils';
import { AccountEmailService } from './account-email-service';
import { AuthActionTokenService } from './action-token-service';
import { AuthAuditService } from './auth-audit-service';
import { installAuthAuthorityRevision } from './auth-authority-revision';
import { AuthEmailOutbox } from './auth-email-outbox';
import { AuthSessionService } from './auth-session-service';
import { AuthSessionStore } from './auth-session-store';
import { AuthSessionContinuationStore } from './auth-session-continuation-store';
import { AuthTenantSessionService } from './auth-tenant-session-service';
import { AuthApplicationAdministrationService } from './auth-application-administration-service';
import { AuthTenantAdministrationService } from './auth-tenant-administration-service';
import { AuthPlatformTenantAdministrationService } from './auth-platform-tenant-administration-service';
import { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import { resolveAuthTenantOnboardingConfig } from './auth-tenant-onboarding-config';
import { VerifiedDomainOnboardingService } from './verified-domain-service';
import { AuthRequestAdmissionService } from './auth-request-admission-service';
import { resolveAuthRequestAdmissionConfig } from './auth-request-admission-config';
import {
  InstalledAuthProfileGuard,
  reconcileInstalledAuthProfile,
} from './auth-profile-state';
import {
  reconcileAuthorizationManifest,
  type AuthorizationManifestTransition,
} from './auth-authorization-manifest';
import { createAuthorizationKernel, type AuthorizationKernel } from './authorization-kernel';
import { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleStore } from './authorization-role-store';
import { shouldStartAuthEmailOutbox } from './auth-email-outbox-readiness';
import { defineAuthTables } from './auth-schema';
import { MfaChallengeService } from './mfa-challenge-service';
import { createAdministrationMemberResolver } from './auth-administration-membership';
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
import { TokenService } from './token-service';
import { TenancyService } from './tenancy/tenancy-service';
import { TenantStore } from './tenancy/tenant-store';
import { reconcileAdministrationTenant } from './tenancy/administration-tenant-reconciliation';
import {
  AuthError,
  type AuthPluginConfig,
  type ResolvedAuthBehaviorConfig,
} from './types';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';
import {
  createAuthPlatformCodeEmitter,
  type AuthPlatformCodeEmitter,
} from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import {
  getAuthCompatibilityRuntime,
  registerAuthRuntimeCompatibility,
} from './auth-runtime-compatibility';

export {
  getAccountEmailService,
  getActionTokenService,
  getAuthAuditService,
  getAuthEmailOutbox,
  getAuthRuntimeContext,
  getAuthSessionService,
  getAuthStore,
  getAuthorizationKernel,
  getAuthorizationRoleService,
  getMfaChallengeService,
  getMfaMethodStore,
  getMfaService,
  getNativeAuthorizationService,
  getPropertyService,
  getRegistrationIntentStore,
  getTokenService,
  getVerifiedDomainOnboardingService,
  registerAuthRuntimeCompatibility,
} from './auth-runtime-compatibility';

export interface AuthRuntimeDependencies {
  /** Optional managed app-local service/lifecycle container. */
  runtime?: ZeroAppRuntime;
  /** App-local email boundary. The returned object must belong to this app. */
  getEmailRuntime: () => EmailRuntime;
  /** App-local platform action-token service, when that capability is mounted. */
  getPlatformTokenService: () => PlatformTokenService | null;
}

type AuthRuntimeState = 'idle' | 'starting' | 'started' | 'stopping' | 'stopped';

/** Long-lived Auth services owned by exactly one composed auth plugin. */
export class AuthRuntime {
  private state: AuthRuntimeState = 'idle';
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;

  private userStore: UserStore | null = null;
  private auditService: AuthAuditService | null = null;
  private requestAdmissionService: AuthRequestAdmissionService | null = null;
  private tokenService: TokenService | null = null;
  private authSessionService: AuthSessionService | null = null;
  private authTenantSessionService: AuthTenantSessionService | null = null;
  private applicationAdministrationService: AuthApplicationAdministrationService | null = null;
  private tenantAdministrationService: AuthTenantAdministrationService | null = null;
  private platformTenantAdministrationService:
    AuthPlatformTenantAdministrationService | null = null;
  private tenantOnboardingService: AuthTenantOnboardingService | null = null;
  private verifiedDomainOnboardingService: VerifiedDomainOnboardingService | null = null;
  private tenancyService: TenancyService | null = null;
  private propertyService: UserPropertyService | null = null;
  private actionTokenService: AuthActionTokenService | null = null;
  private accountEmailService: AccountEmailService | null = null;
  private mfaMethodStore: MfaMethodStore | null = null;
  private mfaService: MfaService | null = null;
  private mfaChallengeStore: MfaChallengeStore | null = null;
  private mfaChallengeService: MfaChallengeService | null = null;
  private nativeAuthorizationService: NativeAuthorizationService | null = null;
  private registrationIntentStore: RegistrationIntentStore | null = null;
  private authEmailOutbox: AuthEmailOutbox | null = null;
  private readonly authorizationKernel: AuthorizationKernel;
  private authorizationRoleService: AuthorizationRoleService | null = null;
  private installedProfileGuard: InstalledAuthProfileGuard | null = null;
  private readonly emitCode: AuthPlatformCodeEmitter;

  constructor(
    private readonly config: AuthPluginConfig,
    private readonly authConfig: ResolvedAuthBehaviorConfig,
    private readonly dependencies: AuthRuntimeDependencies,
  ) {
    this.emitCode = createAuthPlatformCodeEmitter(dependencies.runtime);
    this.authorizationKernel = createAuthorizationKernel({
      tenancy: authConfig.tenancy ?? {
        mode: 'single',
        terminology: { singular: 'organization', plural: 'organizations' },
        creation: { mode: 'disabled' },
      },
      authorization: authConfig.authorization ?? {
        mode: 'simple',
        registryVersion: 1,
        permissions: {},
        roles: {},
      },
      userProperties: authConfig.userProperties,
    });

    // The kernel is pure and immutable, so expose it during composition. This
    // lets the server-extension compiler validate configured declarations
    // before Elysia begins accepting requests.
    this.dependencies.runtime?.set(ZERO_AUTHORIZATION_KERNEL, this.authorizationKernel);
  }

  /** Initialize schema and services once for this app only. */
  start(): Promise<void> {
    if (this.state === 'started') return Promise.resolve();
    if (this.state === 'starting') return this.startPromise!;
    if (this.state === 'stopping' || this.state === 'stopped') {
      return Promise.reject(new Error('[auth] Cannot start an AuthRuntime after it has stopped.'));
    }

    this.state = 'starting';
    const starting = this.startServices();
    this.startPromise = starting;
    void starting.then(
      () => {
        if (this.state === 'starting') this.state = 'started';
      },
      () => {
        if (this.state === 'starting') this.state = 'idle';
      },
    ).finally(() => {
      if (this.startPromise === starting) this.startPromise = null;
    });
    return starting;
  }

  /** Stop this app's async owners and clear only this app's services. */
  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    if (this.state === 'idle' && !this.hasState()) {
      this.dependencies.runtime?.clear(ZERO_AUTHORIZATION_KERNEL, this.authorizationKernel);
      this.state = 'stopped';
      return;
    }
    if (this.state === 'stopping') return this.stopPromise!;
    if (this.state === 'starting') {
      try {
        await this.startPromise;
      } catch {
        // Partially initialized state is cleared below.
      }
    }
    if (this.stopPromise) return this.stopPromise;
    if (!this.hasState()) {
      this.state = 'stopped';
      return;
    }

    this.state = 'stopping';
    const stopping = this.stopServices();
    this.stopPromise = stopping;
    try {
      await stopping;
    } finally {
      this.state = 'stopped';
      if (this.stopPromise === stopping) this.stopPromise = null;
    }
  }

  getStore(): UserStore | null { return this.withCurrentProfile(this.userStore); }
  getAuditService(): AuthAuditService | null {
    return this.withCurrentProfile(this.auditService);
  }
  getRequestAdmissionService(): AuthRequestAdmissionService | null {
    return this.withCurrentProfile(this.requestAdmissionService);
  }
  getTokenService(): TokenService | null {
    return this.withCurrentProfile(this.tokenService);
  }
  getAuthSessionService(): AuthSessionService | null {
    return this.withCurrentProfile(this.authSessionService);
  }
  getAuthTenantSessionService(): AuthTenantSessionService | null {
    return this.withCurrentProfile(this.authTenantSessionService);
  }
  getApplicationAdministrationService(): AuthApplicationAdministrationService | null {
    return this.withCurrentProfile(this.applicationAdministrationService);
  }
  getTenantAdministrationService(): AuthTenantAdministrationService | null {
    return this.withCurrentProfile(this.tenantAdministrationService);
  }
  getPlatformTenantAdministrationService(): AuthPlatformTenantAdministrationService | null {
    return this.withCurrentProfile(this.platformTenantAdministrationService);
  }
  getTenantOnboardingService(): AuthTenantOnboardingService | null {
    return this.withCurrentProfile(this.tenantOnboardingService);
  }
  getVerifiedDomainOnboardingService(): VerifiedDomainOnboardingService | null {
    return this.withCurrentProfile(this.verifiedDomainOnboardingService);
  }
  getAuthorizationKernel(): AuthorizationKernel {
    return this.withCurrentProfile(this.authorizationKernel)!;
  }
  getAuthorizationRoleService(): AuthorizationRoleService | null {
    return this.withCurrentProfile(this.authorizationRoleService);
  }
  assertCurrentProfile(): void {
    if (!this.installedProfileGuard) {
      throw new Error('[auth] Installed auth profile is not initialized.');
    }
    this.installedProfileGuard.assertCurrent();
  }
  getTenancyService(): TenancyService | null {
    return this.withCurrentProfile(this.tenancyService);
  }
  getPropertyService(): UserPropertyService | null {
    return this.withCurrentProfile(this.propertyService);
  }
  getActionTokenService(): AuthActionTokenService | null {
    return this.withCurrentProfile(this.actionTokenService);
  }
  getAccountEmailService(): AccountEmailService | null {
    return this.withCurrentProfile(this.accountEmailService);
  }
  getMfaMethodStore(): MfaMethodStore | null {
    return this.withCurrentProfile(this.mfaMethodStore);
  }
  getMfaService(): MfaService | null {
    return this.withCurrentProfile(this.mfaService);
  }
  getMfaChallengeService(): MfaChallengeService | null {
    return this.withCurrentProfile(this.mfaChallengeService);
  }
  getNativeAuthorizationService(): NativeAuthorizationService | null {
    return this.withCurrentProfile(this.nativeAuthorizationService);
  }
  getRegistrationIntentStore(): RegistrationIntentStore | null {
    return this.withCurrentProfile(this.registrationIntentStore);
  }
  getAuthEmailOutbox(): AuthEmailOutbox | null {
    return this.withCurrentProfile(this.authEmailOutbox);
  }
  getEmailRuntime(): EmailRuntime { return this.resolveEmailRuntime(); }

  /** Values exposed through Elysia derive for advanced server code. */
  getContext() {
    this.installedProfileGuard?.assertCurrent();
    return {
      authStore: this.userStore,
      authAuditService: this.auditService,
      tokenService: this.tokenService,
      authSessionService: this.authSessionService,
      authTenantSessionService: this.authTenantSessionService,
      applicationAdministrationService: this.applicationAdministrationService,
      tenantAdministrationService: this.tenantAdministrationService,
      platformTenantAdministrationService: this.platformTenantAdministrationService,
      tenantOnboardingService: this.tenantOnboardingService,
      verifiedDomainOnboardingService: this.verifiedDomainOnboardingService,
      authorizationKernel: this.authorizationKernel,
      authorizationRoleService: this.authorizationRoleService,
      tenancyService: this.tenancyService,
      mfaMethodStore: this.mfaMethodStore,
      mfaService: this.mfaService,
      mfaChallengeService: this.mfaChallengeService,
      nativeAuthorizationService: this.nativeAuthorizationService,
    };
  }

  private async startServices(): Promise<void> {
    try {
      this.config.db.exec('PRAGMA foreign_keys = ON');
      defineAuthTables(this.config.db);

      this.auditService = new AuthAuditService(
        this.config.db,
        this.authConfig.audit,
        this.emitCode,
      );

      this.userStore = new UserStore(this.config.db, {
        tenancyMode: this.authConfig.tenancy?.mode ?? 'single',
        auditService: this.auditService,
        emitCode: this.emitCode,
      });
      this.requestAdmissionService = new AuthRequestAdmissionService(
        this.config.db,
        this.authConfig.requestAdmission
          ?? resolveAuthRequestAdmissionConfig(),
        Date.now,
        this.emitCode,
      );
      let advancedRoles: AuthorizationRoleService | null = null;
      if (this.authConfig.tenancy?.mode === 'multi') {
        this.tenancyService = new TenancyService(new TenantStore(this.config.db, {
          assertCurrentProfile: () => this.installedProfileGuard?.assertCurrent(),
          onOwnerCreated: (input) => advancedRoles?.establishTenantOwner(input),
          onOwnerRoleChanged: (input) => advancedRoles?.syncTenantOwnerRole(input),
          emitCode: this.emitCode,
        }));
      }
      if (this.authConfig.authorization?.mode === 'advanced') {
        advancedRoles = new AuthorizationRoleService(
          this.config.db,
          new AuthorizationRoleStore(
            this.config.db,
            Date.now,
            undefined,
            this.emitCode,
          ),
          this.authorizationKernel,
          this.userStore,
          this.tenancyService,
          this.auditService,
        );
        this.authorizationRoleService = advancedRoles;
        this.userStore.setAuthorizationBootstrapper(advancedRoles);
      }

      // Install the shared clock before profile adoption so role projection,
      // membership invalidation, and the profile marker are all observable to
      // other runtimes in the same commit.
      installAuthAuthorityRevision(this.config.db);

      const requestedProfile = {
        tenancy: this.authorizationKernel.tenancy.mode,
        authorization: this.authorizationKernel.authorization.mode,
      } as const;
      let adoptedAdministrationTenantId: string | null = null;
      let authorizationManifest: AuthorizationManifestTransition | null = null;
      const profile = reconcileInstalledAuthProfile({
        db: this.config.db,
        requested: requestedProfile,
        legacySimpleRoleAdoption:
          this.authConfig.authorization?.legacySimpleRoleAdoption === true,
        audit: this.auditService,
        emitCode: this.emitCode,
        beforeCommit: (plan) => {
          try {
            authorizationManifest = reconcileAuthorizationManifest({
              db: this.config.db,
              authorization: this.authorizationKernel.authorization,
              tenancy: this.authorizationKernel.tenancy.mode,
              audit: this.auditService ?? undefined,
              allowProfileAxisChange: plan.kind !== 'unchanged'
                && plan.kind !== 'initialized',
            });
          } catch (error) {
            if (error instanceof AuthError) {
              this.emitCode(OBS_CODES.AUTH_AUTHORIZATION_REGISTRY_REJECTED, {
                metadata: { reasonCode: error.code },
                error,
              });
            }
            throw error;
          }
          // A process may have stopped after committing provisional identity/
          // owner state but before returning a completed registration. Recover
          // only under the same startup transaction as profile validation.
          this.userStore!.recoverPendingRegistrationProvisioning();
          this.userStore!.recoverPendingAdminUserProvisioning();
          this.userStore!.reconcileBootstrapState();

          if (this.tenancyService) {
            const hadAdministrationTenant = Boolean(
              this.tenancyService.getAdministrationTenant(),
            );
            const administrationTenant = reconcileAdministrationTenant({
              tenancy: this.tenancyService,
              adoptTenantId:
                this.authConfig.tenancy?.administration?.adoptTenantId,
              audit: this.auditService ?? undefined,
              emitCode: this.emitCode,
            });
            if (!hadAdministrationTenant && administrationTenant) {
              adoptedAdministrationTenantId = administrationTenant.tenantId;
            }
          }

          const evidence = plan.kind === 'simple-to-advanced'
            && plan.requested.tenancy === 'multi'
            ? advancedRoles!.adoptSimpleTenantMembershipRoles()
            : undefined;

          if (advancedRoles) {
            advancedRoles.reconcileProtectedTenantOwners();
            if (plan.requested.tenancy === 'single') {
              // Global users.role is intentionally not projected into
              // application RBAC. Only the explicit protected-owner ceremony
              // bridges an installed single/simple app into single/advanced.
              const ownerAdoption = this.authConfig.authorization?.ownerAdoption;
              if (ownerAdoption && !advancedRoles.hasRetainedApplicationOwner()) {
                advancedRoles.adoptApplicationOwner(ownerAdoption);
              }
              if (this.userStore!.countUsers() > 0
                && !advancedRoles.hasActiveApplicationOwner()
                && !advancedRoles.hasPendingApplicationOwnerVerification()) {
                throw new Error(
                  '[auth] single/advanced authorization has existing users but no active '
                  + 'application owner capable of authenticating. Configure '
                  + 'auth.authorization.ownerAdoption with '
                  + 'one exact existing userId or email, start once to adopt it atomically, '
                  + 'then keep or remove the idempotent setting.',
                );
              }
            }
          }
          this.tenancyService?.assertUsableOwnerInvariants();
          return evidence;
        },
      });
      this.installedProfileGuard = new InstalledAuthProfileGuard(
        this.config.db,
        profile.committed,
        authorizationManifest!.committed,
      );
      if (authorizationManifest!.kind !== 'unchanged') {
        this.emitCode(
          authorizationManifest!.kind === 'initialized'
            ? OBS_CODES.AUTH_AUTHORIZATION_REGISTRY_INITIALIZED
            : OBS_CODES.AUTH_AUTHORIZATION_REGISTRY_UPDATED,
          {
            metadata: {
              registryVersion: authorizationManifest!.committed.registryVersion,
              fingerprint: authorizationManifest!.committed.fingerprint,
            },
          },
        );
      }
      if (adoptedAdministrationTenantId) {
        this.emitCode(OBS_CODES.AUTH_ADMINISTRATION_TENANT_ADOPTED, {
          metadata: { tenantId: adoptedAdministrationTenantId },
        });
      }
      this.userStore.setRuntimeProfileGuard(() => {
        this.installedProfileGuard!.assertCurrent();
      });
      this.authSessionService = new AuthSessionService(
        new AuthSessionStore(this.config.db),
        this.authConfig.tenancy?.mode ?? 'single',
        this.tenancyService,
        this.auditService,
        this.emitCode,
      );
      this.authSessionService.setRuntimeProfileGuard(() => {
        this.installedProfileGuard!.assertCurrent();
      });
      this.propertyService = new UserPropertyService(this.authConfig);
      this.actionTokenService = new AuthActionTokenService(
        this.userStore,
        this.authConfig.accountEmails.actionTokenTTL,
        this.authConfig.accountEmails.requestCooldown,
        this.resolvePlatformTokenService(),
        this.emitCode,
      );
      this.accountEmailService = new AccountEmailService(
        () => this.resolveEmailRuntime(),
        this.authConfig,
      );
      this.mfaMethodStore = new MfaMethodStore(this.config.db);
      this.mfaService = new MfaService(this.authConfig);
      this.mfaChallengeStore = new MfaChallengeStore(this.config.db);
      const isAdministrationMember = createAdministrationMemberResolver(
        this.tenancyService,
      );
      this.mfaChallengeService = new MfaChallengeService(
        this.authConfig,
        this.mfaMethodStore,
        this.mfaChallengeStore,
        this.accountEmailService,
        this.auditService,
        isAdministrationMember,
        this.emitCode,
        (userId) => this.userStore!.getAuthGeneration(userId),
      );
      const requiresMfaAssurance = (userId: string): boolean => {
        const current = this.userStore!.getUserById(userId);
        return !current || this.mfaChallengeService!.isMfaRequiredForUser(current);
      };
      this.authSessionService.setMfaAssuranceValidator(
        (session) => !requiresMfaAssurance(session.userId)
          || session.mfaVerifiedAt !== null,
        {
          rejectLegacyWithoutAssurance: this.authConfig.mfa.enabled
            && this.authConfig.mfa.policy !== 'optional',
        },
      );
      this.registrationIntentStore = new RegistrationIntentStore(this.config.db);

      const nativeRuntime = resolveNativeRuntimeConfig(this.config, this.authConfig);
      this.tokenService = await TokenService.create({
        db: this.config.db,
        accessTokenTTL: this.config.accessTokenTTL,
        refreshTokenTTL: this.config.refreshTokenTTL,
        nativeIssuer: nativeRuntime?.issuer,
        nativeAudience: nativeRuntime?.audience,
        authSessionService: this.authSessionService,
        emitCode: this.emitCode,
      });
      // Another process may have completed a different pristine correction
      // while key material was importing. Do not finish a stale startup.
      this.installedProfileGuard.assertCurrent();
      this.tokenService.setUserStore(this.userStore);
      this.tokenService.setRuntimeProfileGuard(() => {
        this.installedProfileGuard!.assertCurrent();
      });
      if (this.authorizationRoleService) {
        const roleService = this.authorizationRoleService;
        this.tokenService.setAuthorizationRevisionResolver((context) => {
          if (this.authorizationKernel.tenancy.mode === 'single') {
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
      this.authTenantSessionService = new AuthTenantSessionService(
        new AuthSessionContinuationStore(this.config.db, {
          emitCode: this.emitCode,
        }),
        this.authConfig,
        this.tenancyService,
        this.userStore,
        this.tokenService,
        this.auditService,
        this.authorizationKernel,
        this.authorizationRoleService,
      );
      if (this.authorizationRoleService
        && this.authorizationKernel.tenancy.mode === 'single') {
        this.applicationAdministrationService = new AuthApplicationAdministrationService(
          this.config.db,
          this.authorizationKernel,
          this.userStore,
          this.authorizationRoleService,
          this.auditService,
          this.emitCode,
        );
      }
      if (this.tenancyService) {
        this.tenantAdministrationService = new AuthTenantAdministrationService(
          this.config.db,
          this.authorizationKernel,
          this.userStore,
          this.tenancyService,
          this.authorizationRoleService,
          this.auditService,
          this.emitCode,
        );
        this.platformTenantAdministrationService =
          new AuthPlatformTenantAdministrationService(
            this.config.db,
            this.authorizationKernel,
            this.userStore,
            this.tenancyService,
            this.authorizationRoleService,
            this.auditService,
            this.emitCode,
          );
        this.tenantOnboardingService = new AuthTenantOnboardingService(
          this.config.db,
          this.authConfig.tenancy?.onboarding
            ?? resolveAuthTenantOnboardingConfig(undefined),
          this.authorizationKernel,
          this.userStore,
          this.propertyService,
          this.tenancyService,
          this.authorizationRoleService,
          this.auditService,
          Date.now,
          this.emitCode,
        );
        this.verifiedDomainOnboardingService = new VerifiedDomainOnboardingService(
          this.config.db,
          this.authConfig.tenancy?.onboarding?.verifiedDomains
            ?? resolveAuthTenantOnboardingConfig(undefined).verifiedDomains,
          this.authorizationKernel,
          this.userStore,
          this.tenancyService,
          this.authTenantSessionService.continuations.applicationId,
          Date.now,
          this.auditService,
          this.emitCode,
        );
      }

      if (nativeRuntime) {
        const nativeSessions = new NativeSessionStore(
          this.config.db,
          this.authConfig.nativeApps.refreshRotation,
          this.emitCode,
        );
        const nativeAuthority = new NativeTenantAuthorityService(
          this.authConfig.tenancy?.mode ?? 'single',
          this.tenancyService,
        );
        this.tokenService.setNativeSessionValidator(
          createNativeAccessSessionValidator(
            this.authConfig.nativeApps,
            nativeSessions,
            nativeAuthority,
            requiresMfaAssurance,
          ),
        );
        this.nativeAuthorizationService = new NativeAuthorizationService(
          { native: this.authConfig.nativeApps, ...nativeRuntime },
          new NativeRequestStore(this.config.db, {
            limits: this.authConfig.nativeApps.requestAdmission,
          }, this.emitCode),
          new NativeCodeStore(
            this.config.db,
            this.authConfig.nativeApps.requestAdmission.cleanupBatchSize,
            this.emitCode,
          ),
          nativeSessions,
          this.userStore,
          this.tokenService,
          nativeAuthority,
          this.auditService,
          requiresMfaAssurance,
          this.emitCode,
        );
      }

      this.authEmailOutbox = new AuthEmailOutbox(this.config.db, {
        store: this.userStore,
        tokens: this.actionTokenService,
        email: this.accountEmailService,
        registrationIntents: this.registrationIntentStore,
        config: this.authConfig,
        getNative: () => this.nativeAuthorizationService,
        getTenantOnboarding: () => this.tenantOnboardingService,
        getVerifiedDomainOnboarding: () => this.verifiedDomainOnboardingService,
        emitCode: this.emitCode,
      }, {
        requestWindowMs: parseTokenTTL(
          this.authConfig.accountEmails.requestCooldown,
          'auth email request cooldown',
        ),
      });
      // This is the final publication fence: workers and managed-container
      // services must never be exposed by a runtime whose exact generation
      // changed during asynchronous startup.
      this.installedProfileGuard.assertCurrent();
      if (shouldStartAuthEmailOutbox(this.authConfig, this.accountEmailService)) {
        this.authEmailOutbox.start();
      }
      this.verifiedDomainOnboardingService?.start();
      this.auditService.start();

      this.installRuntimeServices();
      this.emitCode(OBS_CODES.AUTH_STARTED, {
        metadata: { tablesDefined: true, keypairInitialized: true },
      });
    } catch (error) {
      await this.clearServices(false);
      throw error;
    }
  }

  private async stopServices(): Promise<void> {
    await this.clearServices(this.hasState());
  }

  private async clearServices(emitStopped: boolean): Promise<void> {
    const outbox = this.authEmailOutbox;
    const audit = this.auditService;
    const verifiedDomains = this.verifiedDomainOnboardingService;
    const store = this.userStore;
    const tokens = this.tokenService;
    const sessions = this.authSessionService;
    const tenancy = this.tenancyService;
    const authorizationRoles = this.authorizationRoleService;
    let failure: unknown;
    try {
      await outbox?.stop();
    } catch (error) {
      failure = error;
    }
    try {
      await verifiedDomains?.stop();
    } catch (error) {
      failure ??= error;
    } finally {
      audit?.stop();
      if (audit) this.dependencies.runtime?.clear(ZERO_AUTH_AUDIT_SERVICE, audit);
      if (store) this.dependencies.runtime?.clear(ZERO_AUTH_STORE, store);
      if (tokens) this.dependencies.runtime?.clear(ZERO_AUTH_TOKEN_SERVICE, tokens);
      if (sessions) this.dependencies.runtime?.clear(ZERO_AUTH_SESSION_SERVICE, sessions);
      this.dependencies.runtime?.clear(ZERO_AUTHORIZATION_KERNEL, this.authorizationKernel);
      if (authorizationRoles) {
        this.dependencies.runtime?.clear(
          ZERO_AUTHORIZATION_ROLE_SERVICE,
          authorizationRoles,
        );
      }
      if (tenancy) this.dependencies.runtime?.clear(ZERO_AUTH_TENANCY_SERVICE, tenancy);
      this.userStore = null;
      this.auditService = null;
      this.requestAdmissionService = null;
      this.tokenService = null;
      this.authSessionService = null;
      this.authTenantSessionService = null;
      this.applicationAdministrationService = null;
      this.tenantAdministrationService = null;
      this.platformTenantAdministrationService = null;
      this.tenantOnboardingService = null;
      this.verifiedDomainOnboardingService = null;
      this.tenancyService = null;
      this.authorizationRoleService = null;
      this.installedProfileGuard = null;
      this.propertyService = null;
      this.actionTokenService = null;
      this.accountEmailService = null;
      this.mfaMethodStore = null;
      this.mfaService = null;
      this.mfaChallengeStore = null;
      this.mfaChallengeService = null;
      this.nativeAuthorizationService = null;
      this.registrationIntentStore = null;
      this.authEmailOutbox = null;
      if (emitStopped) this.emitCode(OBS_CODES.AUTH_STOPPED);
    }
    if (failure) throw failure;
  }

  private installRuntimeServices(): void {
    if (!this.dependencies.runtime || !this.userStore || !this.tokenService) return;
    try {
      if (this.auditService) {
        this.dependencies.runtime.set(ZERO_AUTH_AUDIT_SERVICE, this.auditService);
      }
      this.dependencies.runtime.set(ZERO_AUTH_STORE, this.userStore);
      this.dependencies.runtime.set(ZERO_AUTH_TOKEN_SERVICE, this.tokenService);
      this.dependencies.runtime.set(ZERO_AUTHORIZATION_KERNEL, this.authorizationKernel);
      if (this.authorizationRoleService) {
        this.dependencies.runtime.set(
          ZERO_AUTHORIZATION_ROLE_SERVICE,
          this.authorizationRoleService,
        );
      }
      if (this.authSessionService) {
        this.dependencies.runtime.set(ZERO_AUTH_SESSION_SERVICE, this.authSessionService);
      }
      if (this.tenancyService) {
        this.dependencies.runtime.set(ZERO_AUTH_TENANCY_SERVICE, this.tenancyService);
      }
    } catch (error) {
      if (this.auditService) {
        this.dependencies.runtime.clear(ZERO_AUTH_AUDIT_SERVICE, this.auditService);
      }
      this.dependencies.runtime.clear(ZERO_AUTH_STORE, this.userStore);
      this.dependencies.runtime.clear(ZERO_AUTH_TOKEN_SERVICE, this.tokenService);
      this.dependencies.runtime.clear(ZERO_AUTHORIZATION_KERNEL, this.authorizationKernel);
      if (this.authorizationRoleService) {
        this.dependencies.runtime.clear(
          ZERO_AUTHORIZATION_ROLE_SERVICE,
          this.authorizationRoleService,
        );
      }
      if (this.authSessionService) {
        this.dependencies.runtime.clear(ZERO_AUTH_SESSION_SERVICE, this.authSessionService);
      }
      if (this.tenancyService) {
        this.dependencies.runtime.clear(ZERO_AUTH_TENANCY_SERVICE, this.tenancyService);
      }
      throw error;
    }
  }

  private hasState(): boolean {
    return Boolean(
      this.userStore || this.auditService || this.requestAdmissionService
      || this.tokenService || this.authSessionService
      || this.authTenantSessionService
      || this.applicationAdministrationService
      || this.tenantAdministrationService
      || this.platformTenantAdministrationService
      || this.tenantOnboardingService
      || this.verifiedDomainOnboardingService
      || this.tenancyService || this.authorizationRoleService || this.propertyService
      || this.actionTokenService || this.accountEmailService || this.mfaMethodStore
      || this.mfaService || this.mfaChallengeStore || this.mfaChallengeService
      || this.nativeAuthorizationService || this.registrationIntentStore
      || this.authEmailOutbox,
    );
  }

  private withCurrentProfile<T>(value: T): T {
    this.installedProfileGuard?.assertCurrent();
    return value;
  }

  private resolveEmailRuntime(): EmailRuntime {
    return invokeSynchronousAuthCallback(this.dependencies.getEmailRuntime, {
      component: 'auth-runtime',
      invariant: 'email-runtime-resolver-async',
      message: '[auth] Email runtime resolver must be synchronous.',
      emitCode: this.emitCode,
    });
  }

  private resolvePlatformTokenService(): PlatformTokenService | null {
    return invokeSynchronousAuthCallback(this.dependencies.getPlatformTokenService, {
      component: 'auth-runtime',
      invariant: 'platform-token-service-resolver-async',
      message: '[auth] Platform token service resolver must be synchronous.',
      emitCode: this.emitCode,
    });
  }
}

/** Build one app-local runtime using explicit dependencies before legacy fallbacks. */
export function createAuthRuntime(
  config: AuthPluginConfig,
  authConfig: ResolvedAuthBehaviorConfig,
): AuthRuntime {
  return new AuthRuntime(config, authConfig, {
    runtime: config.runtime,
    getEmailRuntime: resolveEmailRuntimeGetter(config),
    getPlatformTokenService: resolvePlatformTokenServiceGetter(config),
  });
}

let manualRuntime: AuthRuntime | null = null;
let manualRegistration: ReturnType<typeof registerAuthRuntimeCompatibility> | null = null;
const manualOwner = {};

/** Legacy direct initializer. Prefer `createAuthRuntime()` or `createAuthPlugin()`. */
export async function startAuthRuntime(
  config: AuthPluginConfig,
  authConfig: ResolvedAuthBehaviorConfig,
): Promise<void> {
  if (manualRuntime) await manualRuntime.stop();
  manualRegistration?.unregister();
  manualRuntime = createAuthRuntime(config, authConfig);
  manualRegistration = registerAuthRuntimeCompatibility(manualOwner, manualRuntime);
  try {
    await manualRuntime.start();
  } catch (error) {
    manualRegistration.unregister();
    manualRegistration = null;
    manualRuntime = null;
    throw error;
  }
}

/** Stop the only unambiguous legacy Auth runtime. */
export async function stopAuthRuntime(): Promise<void> {
  const runtime = getAuthCompatibilityRuntime();
  if (!runtime) return;
  await runtime.stop();
  if (runtime === manualRuntime) {
    manualRegistration?.unregister();
    manualRegistration = null;
    manualRuntime = null;
  }
}

function resolveEmailRuntimeGetter(config: AuthPluginConfig): () => EmailRuntime {
  if (config.emailRuntime) return () => config.emailRuntime!;
  if (config.getEmailRuntime) return config.getEmailRuntime;
  if (config.runtime) return () => config.runtime!.require(ZERO_EMAIL_RUNTIME);
  return getLegacyEmailRuntime;
}

function resolvePlatformTokenServiceGetter(
  config: AuthPluginConfig,
): () => PlatformTokenService | null {
  if (Object.hasOwn(config, 'platformTokenService')) {
    return () => config.platformTokenService ?? null;
  }
  if (config.getPlatformTokenService) return config.getPlatformTokenService;
  if (config.runtime) return () => config.runtime!.get(ZERO_PLATFORM_TOKEN_SERVICE);
  return getLegacyPlatformTokenService;
}
