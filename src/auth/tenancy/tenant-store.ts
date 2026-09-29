import type { ReactiveDB } from '../../sync/reactive-db';
import { AuthError } from '../types';
import {
  canonicalizeTenantName,
  canonicalizeTenantSlug,
} from './tenancy-canonicalization';
import { TenantStoreContext } from './tenant-store-context';
import { TenantStoreMembershipLifecycle } from './tenant-store-membership-lifecycle';
import type { TenantStoreOptions } from './tenant-store-options';
import { TenantStoreTenantLifecycle } from './tenant-store-tenant-lifecycle';
import {
  TenancyError,
  type CreateTenantMembershipInput,
  type CreateTenantWithOwnerInput,
  type PreparedTenantCreation,
  type TenantCreationResult,
  type TenantMembershipRecord,
  type TenantOwnershipTransferResult,
  type TenantRecord,
} from './tenancy-types';

export type { TenantStoreOptions } from './tenant-store-options';

/**
 * Persistence facade for internal tenant and membership records.
 *
 * The facade remains the stable integration surface while its private context
 * owns SQL/transaction mechanics and the lifecycle coordinators own tenant and
 * membership state transitions.
 */
export class TenantStore {
  private readonly context: TenantStoreContext;
  private readonly tenants: TenantStoreTenantLifecycle;
  private readonly memberships: TenantStoreMembershipLifecycle;

  constructor(
    private readonly db: ReactiveDB,
    options: TenantStoreOptions = {},
  ) {
    this.context = new TenantStoreContext(this.db, options, this);
    this.tenants = new TenantStoreTenantLifecycle(this.context);
    this.memberships = new TenantStoreMembershipLifecycle(this.context);
  }

  /** Atomically create a tenant and its protected initial owner membership. */
  createTenantWithOwner(input: CreateTenantWithOwnerInput): TenantCreationResult {
    const prepared = this.prepareTenantWithOwner(input);

    try {
      return this.persistPreparedTenantWithOwner(prepared);
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

  /** Validate and allocate identifiers before token signing starts. */
  prepareTenantWithOwner(input: CreateTenantWithOwnerInput): PreparedTenantCreation {
    return {
      tenantId: this.context.createTenantId(),
      membershipId: this.context.createMembershipId(),
      kind: input.kind ?? 'organization',
      slug: canonicalizeTenantSlug(input.slug),
      name: canonicalizeTenantName(input.name),
      ownerUserId: input.ownerUserId,
      createdBy: input.createdBy ?? input.ownerUserId,
      createdAt: this.context.now(),
    };
  }

  /**
   * Persist a prepared tenant and protected owner. Nested calls participate in
   * the caller's ReactiveDB transaction, which lets auth consume admission and
   * issue the bound parent/refresh family as one commit.
   */
  persistPreparedTenantWithOwner(
    prepared: PreparedTenantCreation,
  ): TenantCreationResult {
    return this.tenants.persistPreparedTenantWithOwner(prepared);
  }

  /** Create one retained tenant membership; duplicate relationships fail closed. */
  createMembership(input: CreateTenantMembershipInput): TenantMembershipRecord {
    return this.memberships.createMembership(input);
  }

  getTenant(tenantId: string): TenantRecord | null {
    return this.context.getTenant(tenantId);
  }

  getTenantBySlug(slug: string): TenantRecord | null {
    this.context.assertCurrentProfile();
    return this.context.getTenantByCanonicalSlug(canonicalizeTenantSlug(slug));
  }

  /** Return the sole protected administration tenant, when provisioned. */
  getAdministrationTenant(): TenantRecord | null {
    return this.context.getAdministrationTenant();
  }

  /** Count retained tenant boundaries for startup readiness checks. */
  countTenants(): number {
    return this.context.countTenants();
  }

  /**
   * Adopt one exact existing organization as the administration boundary.
   * The database permits this one-way transition only while no administration
   * tenant exists; kind can never be changed again afterward.
   */
  adoptAdministrationTenant(tenantId: string): TenantRecord {
    return this.tenants.adoptAdministrationTenant(tenantId);
  }

  getMembershipById(membershipId: string): TenantMembershipRecord | null {
    return this.context.getMembershipById(membershipId);
  }

  getMembership(tenantId: string, userId: string): TenantMembershipRecord | null {
    return this.context.getMembership(tenantId, userId);
  }

  /** Return only memberships currently usable for tenant authorization. */
  listActiveMembershipsForUser(userId: string): TenantMembershipRecord[] {
    return this.context.listActiveMembershipsForUser(userId);
  }

  /** One indexed existence check for dynamic platform-operator policy. */
  hasActiveAdministrationMembership(userId: string): boolean {
    return this.context.hasActiveAdministrationMembership(userId);
  }

  /** Return active members for tenant administration, even while the tenant is suspended. */
  listActiveMembershipsForTenant(tenantId: string): TenantMembershipRecord[] {
    return this.context.listActiveMembershipsForTenant(tenantId);
  }

  suspendTenant(tenantId: string): TenantRecord {
    return this.tenants.suspendTenant(tenantId);
  }

  reactivateTenant(tenantId: string): TenantRecord {
    return this.tenants.reactivateTenant(tenantId);
  }

  suspendMembership(membershipId: string): TenantMembershipRecord {
    return this.memberships.suspendMembership(membershipId);
  }

  reactivateMembership(membershipId: string): TenantMembershipRecord {
    return this.memberships.reactivateMembership(membershipId);
  }

  /**
   * Explicitly re-admit a suspended or removed retained relationship.
   *
   * This is intentionally separate from ordinary reactivation: removed
   * membership can regain authority only through a reviewer-owned onboarding
   * ceremony. Owner authority remains exclusive to ownership transfer.
   */
  readmitMembership(
    membershipId: string,
    roleKeyInput = 'member',
  ): TenantMembershipRecord {
    return this.memberships.readmitMembership(membershipId, roleKeyInput);
  }

  /** Retain the relationship for audit while permanently removing its authority. */
  removeMembership(membershipId: string): TenantMembershipRecord {
    return this.memberships.removeMembership(membershipId);
  }

  /**
   * Atomically promote a live target before demoting the current owner.
   *
   * The source is explicit because callers must derive it from the live
   * request membership. Generic role mutation remains unable to manufacture
   * or remove the protected owner lifecycle.
   */
  transferOwnership(
    currentOwnerMembershipId: string,
    targetMembershipId: string,
    demotedRoleKeyInput = 'member',
  ): TenantOwnershipTransferResult {
    return this.memberships.transferOwnership(
      currentOwnerMembershipId,
      targetMembershipId,
      demotedRoleKeyInput,
    );
  }

  /** Update the one simple-mode role and invalidate existing membership authority. */
  updateMembershipRole(
    membershipId: string,
    roleKeyInput: string,
  ): TenantMembershipRecord {
    return this.memberships.updateMembershipRole(membershipId, roleKeyInput);
  }

  /** Explicit tenant-wide invalidation for policy or emergency changes. */
  bumpTenantAuthorizationGeneration(tenantId: string): TenantRecord {
    return this.tenants.bumpTenantAuthorizationGeneration(tenantId);
  }

  /** Explicit invalidation for one retained membership. */
  bumpMembershipAuthorizationGeneration(
    membershipId: string,
  ): TenantMembershipRecord {
    return this.memberships.bumpMembershipAuthorizationGeneration(membershipId);
  }

  /** Fail startup closed on owner rows that cannot authenticate or verify. */
  assertUsableOwnerInvariants(): void {
    this.context.assertUsableOwnerInvariants();
  }
}
