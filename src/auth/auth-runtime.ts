/**
 * auth-runtime.ts
 *
 * Owns auth service lifetime for the composed auth plugin. Route plugins use
 * the getters here; they do not create or reset shared auth services directly.
 */

import { AuthActionTokenService } from './action-token-service';
import { AccountEmailService } from './account-email-service';
import { defineAuthTables } from './auth-schema';
import { MfaChallengeService } from './mfa-challenge-service';
import { MfaChallengeStore } from './mfa-challenge-store';
import { MfaMethodStore } from './mfa-method-store';
import { MfaService } from './mfa-service';
import { TokenService } from './token-service';
import type { AuthPluginConfig, ResolvedAuthBehaviorConfig } from './types';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';
import { getEmailRuntime } from '../email';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { getPlatformTokenService } from '../tokens';
import { NativeAuthorizationService } from './oidc/native-authorization-service';
import { NativeCodeStore } from './oidc/native-code-store';
import { NativeRequestStore } from './oidc/native-request-store';
import { resolveNativeRuntimeConfig } from './oidc/native-runtime-config';
import { NativeSessionStore } from './oidc/native-session-store';
import { RegistrationIntentStore } from './registration-intent-store';
import { AuthEmailOutbox } from './auth-email-outbox';
import { parseTokenTTL } from '../tokens/token-utils';
import { shouldStartAuthEmailOutbox } from './auth-email-outbox-readiness';
import { createNativeAccessSessionValidator } from './oidc/native-access-session';

let userStore: UserStore | null = null;
let tokenService: TokenService | null = null;
let propertyService: UserPropertyService | null = null;
let actionTokenService: AuthActionTokenService | null = null;
let accountEmailService: AccountEmailService | null = null;
let mfaMethodStore: MfaMethodStore | null = null;
let mfaService: MfaService | null = null;
let mfaChallengeStore: MfaChallengeStore | null = null;
let mfaChallengeService: MfaChallengeService | null = null;
let nativeAuthorizationService: NativeAuthorizationService | null = null;
let registrationIntentStore: RegistrationIntentStore | null = null;
let authEmailOutbox: AuthEmailOutbox | null = null;
let authRuntimeStop: Promise<void> | null = null;

/**
 * Initialize auth schema and long-lived auth services.
 *
 * Called exactly once by the root auth plugin lifecycle.
 */
export async function startAuthRuntime(
  config: AuthPluginConfig,
  authConfig: ResolvedAuthBehaviorConfig
): Promise<void> {
  config.db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(config.db);

  userStore = new UserStore(config.db);
  propertyService = new UserPropertyService(authConfig);
  actionTokenService = new AuthActionTokenService(
    userStore,
    authConfig.accountEmails.actionTokenTTL,
    authConfig.accountEmails.requestCooldown,
    getPlatformTokenService()
  );
  accountEmailService = new AccountEmailService(getEmailRuntime, authConfig);
  mfaMethodStore = new MfaMethodStore(config.db);
  mfaService = new MfaService(authConfig);
  mfaChallengeStore = new MfaChallengeStore(config.db);
  mfaChallengeService = new MfaChallengeService(
    authConfig,
    mfaMethodStore,
    mfaChallengeStore,
    accountEmailService
  );
  registrationIntentStore = new RegistrationIntentStore(config.db);

  const nativeRuntime = resolveNativeRuntimeConfig(config, authConfig);

  tokenService = await TokenService.create({
    db: config.db,
    accessTokenTTL: config.accessTokenTTL,
    refreshTokenTTL: config.refreshTokenTTL,
    nativeIssuer: nativeRuntime?.issuer,
    nativeAudience: nativeRuntime?.audience,
  });
  tokenService.setUserStore(userStore);

  if (nativeRuntime) {
    const nativeSessions = new NativeSessionStore(
      config.db, authConfig.nativeApps.refreshRotation,
    );
    tokenService.setNativeSessionValidator(
      createNativeAccessSessionValidator(authConfig.nativeApps, nativeSessions),
    );
    nativeAuthorizationService = new NativeAuthorizationService(
      { native: authConfig.nativeApps, ...nativeRuntime },
      new NativeRequestStore(config.db, {
        limits: authConfig.nativeApps.requestAdmission,
      }),
      new NativeCodeStore(
        config.db, authConfig.nativeApps.requestAdmission.cleanupBatchSize,
      ),
      nativeSessions,
      userStore,
      tokenService
    );
  }

  authEmailOutbox = new AuthEmailOutbox(config.db, {
    store: userStore,
    tokens: actionTokenService,
    email: accountEmailService,
    registrationIntents: registrationIntentStore,
    config: authConfig,
    getNative: () => nativeAuthorizationService,
  }, {
    requestWindowMs: parseTokenTTL(
      authConfig.accountEmails.requestCooldown, 'auth email request cooldown'
    ),
  });
  if (shouldStartAuthEmailOutbox(authConfig, accountEmailService)) {
    authEmailOutbox.start();
  }

  emitPlatformCode(OBS_CODES.AUTH_STARTED, {
    metadata: { tablesDefined: true, keypairInitialized: true },
  });
}

