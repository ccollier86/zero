/**
 * Default row-level Sync policy for framework-owned client tables.
 *
 * `createSyncPlugin()` deliberately remains public-by-default for standalone
 * use. `createApp()` wraps its app-resource policy with this adapter so raw
 * Sync clients cannot turn framework table names into a cross-user read API.
 */

import type { ReactiveDB } from '../../sync/reactive-db';
import {
  createRequestAuthorizationAccess,
  type AuthorizationRoleAssignmentResolver,
  type RequestAuthorizationAccess,
} from '../../auth/authorization-access';
import type { AuthorizationKernel } from '../../auth/authorization-kernel';
import type {
  Change,
  Row,
  SyncAuthContext,
  SyncHistoryGap,
  SyncResourceMutationContext,
  SyncResourceMutationDecision,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccess,
  SyncResourceTableAccessContext,
  SyncRowFilter,
  SyncRowProjector,
} from '../../sync/types';
import {
  serviceDataScopeFromIdentity,
  serviceDataScopeKey,
  serviceDataScopeMatchesTenant,
  serviceDataTenantId,
  type ServiceDataScope,
} from '../../auth/service-data-scope';
import {
  notificationAudienceRoles,
} from '../../notifications/notification-access';
import { canManageWorkflowScope } from '../../workflows/workflow-access';

/** Framework tables that must never be exposed through generic Sync reads. */
export const PLATFORM_SYNC_PRIVATE_TABLES = new Set([
  'users',
  'workflow_definitions',
  'storage_drives',
  'storage_objects',
]);

const PLATFORM_SYNC_SCOPED_TABLES = new Set([
  'notifications',
  'notification_receipts',
  'rooms',
  'room_members',
  'workflow_instances',
  'workflow_steps',
  'workflow_events',
]);

export interface PlatformSyncPolicyOptions {
  /** Existing app-resource adapter. Its decisions remain deny-wins. */
  delegate: SyncResourcePolicyAdapter;
  /** Lazy providers avoid coupling policy construction to plugin startup. */
  getDB: () => ReactiveDB | null;
  /** App-local live authorization registry used for effective scope roles. */
  getAuthorizationKernel?: () => AuthorizationKernel | null;
  /** Advanced-mode live additive role assignments. */
  getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
  /** Multi mode rejects identity-only/application sessions for service data. */
  tenancyMode?: 'single' | 'multi';
}

interface PlatformFilterCache {
  rooms?: {
    ids: string[];
    set: Set<string>;
    revision: number;
    refreshIfStale: () => void;
    hasCurrentMembership: (roomId: string) => boolean;
  };
}

const PLATFORM_READ_AUTHORITY_FINGERPRINT_VERSION = 'zero-platform-read-v1';

interface PlatformReadAuthorityFingerprint {
  readonly delegate: string;
  readonly roomMembership: Readonly<{
    userId: string;
    revision: number;
  }>;
}

/**
 * Compose app resource policy with Zero's framework-table row policy.
 *
 * The adapter only changes framework-owned tables. App tables retain the
 * delegate's exact table and row decisions, including mutation stamping.
 */
export class PlatformSyncPolicyService implements SyncResourcePolicyAdapter {
  private readonly roomMembershipRevisions = new Map<string, number>();
  private roomMembershipResetRevision = 0;

  constructor(private readonly options: PlatformSyncPolicyOptions) {}

  /** App tables retain the delegate's explicit realm classification. */
  classifyManagedTableRealm(table: string): 'global' | 'tenant' | null {
    return this.options.delegate.classifyManagedTableRealm?.(table) ?? null;
  }

  /** App tables retain the delegate's immutable client exposure. */
  classifyManagedTableExposure(
    table: string,
  ): 'internal' | 'http' | 'sync' | 'all' | null {
    return this.options.delegate.classifyManagedTableExposure?.(table) ?? null;
  }

  /** Preserve the Resource registry's trusted default/tenant routing proof. */
  classifyManagedTableDataPlane(table: string): 'default' | 'tenant' | null {
    return this.options.delegate.classifyManagedTableDataPlane?.(table) ?? null;
  }

