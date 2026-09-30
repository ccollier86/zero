/** Guardian target adapter over one already-routed actor lease. */

import type {
  IdentityAnchorState,
  IdentityProjectionDelivery,
  IdentityProjectionReceipt,
  IdentityProjectionTarget,
} from '../auth/identity-projection-types';
import type { DatabaseCoordinatorLease } from './database-coordinator-contract';
import { executeCoordinatorIdentityProjection } from './database-coordinator-capability';
import {
  asIdentityProjectionError,
  type DatabaseIdentityProjectionResult,
} from './database-identity-projection-actor';

export class DatabaseActorIdentityProjectionTarget
implements IdentityProjectionTarget {
  constructor(
    private readonly lease: DatabaseCoordinatorLease,
    private readonly installationId: string,
    private readonly targetId: string,
  ) {}

  async inspect(): Promise<IdentityAnchorState> {
    const result = await this.execute('inspect');
    return result as IdentityAnchorState;
  }

  async apply(
    delivery: IdentityProjectionDelivery,
  ): Promise<IdentityProjectionReceipt> {
    const result = await this.execute('apply', delivery);
    return result as IdentityProjectionReceipt;
  }

  async markReady(): Promise<void> {
    await this.execute('mark-ready');
  }

  private async execute(
    action: 'inspect' | 'apply' | 'mark-ready',
    delivery?: IdentityProjectionDelivery,
  ): Promise<DatabaseIdentityProjectionResult> {
    try {
      return await executeCoordinatorIdentityProjection(this.lease, {
        action,
        installationId: this.installationId,
        targetId: this.targetId,
        ...(delivery ? { delivery } : {}),
      });
    } catch (error) {
      throw asIdentityProjectionError(error);
    }
  }
}
