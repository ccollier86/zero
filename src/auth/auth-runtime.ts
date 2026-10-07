/**
 * App-local Auth service lifetime and service composition.
 *
 * Every `createAuthPlugin()` owns one AuthRuntime. Route plugins close over
 * that instance. Legacy no-argument adapters live in
 * `auth-runtime-compatibility.ts`.
 */

import type { EmailRuntime } from '../email';
import { getEmailRuntime as getLegacyEmailRuntime } from '../email';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_EMAIL_RUNTIME,
  ZERO_PLATFORM_TOKEN_SERVICE,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import {
  getPlatformTokenService as getLegacyPlatformTokenService,
  type PlatformTokenService,
} from '../tokens';
import type { AccountEmailService } from './account-email-service';
import type { AuthApiKeyService } from './auth-api-key-service';
import type { GuardianRequestCredentialResolver } from './auth-request-credential-resolver';
import type { AuthActionTokenService } from './action-token-service';
import type { AuthApplicationAdministrationService } from './auth-application-administration-service';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthEmailOutbox } from './auth-email-outbox';
import type { AuthUserContactService } from './auth-user-contact-service';
import type { AuthUserProfileCompletionService } from './auth-user-profile-completion-service';
import type { AuthPlatformTenantAdministrationService } from './auth-platform-tenant-administration-service';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import type { AuthSessionService } from './auth-session-service';
import type { AuthTenantAdministrationService } from './auth-tenant-administration-service';
import type { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import { createAuthorizationKernel, type AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { MfaMethodStore } from './mfa-method-store';
import type { MfaService } from './mfa-service';
import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type { RegistrationIntentStore } from './registration-intent-store';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TokenService } from './token-service';
import type { AuthPluginConfig, ResolvedAuthBehaviorConfig } from './types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';
import type { AuthUserProfileService } from './auth-user-profile-service';
import type { VerifiedDomainOnboardingService } from './verified-domain-service';
import {
  createAuthStateInvariantError,
  createAuthPlatformCodeEmitter,
  type AuthPlatformCodeEmitter,
} from './auth-observability';
import { bootstrapAuthRuntimeServices } from './auth-runtime-bootstrap';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import {
  getAuthCompatibilityRuntime,
  registerAuthRuntimeCompatibility,
} from './auth-runtime-compatibility';
import {
  activateAuthRuntimeServices,
  clearAuthRuntimeKernel,
  clearAuthRuntimeServices,
} from './auth-runtime-lifecycle';
import {
  authRuntimeServiceGraphHasState,
  createAuthRuntimeServiceGraph,
} from './auth-runtime-service-graph';

export {
  getAccountEmailService,
  getActionTokenService,
  getAuthAuditService,
  getAuthApiKeyService,
  getAuthRequestCredentialResolver,
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
  private readonly services = createAuthRuntimeServiceGraph();
  private readonly authorizationKernel: AuthorizationKernel;
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
      clearAuthRuntimeKernel(this.dependencies.runtime, this.authorizationKernel);
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

  getStore(): UserStore | null {
    return this.withCurrentProfile(this.services.userStore);
  }
  getUserProfileService(): AuthUserProfileService | null {
    return this.withCurrentProfile(this.services.userProfileService);
  }
  getUserContactService(): AuthUserContactService | null {
    return this.withCurrentProfile(this.services.userContactService);
  }
  getUserProfileCompletionService(): AuthUserProfileCompletionService | null {
    return this.withCurrentProfile(this.services.userProfileCompletionService);
  }
  getAuditService(): AuthAuditService | null {
    return this.withCurrentProfile(this.services.auditService);
  }
  getRequestAdmissionService(): AuthRequestAdmissionService | null {
    return this.withCurrentProfile(this.services.requestAdmissionService);
  }
  getTokenService(): TokenService | null {
    return this.withCurrentProfile(this.services.tokenService);
  }
  getApiKeyService(): AuthApiKeyService | null {
    return this.withCurrentProfile(this.services.apiKeyService);
  }
  getRequestCredentialResolver(): GuardianRequestCredentialResolver | null {
    return this.withCurrentProfile(this.services.requestCredentialResolver);
  }
  getAuthSessionService(): AuthSessionService | null {
    return this.withCurrentProfile(this.services.authSessionService);
  }
  getAuthTenantSessionService(): AuthTenantSessionService | null {
    return this.withCurrentProfile(this.services.authTenantSessionService);
  }
  getApplicationAdministrationService(): AuthApplicationAdministrationService | null {
    return this.withCurrentProfile(this.services.applicationAdministrationService);
  }
  getTenantAdministrationService(): AuthTenantAdministrationService | null {
    return this.withCurrentProfile(this.services.tenantAdministrationService);
  }
  getPlatformTenantAdministrationService():
    AuthPlatformTenantAdministrationService | null {
    return this.withCurrentProfile(
      this.services.platformTenantAdministrationService,
    );
  }
  getTenantOnboardingService(): AuthTenantOnboardingService | null {
    return this.withCurrentProfile(this.services.tenantOnboardingService);
  }
  getVerifiedDomainOnboardingService(): VerifiedDomainOnboardingService | null {
    return this.withCurrentProfile(this.services.verifiedDomainOnboardingService);
  }
  getAuthorizationKernel(): AuthorizationKernel {
    return this.withCurrentProfile(this.authorizationKernel)!;
  }
  getAuthorizationRoleService(): AuthorizationRoleService | null {
    return this.withCurrentProfile(this.services.authorizationRoleService);
  }
  assertCurrentProfile(): void {
    if (!this.services.installedProfileGuard) {
      throw createAuthStateInvariantError(this.emitCode, {
        component: 'auth-runtime',
        invariant: 'installed-profile-guard-ready',
        message: '[auth] Installed auth profile is not initialized.',
      });
    }
    this.services.installedProfileGuard.assertCurrent();
  }
  getTenancyService(): TenancyService | null {
    return this.withCurrentProfile(this.services.tenancyService);
  }
  getPropertyService(): UserPropertyService | null {
    return this.withCurrentProfile(this.services.propertyService);
  }
  getActionTokenService(): AuthActionTokenService | null {
    return this.withCurrentProfile(this.services.actionTokenService);
  }
  getAccountEmailService(): AccountEmailService | null {
    return this.withCurrentProfile(this.services.accountEmailService);
  }
  getMfaMethodStore(): MfaMethodStore | null {
    return this.withCurrentProfile(this.services.mfaMethodStore);
  }
  getMfaService(): MfaService | null {
    return this.withCurrentProfile(this.services.mfaService);
  }
  getMfaChallengeService(): MfaChallengeService | null {
    return this.withCurrentProfile(this.services.mfaChallengeService);
  }
  getNativeAuthorizationService(): NativeAuthorizationService | null {
    return this.withCurrentProfile(this.services.nativeAuthorizationService);
  }
  getRegistrationIntentStore(): RegistrationIntentStore | null {
    return this.withCurrentProfile(this.services.registrationIntentStore);
  }
  getAuthEmailOutbox(): AuthEmailOutbox | null {
    return this.withCurrentProfile(this.services.authEmailOutbox);
  }
  getEmailRuntime(): EmailRuntime { return this.resolveEmailRuntime(); }

  /** Values exposed through Elysia derive for advanced server code. */
  getContext() {
    this.services.installedProfileGuard?.assertCurrent();
    return {
      authStore: this.services.userStore,
      userProfileService: this.services.userProfileService,
      userContactService: this.services.userContactService,
      userProfileCompletionService: this.services.userProfileCompletionService,
      authAuditService: this.services.auditService,
      tokenService: this.services.tokenService,
      authApiKeyService: this.services.apiKeyService,
      authRequestCredentialResolver: this.services.requestCredentialResolver,
      authSessionService: this.services.authSessionService,
      authTenantSessionService: this.services.authTenantSessionService,
      applicationAdministrationService:
        this.services.applicationAdministrationService,
      tenantAdministrationService: this.services.tenantAdministrationService,
      platformTenantAdministrationService:
        this.services.platformTenantAdministrationService,
      tenantOnboardingService: this.services.tenantOnboardingService,
      verifiedDomainOnboardingService:
        this.services.verifiedDomainOnboardingService,
      authorizationKernel: this.authorizationKernel,
      authorizationRoleService: this.services.authorizationRoleService,
      tenancyService: this.services.tenancyService,
      mfaMethodStore: this.services.mfaMethodStore,
      mfaService: this.services.mfaService,
      mfaChallengeService: this.services.mfaChallengeService,
      nativeAuthorizationService: this.services.nativeAuthorizationService,
    };
  }

  private async startServices(): Promise<void> {
    try {
      await bootstrapAuthRuntimeServices({
        config: this.config,
        authConfig: this.authConfig,
        authorizationKernel: this.authorizationKernel,
        services: this.services,
        emitCode: this.emitCode,
        resolveEmailRuntime: () => this.resolveEmailRuntime(),
        resolvePlatformTokenService: () => this.resolvePlatformTokenService(),
      });
      activateAuthRuntimeServices(this.lifecycleInput());
    } catch (error) {
      await clearAuthRuntimeServices(this.lifecycleInput(), false);
      throw error;
    }
  }

  private async stopServices(): Promise<void> {
    await clearAuthRuntimeServices(this.lifecycleInput(), this.hasState());
  }

  private hasState(): boolean {
    return authRuntimeServiceGraphHasState(this.services);
  }

  private lifecycleInput() {
    return {
      runtime: this.dependencies.runtime,
      authConfig: this.authConfig,
      authorizationKernel: this.authorizationKernel,
      services: this.services,
      emitCode: this.emitCode,
    };
  }

  private withCurrentProfile<T>(value: T): T {
    this.services.installedProfileGuard?.assertCurrent();
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