  /**
   * Advance room authorization state before live delivery considers client
   * subscriptions. This keeps `rooms`-only subscribers from retaining a stale
   * membership cache when the unseen `room_members` table changes.
   */
  observeChange(change: Change): void {
    if (change.table === 'room_members') {
      const affectedUsers = new Set<string>();
      for (const row of [change.previousRow, change.row]) {
        if (typeof row?.user_id === 'string') affectedUsers.add(row.user_id);
      }
      for (const userId of affectedUsers) {
        this.roomMembershipRevisions.set(
          userId,
          (this.roomMembershipRevisions.get(userId) ?? 0) + 1,
        );
      }
    }

    const observer = this.options.delegate.observeChange as
      | ((value: Change) => unknown)
      | undefined;
    const outcome = observer?.call(this.options.delegate, change);
    if (isPromiseLike(outcome)) {
      // The outer Sync runtime can only preserve its ordered authorization
      // history when every observer finishes before the cursor advances.
      void Promise.resolve(outcome).catch(() => {});
      throw new Error(
        'ZERO_SYNC_POLICY_OBSERVER_ASYNC: delegated observeChange must be synchronous',
      );
    }
  }

  /**
   * Invalidate state that could have missed one or more observeChange events.
   * The hook is deliberately synchronous: expensive reconstruction remains
   * lazy inside the next resolve/filter read, before a client can reconnect.
   */
  onHistoryGap(gap: SyncHistoryGap): void {
    if (this.options.delegate.observeChange && !this.options.delegate.onHistoryGap) {
      throw new Error(
        'ZERO_SYNC_POLICY_HISTORY_GAP_UNHANDLED: delegated stateful policy cannot rebuild',
      );
    }
    const reset = this.options.delegate.onHistoryGap as
      | ((value: SyncHistoryGap) => unknown)
      | undefined;
    const outcome = reset?.call(this.options.delegate, gap);
    if (isPromiseLike(outcome)) {
      // Consume a later rejection so detecting the invalid contract cannot
      // create an unrelated unhandled-rejection failure during shutdown.
      void Promise.resolve(outcome).catch(() => {});
      throw new Error(
        'ZERO_SYNC_POLICY_HISTORY_GAP_ASYNC: delegated policy reset must be synchronous',
      );
    }
    this.roomMembershipResetRevision += 1;
  }

