/** Composition root for Guardian's system.db -> application/Fabric anchors. */

import type { ReactiveDB } from '../../sync/reactive-db';
import type { TableSchema } from '../../sync/types';
import { getGuardianAnchorRequirements } from '../../schema/guardian-references';
import type {
  DatabaseManager,
  DatabaseTenantIdentityProjectionOptions,
} from '../../databases/database-manager';
import { IdentityAnchorStore } from '../../auth/identity-anchor-store';
import { IdentityProjectionOutboxStore } from '../../auth/identity-projection-outbox-store';
import { IdentityProjectionService } from '../../auth/identity-projection-service';
import { identityProjectionError } from '../../auth/identity-projection-error';
import type { AuthContext } from '../../auth/types';
import type { TenantKind } from '../../auth/tenancy/tenancy-types';
import type {
  IdentityAnchorState,
  IdentityProjectionLifecycleHook,
  IdentityProjectionTarget,
} from '../../auth/identity-projection-types';
import type {
  DataRealmReadinessRequest,
  DataRealmReadinessService,
} from '../../auth/data-realm-readiness.plugin';
import type { DataRealmReadinessSnapshot } from '../../auth/data-realm-readiness-types';
import type { AuthPlatformCodeEmitter } from '../../auth/auth-observability';
import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import {
  APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
  membershipIdentityAnchor,
  tenantProjectionTargetId,
  userIdentityAnchor,
} from './identity-projection-anchors';
import {
  assertApplicationGuardianReferenceStorage,
  assertAppIdentityProjectionConfiguration,
  partitionIdentityProjectionRequirements,
  type PartitionedIdentityProjectionRequirements,
} from './identity-projection-config';
import {
  assertDataRealmReadinessRequestNotAborted,
  identityProjectionReadinessFromState,
  identityProjectionReadinessFromTarget,
  identityProjectionReadinessFromTargetError,
  NOT_REQUIRED_DATA_REALM_READINESS,
  notRequiredDataRealmReadiness,
} from './identity-projection-readiness';
import {
  GuardianIdentityProjectionSource,
} from './identity-projection-guardian-source';
import {
  IdentityProjectionTenantProvisioner,
} from './identity-projection-tenant-provisioner';

const APPLICATION_RECONCILE_BATCH_SIZE = 10_000;
const TENANT_RECONCILE_BATCH_SIZE = 100;

export {
  assertApplicationGuardianReferenceStorage,
  assertAppIdentityProjectionConfiguration,
  NOT_REQUIRED_DATA_REALM_READINESS,
  tenantProjectionTargetId,
};

export interface AppIdentityProjectionRuntimeOptions {
  readonly systemDB: ReactiveDB;
  readonly applicationDB: ReactiveDB;
  readonly tables: Readonly<Record<string, TableSchema>>;
  readonly tenantDatabaseTables?: ReadonlySet<string>;
  /** Tenant purposes admitted by at least one physical Resource policy. */
  readonly eligibleTenantKinds?: readonly TenantKind[];
  readonly tenancyMode: 'single' | 'multi';
  readonly getDatabaseManager: () => DatabaseManager | null;
  readonly emitCode?: AuthPlatformCodeEmitter;
}

/** Null means no declared schema field needs a Guardian FK anchor. */
export function createAppIdentityProjectionRuntime(
  options: AppIdentityProjectionRuntimeOptions,
): AppIdentityProjectionRuntime | null {
  const requirements = partitionIdentityProjectionRequirements(
    options.tables,
    options.tenantDatabaseTables ?? new Set(),
  );
  if (!requirements.application.user && !requirements.tenant.user) return null;
  return new AppIdentityProjectionRuntime(options, requirements);
}

/** Owns durable routing, catch-up, readiness, and tenant provisioner callbacks. */
export class AppIdentityProjectionRuntime implements DataRealmReadinessService {
  readonly lifecycle: IdentityProjectionLifecycleHook;
  readonly tenantManagerOptions: DatabaseTenantIdentityProjectionOptions | null;

  private readonly outbox: IdentityProjectionOutboxStore;
  private readonly projector: IdentityProjectionService;
  private readonly source: GuardianIdentityProjectionSource;
  private readonly tenantProvisioner: IdentityProjectionTenantProvisioner;
  private readonly applicationTarget: IdentityAnchorStore | null;
  private readonly installationId: string;
  private readonly emitCode: AuthPlatformCodeEmitter;
  private readonly eligibleTenantKinds: ReadonlySet<TenantKind>;

