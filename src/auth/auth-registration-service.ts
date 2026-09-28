/** Transport-independent orchestration for self-service registration. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { buildAuthCompletionResponse } from './auth-mfa-response';
import { assertBootstrapRequest } from './auth-bootstrap';
import {
  claimRegistrationContinuation,
  requireRegistrationContinuation,
} from './auth-registration-continuation';
import { resolveRegistrationPolicy } from './auth-registration-policy';
import { sendRegistrationVerification } from './auth-registration-verification';
import { rollbackRegistration } from './auth-registration-rollback';
import {
  requireSessionServices,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { toAuthUserResponse } from './auth-user-response';
import {
  type TenantCreationResult,
} from './tenancy/tenancy-types';
import {
  mapTenantCreationError,
  normalizeTenantCreateFields,
  requireUserCanCreateTenant,
  toRegistrationTenant,
} from './auth-tenant-creation';
import { AuthError } from './types';
import type { AuthAuditRequestContext } from './auth-audit-types';

export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  mfaEnrollment?: boolean;
  nativeContinuation?: string;
  bootstrapSecret?: string;
  /** Initial organization name. Required only during multi-tenant bootstrap. */
  organizationName?: string;
  /** Optional stable URL slug; derived from organizationName when omitted. */
  organizationSlug?: string;
}

