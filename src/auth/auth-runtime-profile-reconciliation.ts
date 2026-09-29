/** Startup-only reconciliation for one installed Auth profile. */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import type { AuthAuditService } from './auth-audit-service';
import {
  reconcileAuthorizationManifest,
  type AuthorizationManifestTransition,
} from './auth-authorization-manifest';
import { installAuthAuthorityRevision } from './auth-authority-revision';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import {
  InstalledAuthProfileGuard,
  reconcileInstalledAuthProfile,
} from './auth-profile-state';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { reconcileAdministrationTenant } from './tenancy/administration-tenant-reconciliation';
import type { TenancyService } from './tenancy/tenancy-service';
import { AuthError, type ResolvedAuthBehaviorConfig } from './types';
import type { UserStore } from './user-store';

export interface AuthRuntimeProfileReconciliationInput {
  db: ReactiveDB;
  authConfig: ResolvedAuthBehaviorConfig;
  authorizationKernel: AuthorizationKernel;
  userStore: UserStore;
  auditService: AuthAuditService;
  tenancyService: TenancyService | null;
  authorizationRoleService: AuthorizationRoleService | null;
  emitCode: AuthPlatformCodeEmitter;
}

export interface AuthRuntimeProfileReconciliation {
  readonly guard: InstalledAuthProfileGuard;
  readonly authorizationManifest: AuthorizationManifestTransition;
  readonly adoptedAdministrationTenantId: string | null;
}

/**
 * Reconcile profile, registry, provisioning recovery, and administration
 * ownership under the same writer transaction used by the installed marker.
 */
export function reconcileAuthRuntimeProfile(
  input: AuthRuntimeProfileReconciliationInput,
): AuthRuntimeProfileReconciliation {
  // Install the shared clock before profile adoption so role projection,
  // membership invalidation, and the profile marker are all observable to
  // other runtimes in the same commit.
  installAuthAuthorityRevision(input.db);

  const requestedProfile = {
    tenancy: input.authorizationKernel.tenancy.mode,
    authorization: input.authorizationKernel.authorization.mode,
  } as const;
  let adoptedAdministrationTenantId: string | null = null;
  let authorizationManifest!: AuthorizationManifestTransition;
  const profile = reconcileInstalledAuthProfile({
    db: input.db,
    requested: requestedProfile,
    legacySimpleRoleAdoption:
      input.authConfig.authorization?.legacySimpleRoleAdoption === true,
    audit: input.auditService,
    emitCode: input.emitCode,
    beforeCommit: (plan) => {
      try {
        authorizationManifest = reconcileAuthorizationManifest({
          db: input.db,
          authorization: input.authorizationKernel.authorization,
          tenancy: input.authorizationKernel.tenancy.mode,
          audit: input.auditService,
          allowProfileAxisChange: plan.kind !== 'unchanged'
            && plan.kind !== 'initialized',
        });
      } catch (error) {
        if (error instanceof AuthError) {
          input.emitCode(OBS_CODES.AUTH_AUTHORIZATION_REGISTRY_REJECTED, {
            metadata: { reasonCode: error.code },
            error,
          });
        }
        throw error;
      }

      // A process may have stopped after committing provisional identity/
      // owner state but before returning a completed registration. Recover
      // only under the same startup transaction as profile validation.
      input.userStore.recoverPendingRegistrationProvisioning();
      input.userStore.recoverPendingAdminUserProvisioning();
      input.userStore.reconcileBootstrapState();

      if (input.tenancyService) {
        const hadAdministrationTenant = Boolean(
          input.tenancyService.getAdministrationTenant(),
        );
        const administrationTenant = reconcileAdministrationTenant({
          tenancy: input.tenancyService,
          adoptTenantId:
            input.authConfig.tenancy?.administration?.adoptTenantId,
          audit: input.auditService,
          emitCode: input.emitCode,
        });
        if (!hadAdministrationTenant && administrationTenant) {
          adoptedAdministrationTenantId = administrationTenant.tenantId;
        }
      }

      const evidence = plan.kind === 'simple-to-advanced'
        && plan.requested.tenancy === 'multi'
        ? input.authorizationRoleService!.adoptSimpleTenantMembershipRoles()
        : undefined;

      if (input.authorizationRoleService) {
        input.authorizationRoleService.reconcileProtectedTenantOwners();
        if (plan.requested.tenancy === 'single') {
          // Global users.role is intentionally not projected into application
          // RBAC. Only the explicit protected-owner ceremony bridges an
          // installed single/simple app into single/advanced.
          const ownerAdoption = input.authConfig.authorization?.ownerAdoption;
          if (ownerAdoption
            && !input.authorizationRoleService.hasRetainedApplicationOwner()) {
            input.authorizationRoleService.adoptApplicationOwner(ownerAdoption);
          }
          if (input.userStore.countUsers() > 0
            && !input.authorizationRoleService.hasActiveApplicationOwner()
            && !input.authorizationRoleService
              .hasPendingApplicationOwnerVerification()) {
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
      input.tenancyService?.assertUsableOwnerInvariants();
      return evidence;
    },
  });

  return Object.freeze({
    guard: new InstalledAuthProfileGuard(
      input.db,
      profile.committed,
      authorizationManifest.committed,
    ),
    authorizationManifest,
    adoptedAdministrationTenantId,
  });
}

/** Emit reconciliation events only after the runtime installs its profile guard. */
export function emitAuthRuntimeProfileReconciliation(
  result: AuthRuntimeProfileReconciliation,
  emitCode: AuthPlatformCodeEmitter,
): void {
  const { authorizationManifest, adoptedAdministrationTenantId } = result;
  if (authorizationManifest.kind !== 'unchanged') {
    emitCode(
      authorizationManifest.kind === 'initialized'
        ? OBS_CODES.AUTH_AUTHORIZATION_REGISTRY_INITIALIZED
        : OBS_CODES.AUTH_AUTHORIZATION_REGISTRY_UPDATED,
      {
        metadata: {
          registryVersion: authorizationManifest.committed.registryVersion,
          fingerprint: authorizationManifest.committed.fingerprint,
        },
      },
    );
  }
  if (adoptedAdministrationTenantId) {
    emitCode(OBS_CODES.AUTH_ADMINISTRATION_TENANT_ADOPTED, {
      metadata: { tenantId: adoptedAdministrationTenantId },
    });
  }
}