  constructor(
    private readonly options: AppIdentityProjectionRuntimeOptions,
    private readonly requirements: PartitionedIdentityProjectionRequirements,
  ) {
    this.emitCode = options.emitCode ?? emitPlatformCode;
    this.outbox = new IdentityProjectionOutboxStore(options.systemDB);
    this.source = new GuardianIdentityProjectionSource(options.systemDB);
    this.eligibleTenantKinds = new Set(
      options.eligibleTenantKinds ?? ['organization', 'administration'],
    );
    this.installationId = this.outbox.getInstallationId();
    this.projector = new IdentityProjectionService(this.outbox, {
      emitCode: this.emitCode,
    });
    this.tenantProvisioner = new IdentityProjectionTenantProvisioner(
      options.getDatabaseManager,
      this.emitCode,
    );
    this.applicationTarget = requirements.application.user
      ? this.createApplicationTarget(options.applicationDB)
      : null;
    this.tenantManagerOptions = requirements.tenant.user
      ? Object.freeze({
          installationId: this.installationId,
          targetIdForTenant: tenantProjectionTargetId,
          reconcile: async (
            tenantId: string,
            targetId: string,
            target: IdentityProjectionTarget,
          ) => {
            this.prepareTenantTarget(tenantId, targetId);
            await this.reconcileTenant(targetId, target);
          },
        })
      : null;
    this.lifecycle = Object.freeze({
      initialize: () => this.initialize(),
      userCreated: (userId: string) => this.userCreated(userId),
      membershipCreated: (input: {
        membershipId: string;
        tenantId: string;
        userId: string;
      }) => this.membershipCreated(input),
    });
  }

  async inspect(request: DataRealmReadinessRequest): Promise<DataRealmReadinessSnapshot> {
    assertDataRealmReadinessRequestNotAborted(request.signal);
    const selection = this.selectTarget(request.auth);
    if (!selection) return notRequiredDataRealmReadiness();
    const sourceState = this.outbox.getTargetState(selection.targetId);
    assertDataRealmReadinessRequestNotAborted(request.signal);
    const sourceReadiness = identityProjectionReadinessFromState(
      sourceState,
      selection.scope,
    );
    if (sourceReadiness.status !== 'ready') return sourceReadiness;
    let targetState: IdentityAnchorState | null;
    try {
      targetState = selection.scope === 'application'
        ? this.applicationTarget?.inspect() ?? null
        : await this.tenantProvisioner.inspect(request.auth.tenantId!);
    } catch (error) {
      assertDataRealmReadinessRequestNotAborted(request.signal);
      return identityProjectionReadinessFromTargetError(
        sourceState,
        selection.scope,
        error,
      );
    }
    assertDataRealmReadinessRequestNotAborted(request.signal);
    return identityProjectionReadinessFromTarget(sourceState, targetState, {
      installationId: this.installationId,
      targetId: selection.targetId,
      scope: selection.scope,
    });
  }

  async retry(request: DataRealmReadinessRequest): Promise<DataRealmReadinessSnapshot> {
    assertDataRealmReadinessRequestNotAborted(request.signal);
    const selection = this.selectTarget(request.auth);
    if (!selection) return notRequiredDataRealmReadiness();
    try {
      if (selection.scope === 'application') {
        this.reconcileApplication();
      } else {
        if (!await this.tenantProvisioner.ensure(request.auth.tenantId!)) {
          return await this.inspect(request);
        }
      }
    } catch {
      // Retry is only an attempt. Re-inspect both durable planes so an
      // unavailable or mismatched target can never inherit source readiness.
      return await this.inspect(request);
    }
    return await this.inspect(request);
  }