  async resolveTableAccess(
    context: SyncResourceTableAccessContext,
  ): Promise<SyncResourceTableAccess> {
    const delegated = await this.options.delegate.resolveTableAccess(context);
    const readableTables = new Set<string>();
    const rowFilters = new Map<string, SyncRowFilter>();
    const rowProjectors = new Map<string, SyncRowProjector>();
    const platformFingerprint: Array<[string, string]> = [];
    const filterCache: PlatformFilterCache = {};
    let tracksRoomMembershipAuthority = false;
    const db = this.options.getDB();
    const auth = context.authContext;
    const kernel = this.options.getAuthorizationKernel?.() ?? null;
    const access = auth
      ? createRequestAuthorizationAccess({
          authContext: auth,
          kernel,
          roleAssignments: this.options.getRoleAssignments?.() ?? null,
        })
      : null;

    for (const table of delegated.readableTables) {
      const delegateFilter = delegated.rowFilters.get(table);
      const delegateProjector = delegated.rowProjectors?.get(table);

      if (PLATFORM_SYNC_PRIVATE_TABLES.has(table)) {
        platformFingerprint.push([table, 'denied']);
        continue;
      }

      if (!PLATFORM_SYNC_SCOPED_TABLES.has(table)) {
        readableTables.add(table);
        if (delegateFilter) rowFilters.set(table, delegateFilter);
        if (delegateProjector) rowProjectors.set(table, delegateProjector);
        continue;
      }

      if (!auth || !access || !db) {
        platformFingerprint.push([table, 'unauthenticated']);
        continue;
      }

      const dataScope = serviceDataScopeFromIdentity(
        auth,
        this.options.tenancyMode ?? 'single',
      );
      if (!dataScope) {
        platformFingerprint.push([table, 'invalid-authorization-scope']);
        continue;
      }
      const authorization = access.authorization;
      const requiresAuthorizationProjection = kernel !== null
        || dataScope.scopeKind === 'tenant'
        || (this.options.tenancyMode ?? 'single') === 'multi';
      if (requiresAuthorizationProjection && (
        !authorization
        || authorization.scopeKind !== dataScope.scopeKind
        || authorization.scopeId !== dataScope.scopeId
        || (authorization.tenantId ?? null) !== dataScope.tenantId
      )) {
        // Match HTTP/request-facade semantics: configured authorization must
        // have a current live projection. In particular, an advanced profile
        // never falls back to membership.role_key when assignment resolution
        // is unavailable.
        platformFingerprint.push([table, 'invalid-live-authorization']);
        continue;
      }

      const platform = this.createPlatformFilter(
        table,
        auth,
        access,
        dataScope,
        db,
        filterCache,
      );
      if (!platform) {
        platformFingerprint.push([table, 'unavailable']);
        continue;
      }

      readableTables.add(table);
      rowFilters.set(
        table,
        delegateFilter ? andFilters(delegateFilter, platform.filter) : platform.filter,
      );
      if (delegateProjector) rowProjectors.set(table, delegateProjector);
      platformFingerprint.push([table, platform.fingerprint]);
      if (table === 'rooms' || table === 'room_members') {
        tracksRoomMembershipAuthority = true;
      }
    }

    platformFingerprint.sort(([left], [right]) => left.localeCompare(right));
    const delegateFingerprint = delegated.policyFingerprint;
    const hasUncomparableDelegatePolicy = delegateFingerprint === undefined
      && (
        delegated.rowFilters.size > 0
        || (delegated.rowProjectors?.size ?? 0) > 0
      );
    const readAuthorityFingerprint = delegated.readAuthorityFingerprint;

    return {
      readableTables,
      rowFilters,
      rowProjectors,
      ...(readAuthorityFingerprint === undefined
        ? {}
        : {
            readAuthorityFingerprint: tracksRoomMembershipAuthority && auth
              ? encodePlatformReadAuthorityFingerprint({
                  delegate: readAuthorityFingerprint,
                  roomMembership: {
                    userId: auth.userId,
                    revision: this.getRoomMembershipRevision(auth.userId),
                  },
                })
              : readAuthorityFingerprint,
          }),
      policyFingerprint: hasUncomparableDelegatePolicy
        ? undefined
        : JSON.stringify([delegateFingerprint ?? null, platformFingerprint]),
    };
  }

  authorizeMutation(
    context: SyncResourceMutationContext,
  ): Promise<SyncResourceMutationDecision> {
    return this.options.delegate.authorizeMutation(context);
  }

  validateMutationAuthorityAtCommit(
    authContext: SyncAuthContext | null,
    expectedFingerprint: string,
  ): boolean {
    return this.options.delegate.validateMutationAuthorityAtCommit?.(
      authContext,
      expectedFingerprint,
    ) ?? true;
  }

  /** Preserve the delegate's trusted Resource read-authority fence. */
  validateReadAuthorityAtDelivery(
    authContext: SyncAuthContext | null,
    expectedFingerprint: string,
  ): boolean {
    const platform = decodePlatformReadAuthorityFingerprint(expectedFingerprint);
    const delegateFingerprint = platform?.delegate ?? expectedFingerprint;
    const delegateCurrent = this.options.delegate.validateReadAuthorityAtDelivery?.(
      authContext,
      delegateFingerprint,
    ) ?? false;
    if (!delegateCurrent) return false;
    if (!platform) return true;
    return authContext?.userId === platform.roomMembership.userId
      && this.getRoomMembershipRevision(platform.roomMembership.userId)
        === platform.roomMembership.revision;
  }

