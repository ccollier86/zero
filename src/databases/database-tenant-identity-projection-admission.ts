/**
 * Guardian identity-readiness admission for one already-routed tenant actor.
 *
 * Physical routing, tenant eligibility, and lease ownership remain with the
 * manager actor router. This collaborator owns only the projection protocol:
 * deterministic target construction, reconciliation before admission, and
 * target-local readiness inspection.
 */

import type { IdentityAnchorState } from '../auth/identity-projection-types';
import type { DatabaseCoordinatorLease } from './database-coordinator';
import { DatabaseActorIdentityProjectionTarget } from './database-identity-projection-target';
import type { DatabaseTenantIdentityProjectionOptions } from './database-manager-contract';

/** @internal Projection admission over leases owned by the actor router. */
export class DatabaseTenantIdentityProjectionAdmission {
  readonly #projection: DatabaseTenantIdentityProjectionOptions | null;

  constructor(projection: DatabaseTenantIdentityProjectionOptions | null) {
    this.#projection = projection;
  }

  get enabled(): boolean {
    return this.#projection !== null;
  }

  /** Reconcile retained ID-only anchors before exposing a tenant capability. */
  async reconcile(
    tenantId: string,
    lease: DatabaseCoordinatorLease,
  ): Promise<void> {
    const projection = this.#projection;
    if (!projection) return;
    const targetId = projection.targetIdForTenant(tenantId);
    await projection.reconcile(
      tenantId,
      targetId,
      this.#target(lease, projection, targetId),
    );
  }

  /** Inspect readiness within an existing target; never acquires or creates. */
  async inspect(
    tenantId: string,
    lease: DatabaseCoordinatorLease,
  ): Promise<IdentityAnchorState | null> {
    const projection = this.#projection;
    if (!projection) return null;
    const targetId = projection.targetIdForTenant(tenantId);
    return await this.#target(lease, projection, targetId).inspect();
  }

  #target(
    lease: DatabaseCoordinatorLease,
    projection: DatabaseTenantIdentityProjectionOptions,
    targetId: string,
  ): DatabaseActorIdentityProjectionTarget {
    return new DatabaseActorIdentityProjectionTarget(
      lease,
      projection.installationId,
      targetId,
    );
  }
}
