/**
 * App-local Auth service lifetime plus safe legacy compatibility getters.
 *
 * Every `createAuthPlugin()` owns one AuthRuntime. Route plugins close over
 * that instance; the no-argument exports at the bottom are compatibility
 * adapters and deliberately reject ambiguous multi-app use.
 */

import type { EmailRuntime } from '../email';
import { getEmailRuntime as getLegacyEmailRuntime } from '../email';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
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
import { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import { resolveAuthTenantOnboardingConfig } from './auth-tenant-onboarding-config';
import { VerifiedDomainOnboardingService } from './verified-domain-service';
import { AuthRequestAdmissionService } from './auth-request-admission-service';
import { resolveAuthRequestAdmissionConfig } from './auth-request-admission-config';
import {
  InstalledAuthProfileGuard,
  reconcileInstalledAuthProfile,
} from './auth-profile-state';
import { createAuthorizationKernel, type AuthorizationKernel } from './authorization-kernel';
import { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleStore } from './authorization-role-store';
import { shouldStartAuthEmailOutbox } from './auth-email-outbox-readiness';
import { defineAuthTables } from './auth-schema';
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
import { TokenService } from './token-service';
import { TenancyService } from './tenancy/tenancy-service';
import { TenantStore } from './tenancy/tenant-store';
import type { AuthPluginConfig, ResolvedAuthBehaviorConfig } from './types';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';

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

  constructor(
    private readonly config: AuthPluginConfig,
    private readonly authConfig: ResolvedAuthBehaviorConfig,
    private readonly dependencies: AuthRuntimeDependencies,
  ) {
    this.authorizationKernel = createAuthorizationKernel({
      tenancy: authConfig.tenancy ?? {
        mode: 'single',
        terminology: { singular: 'organization', plural: 'organizations' },
        creation: { mode: 'disabled' },
      },
      authorization: authConfig.authorization ?? {
        mode: 'simple',
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
  getEmailRuntime(): EmailRuntime { return this.dependencies.getEmailRuntime(); }

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

      this.auditService = new AuthAuditService(this.config.db, this.authConfig.audit);

      this.userStore = new UserStore(this.config.db, {
        tenancyMode: this.authConfig.tenancy?.mode ?? 'single',
        auditService: this.auditService,
      });
      this.requestAdmissionService = new AuthRequestAdmissionService(
        this.config.db,
        this.authConfig.requestAdmission
          ?? resolveAuthRequestAdmissionConfig(),
      );
      let advancedRoles: AuthorizationRoleService | null = null;
      if (this.authConfig.tenancy?.mode === 'multi') {
        this.tenancyService = new TenancyService(new TenantStore(this.config.db, {
          assertCurrentProfile: () => this.installedProfileGuard?.assertCurrent(),
          onOwnerCreated: (input) => advancedRoles?.establishTenantOwner(input),
          onOwnerRoleChanged: (input) => advancedRoles?.syncTenantOwnerRole(input),
        }));
      }
      if (this.authConfig.authorization?.mode === 'advanced') {
        advancedRoles = new AuthorizationRoleService(
          this.config.db,
          new AuthorizationRoleStore(this.config.db),
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
      const profile = reconcileInstalledAuthProfile({
        db: this.config.db,
        requested: requestedProfile,
        legacySimpleRoleAdoption:
          this.authConfig.authorization?.legacySimpleRoleAdoption === true,
        audit: this.auditService,
        beforeCommit: (plan) => {
          // A process may have stopped after committing provisional identity/
          // owner state but before returning a completed registration. Recover
          // only under the same startup transaction as profile validation.
          this.userStore!.recoverPendingRegistrationProvisioning();
          this.userStore!.reconcileBootstrapState();

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
      );
      this.userStore.setRuntimeProfileGuard(() => {
        this.installedProfileGuard!.assertCurrent();
      });
      this.authSessionService = new AuthSessionService(
        new AuthSessionStore(this.config.db),
        this.authConfig.tenancy?.mode ?? 'single',
        this.tenancyService,
        this.auditService,
      );
      this.authSessionService.setRuntimeProfileGuard(() => {
        this.installedProfileGuard!.assertCurrent();
      });
      this.propertyService = new UserPropertyService(this.authConfig);
      this.actionTokenService = new AuthActionTokenService(
        this.userStore,
        this.authConfig.accountEmails.actionTokenTTL,
        this.authConfig.accountEmails.requestCooldown,
        this.dependencies.getPlatformTokenService(),
      );
      this.accountEmailService = new AccountEmailService(
        this.dependencies.getEmailRuntime,
        this.authConfig,
      );
      this.mfaMethodStore = new MfaMethodStore(this.config.db);
      this.mfaService = new MfaService(this.authConfig);
      this.mfaChallengeStore = new MfaChallengeStore(this.config.db);
      this.mfaChallengeService = new MfaChallengeService(
        this.authConfig,
        this.mfaMethodStore,
        this.mfaChallengeStore,
        this.accountEmailService,
        this.auditService,
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
        new AuthSessionContinuationStore(this.config.db),
        this.authConfig,
        this.tenancyService,
        this.userStore,
        this.tokenService,
        this.auditService,
      );
      if (this.authorizationRoleService
        && this.authorizationKernel.tenancy.mode === 'single') {
        this.applicationAdministrationService = new AuthApplicationAdministrationService(
          this.config.db,
          this.authorizationKernel,
          this.userStore,
          this.authorizationRoleService,
          this.auditService,
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
        );
      }

      if (nativeRuntime) {
        const nativeSessions = new NativeSessionStore(
          this.config.db,
          this.authConfig.nativeApps.refreshRotation,
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
          ),
        );
        this.nativeAuthorizationService = new NativeAuthorizationService(
          { native: this.authConfig.nativeApps, ...nativeRuntime },
          new NativeRequestStore(this.config.db, {
            limits: this.authConfig.nativeApps.requestAdmission,
          }),
          new NativeCodeStore(
            this.config.db,
            this.authConfig.nativeApps.requestAdmission.cleanupBatchSize,
          ),
          nativeSessions,
          this.userStore,
          this.tokenService,
          nativeAuthority,
          this.auditService,
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
      emitPlatformCode(OBS_CODES.AUTH_STARTED, {
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
      if (emitStopped) emitPlatformCode(OBS_CODES.AUTH_STOPPED);
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

const authRuntimeProviders = new CompatibilityProviderRegistry<AuthRuntime>('Auth runtime');

/** Register an app runtime for legacy no-argument getter compatibility. */
export function registerAuthRuntimeCompatibility(owner: object, runtime: AuthRuntime) {
  return authRuntimeProviders.register(owner, () => runtime);
}

let manualRuntime: AuthRuntime | null = null;
let manualRegistration: ReturnType<typeof authRuntimeProviders.register> | null = null;
const manualOwner = {};

/** Legacy direct initializer. Prefer `createAuthRuntime()` or `createAuthPlugin()`. */
export async function startAuthRuntime(
  config: AuthPluginConfig,
  authConfig: ResolvedAuthBehaviorConfig,
): Promise<void> {
  if (manualRuntime) await manualRuntime.stop();
  manualRegistration?.unregister();
  manualRuntime = createAuthRuntime(config, authConfig);
  manualRegistration = authRuntimeProviders.register(manualOwner, () => manualRuntime);
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
  const runtime = authRuntimeProviders.get();
  if (!runtime) return;
  await runtime.stop();
  if (runtime === manualRuntime) {
    manualRegistration?.unregister();
    manualRegistration = null;
    manualRuntime = null;
  }
}

/** Runtime values exposed through Elysia derive for legacy callers. */
export function getAuthRuntimeContext() {
  return authRuntimeProviders.get()?.getContext() ?? emptyAuthRuntimeContext();
}

export function getAuthStore(): UserStore | null {
  return authRuntimeProviders.get()?.getStore() ?? null;
}

export function getAuthAuditService(): AuthAuditService | null {
  return authRuntimeProviders.get()?.getAuditService() ?? null;
}

export function getTokenService(): TokenService | null {
  return authRuntimeProviders.get()?.getTokenService() ?? null;
}

export function getAuthSessionService(): AuthSessionService | null {
  return authRuntimeProviders.get()?.getAuthSessionService() ?? null;
}

export function getAuthorizationKernel(): AuthorizationKernel | null {
  return authRuntimeProviders.get()?.getAuthorizationKernel() ?? null;
}

export function getAuthorizationRoleService(): AuthorizationRoleService | null {
  return authRuntimeProviders.get()?.getAuthorizationRoleService() ?? null;
}

export function getPropertyService(): UserPropertyService | null {
  return authRuntimeProviders.get()?.getPropertyService() ?? null;
}

export function getActionTokenService(): AuthActionTokenService | null {
  return authRuntimeProviders.get()?.getActionTokenService() ?? null;
}

export function getAccountEmailService(): AccountEmailService | null {
  return authRuntimeProviders.get()?.getAccountEmailService() ?? null;
}

export function getMfaMethodStore(): MfaMethodStore | null {
  return authRuntimeProviders.get()?.getMfaMethodStore() ?? null;
}

export function getMfaService(): MfaService | null {
  return authRuntimeProviders.get()?.getMfaService() ?? null;
}

export function getMfaChallengeService(): MfaChallengeService | null {
  return authRuntimeProviders.get()?.getMfaChallengeService() ?? null;
}

export function getNativeAuthorizationService(): NativeAuthorizationService | null {
  return authRuntimeProviders.get()?.getNativeAuthorizationService() ?? null;
}

export function getRegistrationIntentStore(): RegistrationIntentStore | null {
  return authRuntimeProviders.get()?.getRegistrationIntentStore() ?? null;
}

export function getAuthEmailOutbox(): AuthEmailOutbox | null {
  return authRuntimeProviders.get()?.getAuthEmailOutbox() ?? null;
}

export function getVerifiedDomainOnboardingService(): VerifiedDomainOnboardingService | null {
  return authRuntimeProviders.get()?.getVerifiedDomainOnboardingService() ?? null;
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

function emptyAuthRuntimeContext() {
  return {
    authStore: null,
    authAuditService: null,
    tokenService: null,
    authSessionService: null,
    authTenantSessionService: null,
    tenantAdministrationService: null,
    tenantOnboardingService: null,
    verifiedDomainOnboardingService: null,
    authorizationKernel: null,
    tenancyService: null,
    mfaMethodStore: null,
    mfaService: null,
    mfaChallengeService: null,
    nativeAuthorizationService: null,
  };
}