  private createPlatformFilter(
    table: string,
    auth: SyncAuthContext,
    access: RequestAuthorizationAccess,
    dataScope: ServiceDataScope,
    db: ReactiveDB,
    cache: PlatformFilterCache,
  ): { filter: SyncRowFilter; fingerprint: string } | null {
    switch (table) {
      case 'notifications': {
        const roles = notificationAudienceRoles(access, dataScope);
        return {
          filter: rowFilter((row) =>
            serviceDataScopeMatchesTenant(dataScope, row.tenant_id)
            && notificationTargetsUser(row, auth.userId, roles)),
          fingerprint: JSON.stringify([
            'target',
            serviceDataScopeKey(dataScope),
            auth.userId,
            [...roles].sort(compareText),
            access.authorization?.revision ?? null,
          ]),
        };
      }

      case 'notification_receipts':
        return {
          filter: rowFilter((row) => row.user_id === auth.userId
            && serviceDataScopeMatchesTenant(dataScope, row.tenant_id)),
          fingerprint: `receipt:${serviceDataScopeKey(dataScope)}:${auth.userId}`,
        };

      case 'rooms':
      case 'room_members': {
        if (!db.hasTable('room_members')) return null;
        const memberships = cache.rooms ??= createRoomMembershipCache(
          db,
          auth.userId,
          dataScope,
          () => this.getRoomMembershipRevision(auth.userId),
        );
        const canReadRoom = (roomId: unknown) => {
          if (typeof roomId !== 'string') return false;
          memberships.refreshIfStale();
          return memberships.set.has(roomId);
        };
        const filter = table === 'rooms'
            ? rowFilter((row) => {
              if (!serviceDataScopeMatchesTenant(dataScope, row.tenant_id)) return false;
              if (canReadRoom(row.room_id)) return true;
              if (typeof row.room_id !== 'string') return false;

              // Room creation writes the room before its owner membership in
              // one deferred-change transaction. Recheck only this bounded
              // creator case so the committed membership can authorize the
              // room INSERT without scanning/querying for every hidden room.
              if (
                row.created_by === auth.userId
                && memberships.hasCurrentMembership(row.room_id)
              ) {
                memberships.set.add(row.room_id);
                return true;
              }
              return false;
            })
          : rowFilter((row) => {
              if (!serviceDataScopeMatchesTenant(dataScope, row.tenant_id)) return false;
              if (typeof row.room_id !== 'string') return false;
              if (row.user_id === auth.userId) {
                // Own membership INSERT/DELETE is always projected. Refresh
                // the shared set first so all subsequent room/member changes
                // on this socket immediately use the new authorization.
                if (memberships.hasCurrentMembership(row.room_id)) {
                  memberships.set.add(row.room_id);
                } else {
                  memberships.set.delete(row.room_id);
                }
                return true;
              }
              return canReadRoom(row.room_id);
            });
        return {
          filter,
          fingerprint: JSON.stringify([
            'room-member',
            serviceDataScopeKey(dataScope),
            memberships.revision,
            memberships.ids,
          ]),
        };
      }

      case 'workflow_instances': {
        const manageAll = canManageWorkflowScope(access, dataScope);
        return {
          filter: rowFilter((row) =>
            serviceDataScopeMatchesTenant(dataScope, row.tenant_id)
            && (manageAll || row.started_by === auth.userId)),
          fingerprint: manageAll
            ? `workflow:${serviceDataScopeKey(dataScope)}:scope-manager:${access.authorization?.revision ?? 'legacy'}`
            : `workflow:${serviceDataScopeKey(dataScope)}:owner:${auth.userId}`,
        };
      }

      case 'workflow_steps':
      case 'workflow_events': {
        // WorkflowService assigns started_by at creation and exposes no
        // ownership-transfer operation; direct Sync writes to every workflow
        // table are platform-protected. That invariant keeps the comparable
        // policy fingerprint stable as ordinary workflow instances are added.
        const manageAll = canManageWorkflowScope(access, dataScope);
        return {
          filter: rowFilter((row) =>
            serviceDataScopeMatchesTenant(dataScope, row.tenant_id)
            && (manageAll
              || workflowBelongsToUser(
                db,
                row.instance_id,
                auth.userId,
                dataScope,
              ))),
          fingerprint: manageAll
            ? `workflow-child:${serviceDataScopeKey(dataScope)}:scope-manager:${access.authorization?.revision ?? 'legacy'}`
            : `workflow-child:${serviceDataScopeKey(dataScope)}:owner:${auth.userId}`,
        };
      }

      default:
        return null;
    }
  }