/** Reset auth service singletons when the root auth plugin stops. */
export async function stopAuthRuntime(): Promise<void> {
  if (authRuntimeStop) return authRuntimeStop;
  if (!hasAuthRuntimeState()) return;
  const stopping = stopAuthRuntimeServices();
  authRuntimeStop = stopping;
  try {
    await stopping;
  } finally {
    if (authRuntimeStop === stopping) authRuntimeStop = null;
  }
}

async function stopAuthRuntimeServices(): Promise<void> {
  await authEmailOutbox?.stop();
  userStore = null;
  tokenService = null;
  propertyService = null;
  actionTokenService = null;
  accountEmailService = null;
  mfaMethodStore = null;
  mfaService = null;
  mfaChallengeStore = null;
  mfaChallengeService = null;
  nativeAuthorizationService = null;
  registrationIntentStore = null;
  authEmailOutbox = null;
  emitPlatformCode(OBS_CODES.AUTH_STOPPED);
}

function hasAuthRuntimeState(): boolean {
  return Boolean(userStore || tokenService || propertyService || actionTokenService
    || accountEmailService || mfaMethodStore || mfaService || mfaChallengeStore
    || mfaChallengeService || nativeAuthorizationService || registrationIntentStore
    || authEmailOutbox);
}

/** Runtime values exposed through Elysia derive for advanced server code. */
export function getAuthRuntimeContext() {
  return {
    authStore: userStore,
    tokenService,
    mfaMethodStore,
    mfaService,
    mfaChallengeService,
    nativeAuthorizationService,
  };
}

/** Get the UserStore instance after auth startup. */
export function getAuthStore(): UserStore | null {
  return userStore;
}

/** Get the TokenService instance after auth startup. */
export function getTokenService(): TokenService | null {
  return tokenService;
}

/** Get the user property policy service after auth startup. */
export function getPropertyService(): UserPropertyService | null {
  return propertyService;
}

/** Get the auth action token service after auth startup. */
export function getActionTokenService(): AuthActionTokenService | null {
  return actionTokenService;
}

/** Get the account email service after auth startup. */
export function getAccountEmailService(): AccountEmailService | null {
  return accountEmailService;
}

/** Get the MFA method store after auth startup. */
export function getMfaMethodStore(): MfaMethodStore | null {
  return mfaMethodStore;
}

/** Get the MFA policy/readiness service after auth startup. */
export function getMfaService(): MfaService | null {
  return mfaService;
}

/** Get the MFA challenge service after auth startup. */
export function getMfaChallengeService(): MfaChallengeService | null {
  return mfaChallengeService;
}

/** Get native OpenID Connect orchestration after auth startup. */
export function getNativeAuthorizationService(): NativeAuthorizationService | null {
  return nativeAuthorizationService;
}

/** Get durable registration choices after auth startup. */
export function getRegistrationIntentStore(): RegistrationIntentStore | null {
  return registrationIntentStore;
}

/** Get the durable auth email outbox after auth startup. */
export function getAuthEmailOutbox(): AuthEmailOutbox | null {
  return authEmailOutbox;
}
