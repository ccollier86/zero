import { AuthError } from '../types';
import { TenantStoreContext } from './tenant-store-context';
import {
  TENANT_OWNER_ROLE_KEY,
  TenancyError,
  type PreparedTenantCreation,
  type TenantCreationResult,
  type TenantRecord,
  type TenantStatus,
} from './tenancy-types';

/** Coordinates tenant-boundary lifecycle mutations over one persistence context. */
export class TenantStoreTenantLifecycle {
  constructor(private readonly context: TenantStoreContext) {}

  persistPreparedTenantWithOwner(
    prepared: PreparedTenantCreation,
  ): TenantCreationResult {
    try {
      return this.context.mutation(() => {
        this.context.requireUser(prepared.ownerUserId);
        this.context.requireUser(prepared.createdBy);
        if (!this.context.statements.tokenEligibleUserExists.get(prepared.ownerUserId)
          && !this.context.statements.pendingRegistrationUserExists.get(
            prepared.ownerUserId,
            prepared.tenantId,
          )) {
          throw new TenancyError(
            'Initial owner must be able to authenticate or belong to the active registration',
            'TENANT_OWNERSHIP_TARGET_INVALID',
          );
        }
        this.context.statements.insertTenant.run(
          prepared.tenantId,
          prepared.kind,
          prepared.slug,
          prepared.name,
          prepared.createdBy,
          prepared.createdAt,
          prepared.createdAt,
        );
        this.context.statements.insertMembership.run(
          prepared.membershipId,
          prepared.tenantId,
          prepared.ownerUserId,
          TENANT_OWNER_ROLE_KEY,
          prepared.createdAt,
          prepared.createdAt,
          prepared.createdAt,
          prepared.createdBy,
        );
        this.context.notifyOwnerCreated({
          tenantId: prepared.tenantId,
          membershipId: prepared.membershipId,
          userId: prepared.ownerUserId,
          createdBy: prepared.createdBy,
          createdAt: prepared.createdAt,
        });
        return {
          tenant: this.context.requireTenant(prepared.tenantId),
          ownerMembership: this.context.requireMembership(prepared.membershipId),
        };
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (error instanceof TenancyError) throw error;
      // Never translate a stale-runtime fence failure into a slug conflict.
      this.context.assertCurrentProfile();
      if (this.context.getTenantByCanonicalSlug(prepared.slug)) {
        throw new TenancyError(
          `Tenant slug is already in use: ${prepared.slug}`,
          'TENANT_SLUG_TAKEN',
        );
      }
      throw error;
    }
  }

  adoptAdministrationTenant(tenantId: string): TenantRecord {
    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      const current = this.context.requireTenant(tenantId);
      const administration = this.context.getAdministrationTenant();
      if (administration) {
        if (administration.tenantId === tenantId) return administration;
        throw new TenancyError(
          'An administration tenant already exists',
          'TENANT_ADMINISTRATION_EXISTS',
        );
      }
      if (current.status !== 'active') {
        throw new TenancyError(
          'Administration tenant must be active',
          'TENANT_NOT_ACTIVE',
        );
      }
      const changedAt = this.context.now();
      const changed = this.context.db.prepare(`
        UPDATE _auth_tenants
        SET kind = 'administration',
            authorization_generation = authorization_generation + 1,
            updated_at = ?
        WHERE tenant_id = ? AND kind = 'organization' AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM _auth_tenants WHERE kind = 'administration'
          )
      `).run(changedAt, tenantId);
      // `changes` includes the authorization-revision trigger on an installed
      // runtime, so successful adoption may report more than the tenant row.
      if (changed.changes < 1) {
        throw new TenancyError(
          'Administration tenant adoption conflicted with current state',
          'TENANT_ADMINISTRATION_EXISTS',
        );
      }
      const adopted = this.context.requireTenant(tenantId);
      if (adopted.kind !== 'administration') {
        throw new TenancyError(
          'Administration tenant adoption did not establish the protected scope',
          'TENANT_ADMINISTRATION_REQUIRED',
        );
      }
      return adopted;
    });
  }

  suspendTenant(tenantId: string): TenantRecord {
    return this.changeTenantStatus(tenantId, 'suspended');
  }

  reactivateTenant(tenantId: string): TenantRecord {
    return this.changeTenantStatus(tenantId, 'active');
  }

  bumpTenantAuthorizationGeneration(tenantId: string): TenantRecord {
    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      this.context.statements.bumpTenantGeneration.run(this.context.now(), tenantId);
      return this.context.requireTenant(tenantId);
    });
  }

  private changeTenantStatus(
    tenantId: string,
    status: Extract<TenantStatus, 'active' | 'suspended'>,
  ): TenantRecord {
    return this.context.mutation(() => {
      this.context.lockTenant(tenantId);
      const current = this.context.requireTenant(tenantId);
      if (current.status === status) return current;
      if (current.kind === 'administration') {
        throw new TenancyError(
          'The administration tenant cannot be suspended',
          'TENANT_ADMINISTRATION_PROTECTED',
        );
      }
      if (current.status === 'archived') {
        throw new TenancyError(
          'An archived tenant cannot change active suspension state',
          'TENANT_STATUS_CONFLICT',
        );
      }
      if (status === 'active') this.context.assertTenantHasActiveOwner(tenantId);
      const now = this.context.now();
      this.context.statements.updateTenantStatus.run(
        status,
        now,
        status === 'suspended' ? now : null,
        tenantId,
      );
      return this.context.requireTenant(tenantId);
    });
  }
}
