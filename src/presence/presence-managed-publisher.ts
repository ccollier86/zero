/** Infrastructure publisher over the existing DatabaseManager; target selection is server-owned. */
import type { DatabaseManager } from '../databases/database-manager';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import { presenceError } from './presence-error';
import { admitPinnedPresenceProjection } from './presence-projection-schema';
import { PresenceProjectionStore } from './presence-projection-store';
import type { PresencePublication, PresenceProjectionReceipt } from './presence-publication';
import type { PresenceProjectionPublisher } from './presence-service';

/** No request SDK sees this manager, raw writer or private publication method. */
export class ManagedPresencePublisher implements PresenceProjectionPublisher {
  private readonly ready = new Map<string, number>();
  private pinned: PresenceProjectionStore | null = null;
  private readonly actorTargets: boolean;
  constructor(private readonly manager: DatabaseManager, installAllowed: boolean, private readonly tenancyMode: 'single' | 'multi') {
    this.actorTargets = manager.diagnostics().tenantDatabasesEnabled;
    if ((!this.actorTargets || tenancyMode === 'single') && admitPinnedPresenceProjection(manager.appRuntime.db, installAllowed)) {
      this.pinned = new PresenceProjectionStore(manager.appRuntime.db);
    }
  }
  isReady(scope: ServiceDataScope, ownerEpoch: number): boolean { return this.ready.get(serviceDataScopeKey(scope)) === ownerEpoch; }

  /** Source owner guard joins writer admission and the actor's captured durable authority revision. */
  async publish(publication: PresencePublication, assertCurrent: () => void): Promise<PresenceProjectionReceipt> {
    assertCurrent();
    let result: PresenceProjectionReceipt;
    if (this.pinned && (this.tenancyMode === 'single' && publication.scopeKind === 'application'
      || this.tenancyMode === 'multi' && publication.scopeKind === 'tenant' && !this.actorTargets)) {
      result = this.manager.appRuntime.db.transaction(() => { assertCurrent(); const accepted = this.pinned!.apply(publication); assertCurrent(); return accepted; });
    } else if (this.tenancyMode === 'multi' && publication.scopeKind === 'tenant') {
      result = await this.manager.publishTenantPresence(publication.scopeId, publication, assertCurrent);
    } else throw presenceError('AUTH_PRESENCE_PROJECTION_INVALID');
    assertCurrent();
    if (!result.applied && !result.duplicate) throw presenceError('AUTH_PRESENCE_OWNER_LOST');
    const key = publication.scopeKind === 'tenant' ? `tenant:${publication.scopeId}` : 'application';
    if (publication.mode === 'ready') this.ready.set(key, publication.ownerEpoch);
    else if (publication.mode === 'reset' || publication.mode === 'retire') this.ready.delete(key);
    return result;
  }
}
