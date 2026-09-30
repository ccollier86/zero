/** Activation, publication, and teardown for an AuthRuntime service graph. */

import { OBS_CODES } from '../observability/codes';
import {
  ZERO_AUTH_AUDIT_SERVICE,
  ZERO_AUTH_API_KEY_SERVICE,
  ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
  ZERO_AUTH_STORE,
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_SESSION_SERVICE,
  ZERO_AUTH_TENANCY_SERVICE,
  ZERO_AUTH_TOKEN_SERVICE,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { shouldStartAuthEmailOutbox } from './auth-email-outbox-readiness';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import {
  resetAuthRuntimeServiceGraph,
  type AuthRuntimeServiceGraph,
} from './auth-runtime-service-graph';
import type { AuthorizationKernel } from './authorization-kernel';
import type { ResolvedAuthBehaviorConfig } from './types';

interface AuthRuntimeLifecycleInput {
  runtime?: ZeroAppRuntime;
  authConfig: ResolvedAuthBehaviorConfig;
  authorizationKernel: AuthorizationKernel;
  services: AuthRuntimeServiceGraph;
  emitCode: AuthPlatformCodeEmitter;
}

/** Start background owners and publish the fully initialized graph. */
export function activateAuthRuntimeServices(input: AuthRuntimeLifecycleInput): void {
  const { services } = input;
  // This is the final publication fence: workers and managed-container
  // services must never be exposed by a runtime whose exact generation
  // changed during asynchronous startup.
  services.installedProfileGuard!.assertCurrent();
  if (shouldStartAuthEmailOutbox(input.authConfig, services.accountEmailService!)) {
    services.authEmailOutbox!.start();
  }
  services.verifiedDomainOnboardingService?.start();
  services.auditService!.start();

  publishRuntimeServices(input);
  input.emitCode(OBS_CODES.AUTH_STARTED, {
    metadata: { tablesDefined: true, keypairInitialized: true },
  });
}

/**
 * Stop async owners, unpublish exact service instances, and clear the graph.
 * The first stop failure is rethrown after every remaining cleanup runs.
 */
export async function clearAuthRuntimeServices(
  input: AuthRuntimeLifecycleInput,
  emitStopped: boolean,
): Promise<void> {
  const { services } = input;
  const outbox = services.authEmailOutbox;
  const audit = services.auditService;
  const verifiedDomains = services.verifiedDomainOnboardingService;
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
  }
  try {
    audit?.stop();
  } catch (error) {
    failure ??= error;
  }
  try {
    unpublishRuntimeServices(input);
  } catch (error) {
    failure ??= error;
  } finally {
    // Clearing the private graph is the final teardown fence. It must run even
    // when a background owner or managed-container adapter has a faulty stop
    // implementation, otherwise a failed shutdown leaves callable services in
    // a runtime that its owner can no longer safely use.
    resetAuthRuntimeServiceGraph(services);
    if (emitStopped) input.emitCode(OBS_CODES.AUTH_STOPPED);
  }
  if (failure) throw failure;
}

/** Clear the constructor-published immutable kernel for an unused runtime. */
export function clearAuthRuntimeKernel(
  runtime: ZeroAppRuntime | undefined,
  authorizationKernel: AuthorizationKernel,
): void {
  runtime?.clear(ZERO_AUTHORIZATION_KERNEL, authorizationKernel);
}

function publishRuntimeServices(input: AuthRuntimeLifecycleInput): void {
  const { runtime, services, authorizationKernel } = input;
  if (!runtime || !services.userStore || !services.tokenService) return;
  try {
    if (services.auditService) {
      runtime.set(ZERO_AUTH_AUDIT_SERVICE, services.auditService);
    }
    runtime.set(ZERO_AUTH_STORE, services.userStore);
    runtime.set(ZERO_AUTH_TOKEN_SERVICE, services.tokenService);
    if (services.apiKeyService) {
      runtime.set(ZERO_AUTH_API_KEY_SERVICE, services.apiKeyService);
    }
    if (services.requestCredentialResolver) {
      runtime.set(
        ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
        services.requestCredentialResolver,
      );
    }
    runtime.set(ZERO_AUTHORIZATION_KERNEL, authorizationKernel);
    if (services.authorizationRoleService) {
      runtime.set(
        ZERO_AUTHORIZATION_ROLE_SERVICE,
        services.authorizationRoleService,
      );
    }
    if (services.authSessionService) {
      runtime.set(ZERO_AUTH_SESSION_SERVICE, services.authSessionService);
    }
    if (services.tenancyService) {
      runtime.set(ZERO_AUTH_TENANCY_SERVICE, services.tenancyService);
    }
  } catch (error) {
    unpublishRuntimeServices(input);
    throw error;
  }
}

function unpublishRuntimeServices(input: AuthRuntimeLifecycleInput): void {
  const { runtime, services, authorizationKernel } = input;
  if (!runtime) return;
  if (services.auditService) {
    runtime.clear(ZERO_AUTH_AUDIT_SERVICE, services.auditService);
  }
  if (services.userStore) runtime.clear(ZERO_AUTH_STORE, services.userStore);
  if (services.tokenService) {
    runtime.clear(ZERO_AUTH_TOKEN_SERVICE, services.tokenService);
  }
  if (services.apiKeyService) {
    runtime.clear(ZERO_AUTH_API_KEY_SERVICE, services.apiKeyService);
  }
  if (services.requestCredentialResolver) {
    runtime.clear(
      ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
      services.requestCredentialResolver,
    );
  }
  runtime.clear(ZERO_AUTHORIZATION_KERNEL, authorizationKernel);
  if (services.authorizationRoleService) {
    runtime.clear(
      ZERO_AUTHORIZATION_ROLE_SERVICE,
      services.authorizationRoleService,
    );
  }
  if (services.authSessionService) {
    runtime.clear(ZERO_AUTH_SESSION_SERVICE, services.authSessionService);
  }
  if (services.tenancyService) {
    runtime.clear(ZERO_AUTH_TENANCY_SERVICE, services.tenancyService);
  }
}