export async function registerUser(
  config: AuthSessionPluginConfig,
  input: RegistrationInput,
  auditRequest?: AuthAuditRequestContext,
) {
  const services = requireSessionServices(config);
  const authConfig = config.getAuthConfig();
  const nativeAuthorization = config.getNativeAuthorizationService();
  const nativeContinuation = requireRegistrationContinuation(
    nativeAuthorization, input.nativeContinuation
  );
  const multiTenant = authConfig.tenancy?.mode === 'multi';
  const bootstrapRequired = services.store.isBootstrapRequired();
  if (!multiTenant && (input.organizationName !== undefined
    || input.organizationSlug !== undefined)) {
    throw new AuthError(
      'Organization creation is unavailable in single-tenant mode',
      'TENANT_CREATION_UNAVAILABLE',
      422,
    );
  }
  if (multiTenant && bootstrapRequired && !input.organizationName?.trim()) {
    throw new AuthError('Organization name is required', 'TENANT_NAME_REQUIRED', 422);
  }
  const organization = input.organizationName !== undefined
    || input.organizationSlug !== undefined
    ? normalizeTenantCreateFields(input.organizationName, input.organizationSlug)
    : null;
  if (organization && !services.tenancyService) {
    throw new AuthError('Tenant services are not initialized', 'AUTH_NOT_READY', 503);
  }
  // Cheaply reject missing/invalid setup authority before Argon2 work. The
  // policy is evaluated again under UserStore's serialized transaction so
  // this preflight never becomes the authority in a concurrent race.
  assertBootstrapRequest(
    authConfig,
    services.store.isBootstrapRequired(),
    input.bootstrapSecret
  );
  let tenantCreation: TenantCreationResult | null = null;
  const { user, policy, provisioning } = await services.store.createRegistrationUser({
    username: input.username, email: input.email, password: input.password,
    firstName: input.firstName, lastName: input.lastName,
    properties: services.propertyService.getDefaultProperties(),
  }, (isBootstrap) => resolveRegistrationPolicy({
    isBootstrap, accountEmail: services.accountEmail, authConfig,
    mfaEnrollment: input.mfaEnrollment,
    bootstrapSecret: input.bootstrapSecret,
  }), (created, resolvedPolicy) => {
    claimRegistrationContinuation(nativeAuthorization, nativeContinuation, created.userId);
    // Persist the deliberate pre-verification owner state in the same
    // transaction as identity/tenant provisioning. This intent outlives the
    // short compensation receipt and is consumed atomically on verification.
    if (resolvedPolicy.requireEmailVerification) {
      services.registrationIntents.setMfaEnrollment(
        created.userId,
        resolvedPolicy.requestedMfaSetup,
      );
    }
    if (resolvedPolicy.isBootstrap && multiTenant && !organization) {
      throw new AuthError('Organization name is required', 'TENANT_NAME_REQUIRED', 422);
    }
    if (organization && services.tenancyService) {
      try {
        // Installation bootstrap always establishes its protected first owner.
        // Later one-step creation is a separate, explicitly configured policy.
        if (!resolvedPolicy.isBootstrap) requireUserCanCreateTenant(authConfig, created);
        tenantCreation = services.tenancyService.createTenant({
          name: organization.name,
          slug: organization.slug,
          ownerUserId: created.userId,
          createdBy: created.userId,
        });
        if (resolvedPolicy.requireEmailVerification
          && !services.registrationIntents.bindProvisionedTenant(
            created.userId,
            tenantCreation.tenant.tenantId,
          )) {
          throw new Error('[auth] Failed to bind registration intent to its tenant.');
        }
        return { tenantId: tenantCreation.tenant.tenantId };
      } catch (error) {
        throw mapTenantCreationError(error);
      }
    }
    return undefined;
  }, { provisional: true, auditRequest });
  if (!provisioning) {
    throw new Error('[auth] Registration provisioning receipt was not created.');
  }

  let completion: Awaited<ReturnType<typeof buildAuthCompletionResponse>> | null = null;
  try {
    // External delivery and signing may yield long enough for another process
    // to perform crash recovery. Renew atomically immediately before crossing
    // that boundary; an already-expired owner can never revive its lease.
    services.store.renewRegistrationProvisioningLease(provisioning);
    if (policy.requireEmailVerification) {
      await sendRegistrationVerification({
        services, user, nativeContinuation,
        requestedMfaSetup: policy.requestedMfaSetup,
      });
    } else {
      completion = await buildAuthCompletionResponse({
        user, tokenService: services.tokenService, authConfig,
        mfaChallengeService: services.mfaChallengeService,
        tenantSessionService: services.tenantSessions,
        requestedMfaSetup: policy.requestedMfaSetup,
        sessionBinding: toRegistrationSessionBinding(tenantCreation),
      });
    }
    services.store.finalizeRegistrationProvisioning(provisioning, auditRequest);
  } catch (error) {
    let rollback;
    try {
      rollback = rollbackRegistration({
        store: services.store,
        provisioning,
        nativeAuthorization,
        nativeContinuation,
      });
    } catch (rollbackError) {
      if (policy.requireEmailVerification) {
        emitPlatformCode(OBS_CODES.AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED, {
          userId: user.userId,
          metadata: {
            source: 'registration',
            cleanupSucceeded: false,
            continuationReleased: false,
          },
        });
      }
      throw rollbackError;
    }
    if (policy.requireEmailVerification) {
      emitPlatformCode(OBS_CODES.AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED, {
        userId: user.userId,
        metadata: { source: 'registration', ...rollback },
      });
    }
    throw error;
  }

  if (policy.requireEmailVerification) {
    emitPlatformCode(OBS_CODES.AUTH_EMAIL_VERIFICATION_SENT, {
      userId: user.userId,
      metadata: { source: 'registration' },
    });
  }
  if (policy.isBootstrap) {
    emitPlatformCode(OBS_CODES.AUTH_FIRST_ADMIN_BOOTSTRAPPED, { userId: user.userId });
  }
  const tenant = tenantCreation ? toRegistrationTenant(tenantCreation) : undefined;
  if (policy.requireEmailVerification) {
    return {
      user: toAuthUserResponse(user),
      ...(tenant ? { tenant } : {}),
    };
  }
  if (!completion) {
    throw new Error('[auth] Registration completion response is unavailable.');
  }
  return { ...completion, ...(tenant ? { tenant } : {}) };
}

function toRegistrationSessionBinding(created: TenantCreationResult | null) {
  return created ? {
    tenantId: created.tenant.tenantId,
    membershipId: created.ownerMembership.membershipId,
  } : undefined;
}