  private getRoomMembershipRevision(userId: string): number {
    return this.roomMembershipResetRevision
      + (this.roomMembershipRevisions.get(userId) ?? 0);
  }
}

function encodePlatformReadAuthorityFingerprint(
  value: PlatformReadAuthorityFingerprint,
): string {
  return JSON.stringify([
    PLATFORM_READ_AUTHORITY_FINGERPRINT_VERSION,
    value.delegate,
    value.roomMembership.userId,
    value.roomMembership.revision,
  ]);
}

function decodePlatformReadAuthorityFingerprint(
  value: string,
): PlatformReadAuthorityFingerprint | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)
    || parsed.length !== 4
    || parsed[0] !== PLATFORM_READ_AUTHORITY_FINGERPRINT_VERSION
    || typeof parsed[1] !== 'string'
    || typeof parsed[2] !== 'string'
    || !Number.isSafeInteger(parsed[3])
    || parsed[3] < 0) return null;
  return {
    delegate: parsed[1],
    roomMembership: {
      userId: parsed[2],
      revision: parsed[3],
    },
  };
}

function rowFilter(matches: (row: Row) => boolean): SyncRowFilter {
  return { matches };
}

function andFilters(left: SyncRowFilter, right: SyncRowFilter): SyncRowFilter {
  return rowFilter((row) => left.matches(row) && right.matches(row));
}

function notificationTargetsUser(
  row: Row,
  userId: string,
  roles: readonly string[],
): boolean {
  switch (row.target_type) {
    case 'all':
      return true;
    case 'user':
      return row.target_value === userId;
    case 'role':
      return typeof row.target_value === 'string'
        && roles.includes(row.target_value);
    case 'users':
      if (typeof row.target_value !== 'string') return false;
      try {
        const values = JSON.parse(row.target_value);
        return Array.isArray(values) && values.includes(userId);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function createRoomMembershipCache(
  db: ReactiveDB,
  userId: string,
  scope: ServiceDataScope,
  getRevision: () => number,
): NonNullable<PlatformFilterCache['rooms']> {
  const listMemberships = db.prepare(
    'SELECT room_id FROM main.room_members WHERE user_id = ? AND tenant_id IS ? ORDER BY room_id',
  );
  const membership = db.prepare(
    `SELECT 1 AS present FROM main.room_members
     WHERE room_id = ? AND user_id = ? AND tenant_id IS ? LIMIT 1`,
  );
  const tenantId = serviceDataTenantId(scope);
  const readIds = () => (listMemberships.all(userId, tenantId) as Array<{ room_id: string }>)
    .map((row) => row.room_id);
  const ids = readIds();
  const cache: NonNullable<PlatformFilterCache['rooms']> = {
    ids,
    set: new Set(ids),
    revision: getRevision(),
    refreshIfStale() {
      const revision = getRevision();
      if (revision === cache.revision) return;
      cache.ids = readIds();
      cache.set = new Set(cache.ids);
      cache.revision = revision;
    },
    hasCurrentMembership(roomId) {
      return Boolean(membership.get(roomId, userId, tenantId));
    },
  };
  return cache;
}

function workflowBelongsToUser(
  db: ReactiveDB,
  instanceId: unknown,
  userId: string,
  scope: ServiceDataScope,
): boolean {
  if (typeof instanceId !== 'string' || !db.hasTable('workflow_instances')) return false;
  const instance = db.get('workflow_instances', instanceId);
  return instance?.started_by === userId
    && serviceDataScopeMatchesTenant(scope, instance.tenant_id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null)
    || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false;
}
