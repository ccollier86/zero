import type {
  ActiveTenantMembership,
  CreateTenantMembershipInput,
  CreateTenantWithOwnerInput,
  PreparedTenantCreation,
  TenantCreationResult,
  TenantMembershipRecord,
  TenantOwnershipTransferResult,
  TenantRecord,
} from './tenancy-types';
import { TenantStore } from './tenant-store';

/**
 * Authorization-transport-neutral tenant control-plane service.
 *
 * Callers remain responsible for proving who may invoke each operation. The
 * store below this service owns persistence safety, generation invalidation,
 * uniqueness, and protected-owner invariants.
 */
export class TenancyService {
  constructor(readonly store: TenantStore) {}

  createTenant(input: CreateTenantWithOwnerInput): TenantCreationResult {
    return this.store.createTenantWithOwner(input);
  }

  prepareTenant(input: CreateTenantWithOwnerInput): PreparedTenantCreation {
    return this.store.prepareTenantWithOwner(input);
  }

  persistPreparedTenant(prepared: PreparedTenantCreation): TenantCreationResult {
    return this.store.persistPreparedTenantWithOwner(prepared);
  }

  addMembership(input: CreateTenantMembershipInput): TenantMembershipRecord {
    return this.store.createMembership(input);
  }

  getTenant(tenantId: string): TenantRecord | null {
    return this.store.getTenant(tenantId);
  }

  getTenantBySlug(slug: string): TenantRecord | null {
    return this.store.getTenantBySlug(slug);
  }

  getMembership(tenantId: string, userId: string): TenantMembershipRecord | null {
    return this.store.getMembership(tenantId, userId);
  }

  getMembershipById(membershipId: string): TenantMembershipRecord | null {
    return this.store.getMembershipById(membershipId);
  }

  listActiveMembershipsForUser(userId: string): TenantMembershipRecord[] {
    return this.store.listActiveMembershipsForUser(userId);
  }

  /** Return validated active membership and tenant pairs for session/onboarding choices. */
  listActiveTenantMembershipsForUser(userId: string): ActiveTenantMembership[] {
    const active: ActiveTenantMembership[] = [];
    for (const membership of this.store.listActiveMembershipsForUser(userId)) {
      const tenant = this.store.getTenant(membership.tenantId);
      // A live membership cannot confer a session into a suspended/archived
      // tenant. Treat that relationship as unavailable during completion.
      if (!tenant || tenant.status !== 'active') continue;
      active.push({ tenant, membership });
    }
    return active;
  }

  listActiveMembershipsForTenant(tenantId: string): TenantMembershipRecord[] {
    return this.store.listActiveMembershipsForTenant(tenantId);
  }

  suspendTenant(tenantId: string): TenantRecord {
    return this.store.suspendTenant(tenantId);
  }

  reactivateTenant(tenantId: string): TenantRecord {
    return this.store.reactivateTenant(tenantId);
  }

  suspendMembership(membershipId: string): TenantMembershipRecord {
    return this.store.suspendMembership(membershipId);
  }

  reactivateMembership(membershipId: string): TenantMembershipRecord {
    return this.store.reactivateMembership(membershipId);
  }

  readmitMembership(
    membershipId: string,
    roleKey = 'member',
  ): TenantMembershipRecord {
    return this.store.readmitMembership(membershipId, roleKey);
  }

  removeMembership(membershipId: string): TenantMembershipRecord {
    return this.store.removeMembership(membershipId);
  }

  transferOwnership(
    currentOwnerMembershipId: string,
    targetMembershipId: string,
    demotedRoleKey = 'member',
  ): TenantOwnershipTransferResult {
    return this.store.transferOwnership(
      currentOwnerMembershipId,
      targetMembershipId,
      demotedRoleKey,
    );
  }

  updateMembershipRole(membershipId: string, roleKey: string): TenantMembershipRecord {
    return this.store.updateMembershipRole(membershipId, roleKey);
  }

  bumpTenantAuthorizationGeneration(tenantId: string): TenantRecord {
    return this.store.bumpTenantAuthorizationGeneration(tenantId);
  }

  bumpMembershipAuthorizationGeneration(
    membershipId: string,
  ): TenantMembershipRecord {
    return this.store.bumpMembershipAuthorizationGeneration(membershipId);
  }

  assertUsableOwnerInvariants(): void {
    this.store.assertUsableOwnerInvariants();
  }
}