  /**
   * Establish the live caller's application-plane FK anchors before a managed
   * Resource or Sync mutation. Callers revalidate authority after this work.
   */
  ensureApplicationIdentityAnchors(
    tableName: string,
    auth: AuthContext | null | undefined,
  ): void {
    const table = this.options.tables[tableName];
    if (!table) return;
    const requirements = getGuardianAnchorRequirements(table);
    if (requirements.length === 0) return;
    if (this.options.tenantDatabaseTables?.has(tableName)) return;
    if (!this.applicationTarget || !auth?.userId) {
      throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    }

    if (!this.source.hasUser(auth.userId)) {
      throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    }
    this.projector.ensureAnchorSync(
      APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
      userIdentityAnchor(auth.userId),
      this.applicationTarget,
    );

    if (!requirements.includes('membership')) return;
    if (!auth.tenantId || !auth.membershipId) {
      throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    }
    const membership = this.source.findMembership({
      membershipId: auth.membershipId,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    if (!membership) {
      throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    }
    this.projector.ensureAnchorSync(
      APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
      membershipIdentityAnchor(membership),
      this.applicationTarget,
    );
  }

  private createApplicationTarget(db: ReactiveDB): IdentityAnchorStore {
    this.outbox.registerTarget(APPLICATION_IDENTITY_PROJECTION_TARGET_ID, 'application');
    return new IdentityAnchorStore(db, {
      installationId: this.installationId,
      targetId: APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
    });
  }

  private initialize(): void {
    this.options.systemDB.transaction(() => {
      const existingTargets = this.requirements.tenant.user
        ? new Map(this.outbox.listTargetStates().map((state) => [state.targetId, state]))
        : null;
      if (this.requirements.application.user) {
        for (const userId of this.source.listUsers()) {
          this.outbox.enqueue(
            APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
            userIdentityAnchor(userId),
          );
        }
      }
      if (this.options.tenancyMode === 'multi') {
        for (const membership of this.source.listMemberships()) {
          if (this.requirements.application.membership) {
            this.outbox.enqueue(
              APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
              userIdentityAnchor(membership.userId),
            );
            this.outbox.enqueue(
              APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
              membershipIdentityAnchor(membership),
            );
          }
          if (this.requirements.tenant.user) {
            const targetId = tenantProjectionTargetId(membership.tenantId);
            const target = existingTargets!.get(targetId);
            // Fabric targets are lazy. A membership alone must not allocate a
            // journal target or physical database (notably for the protected
            // administration organization). Existing admitted targets still
            // catch up after a restart.
            if (!target) continue;
            if (target.scope !== 'tenant') {
              throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
            }
            if (target.status === 'quarantined') continue;
            this.outbox.enqueue(targetId, userIdentityAnchor(membership.userId));
            if (this.requirements.tenant.membership) {
              this.outbox.enqueue(targetId, membershipIdentityAnchor(membership));
            }
          }
        }
      }
    });
    this.reconcileApplication();
  }

  private userCreated(userId: string): void {
    if (!this.requirements.application.user) return;
    this.outbox.enqueue(
      APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
      userIdentityAnchor(userId),
    );
    this.afterGuardianCommit(() => this.reconcileApplication());
  }

  private membershipCreated(input: {
    membershipId: string;
    tenantId: string;
    userId: string;
  }): void {
    if (this.requirements.application.membership) {
      this.outbox.enqueue(
        APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
        userIdentityAnchor(input.userId),
      );
      this.outbox.enqueue(
        APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
        membershipIdentityAnchor(input),
      );
      this.afterGuardianCommit(() => this.reconcileApplication());
    }
    if (this.requirements.tenant.user) {
      const targetId = tenantProjectionTargetId(input.tenantId);
      const target = this.outbox.getTargetState(targetId);
      // First admitted data access prepares the complete tenant target. Until
      // then Guardian membership creation remains system-plane-only.
      if (!target) return;
      if (target.scope !== 'tenant') {
        throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
      }
      this.outbox.enqueue(targetId, userIdentityAnchor(input.userId));
      if (this.requirements.tenant.membership) {
        this.outbox.enqueue(targetId, membershipIdentityAnchor(input));
      }
      this.afterGuardianCommit(() => this.tenantProvisioner.schedule(input.tenantId));
    }
  }

  private reconcileApplication(): void {
    if (!this.applicationTarget) return;
    while (true) {
      const result = this.projector.reconcileTargetSync(
        APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
        this.applicationTarget,
        APPLICATION_RECONCILE_BATCH_SIZE,
      );
      if (result.processed < APPLICATION_RECONCILE_BATCH_SIZE) return;
    }
  }

  private async reconcileTenant(
    targetId: string,
    target: IdentityProjectionTarget,
  ): Promise<void> {
    while (true) {
      const result = await this.projector.reconcileTarget(
        targetId,
        target,
        TENANT_RECONCILE_BATCH_SIZE,
      );
      if (result.processed < TENANT_RECONCILE_BATCH_SIZE) return;
    }
  }

  /** Register and seed a tenant journal only after Fabric admitted its realm. */
  private prepareTenantTarget(tenantId: string, targetId: string): void {
    const expectedTargetId = tenantProjectionTargetId(tenantId);
    if (targetId !== expectedTargetId) {
      throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
    }
    this.options.systemDB.transaction(() => {
      this.outbox.registerTarget(targetId, 'tenant');
      for (const membership of this.source.listMembershipsForTenant(tenantId)) {
        this.outbox.enqueue(targetId, userIdentityAnchor(membership.userId));
        if (this.requirements.tenant.membership) {
          this.outbox.enqueue(targetId, membershipIdentityAnchor(membership));
        }
      }
    });
  }

  private afterGuardianCommit(callback: () => void): void {
    this.options.systemDB.afterCommit(callback);
  }

  private selectTarget(auth: DataRealmReadinessRequest['auth']): Readonly<{
    targetId: string;
    scope: 'application' | 'tenant';
  }> | null {
    if (this.requirements.tenant.user
      && auth.sessionScopeKind === 'tenant'
      && auth.tenantId
      && auth.membershipId
      && auth.tenantKind
      && this.eligibleTenantKinds.has(auth.tenantKind)) {
      return Object.freeze({
        targetId: tenantProjectionTargetId(auth.tenantId),
        scope: 'tenant',
      });
    }
    if (this.requirements.application.user) {
      return Object.freeze({
        targetId: APPLICATION_IDENTITY_PROJECTION_TARGET_ID,
        scope: 'application',
      });
    }
    return null;
  }
}
