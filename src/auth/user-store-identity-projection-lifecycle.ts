import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import type { IdentityProjectionLifecycleHook } from './identity-projection-types';
import type { AuthTenancyMode } from './types';

type UserIdentityProjectionHook = Pick<
  IdentityProjectionLifecycleHook,
  'userCreated'
> & Partial<Pick<IdentityProjectionLifecycleHook, 'membershipCreated'>>;

interface UserIdentityProjectionLifecycleOptions {
  readonly tenancyMode: AuthTenancyMode;
  readonly hook?: UserIdentityProjectionHook;
  readonly emitCode?: AuthPlatformCodeEmitter;
}

interface MembershipIdentityRow {
  readonly membership_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
}

/**
 * Bridges UserStore identity commits into the synchronous projection outbox.
 *
 * Provisional identities remain private until their provisioning marker is
 * retired. Final activation republishes every membership created while that
 * marker existed, in a deterministic order, inside the caller's transaction.
 */
export class UserStoreIdentityProjectionLifecycle {
  private readonly tenancyMode: AuthTenancyMode;
  private readonly hook: UserIdentityProjectionHook | null;
  private readonly emitCode: AuthPlatformCodeEmitter | undefined;

  constructor(
    private readonly db: ReactiveDB,
    options: UserIdentityProjectionLifecycleOptions,
  ) {
    this.tenancyMode = options.tenancyMode;
    this.hook = options.hook ?? null;
    this.emitCode = options.emitCode;
  }

  /** Publish an identity that did not enter a provisional lifecycle. */
  userCreated(userId: string): void {
    if (!this.hook) return;
    invokeSynchronousAuthCallback(
      () => this.hook!.userCreated(userId),
      {
        component: 'user-store',
        invariant: 'identity-projection-user-hook-async',
        message: '[auth] Identity projection user hook must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  /**
   * Activate one finalized identity and every membership deferred while its
   * provisioning receipt was live. The caller owns the surrounding mutation.
   */
  activateFinalizedUser(userId: string): void {
    this.userCreated(userId);
    if (!this.hook?.membershipCreated || this.tenancyMode !== 'multi') return;

    for (const membership of this.listMemberships(userId)) {
      this.membershipCreated({
        membershipId: membership.membership_id,
        tenantId: membership.tenant_id,
        userId: membership.user_id,
      });
    }
  }

  private membershipCreated(input: {
    membershipId: string;
    tenantId: string;
    userId: string;
  }): void {
    invokeSynchronousAuthCallback(
      () => this.hook!.membershipCreated!(input),
      {
        component: 'user-store',
        invariant: 'identity-projection-membership-activation-hook-async',
        message: '[auth] Identity projection membership activation hook must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  private listMemberships(userId: string): MembershipIdentityRow[] {
    // Prepare lazily: direct UserStore consumers may install tenancy tables
    // after constructing the store, before they first finalize an identity.
    return this.db.prepare(`
      SELECT membership_id, tenant_id, user_id
      FROM _auth_tenant_memberships
      WHERE user_id = ?
      ORDER BY tenant_id, membership_id
    `).all(userId) as MembershipIdentityRow[];
  }
}
