/**
 * resource-sync-policy.ts
 *
 * Adapts registered Zero resources to the WebSocket sync authorization
 * boundary. This file owns resource-policy decisions for sync only; it does
 * not mount WebSocket routes, mutate ReactiveDB, or define resource helpers.
 */

import type { UserStore } from '../auth/user-store';
import type { AuthTenancyMode } from '../auth/types';
import { authContextAuthorityFingerprint } from '../auth/auth-context-authority';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import type {
  ChangeOp,
  Row,
  SyncAuthContext,
  SyncResourceMutationContext,
  SyncResourceMutationDecision,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccess,
  SyncResourceTableAccessContext,
  SyncRowFilter,
  SyncRowProjector,
} from '../sync/types';
import {
  projectResourceRow,
  validateResourceClientWriteFields,
} from './resource-field-access';
import {
  createResourcePolicyAuthorization,
  createResourcePolicyUser,
} from './resource-auth';
import { evaluateResourcePolicy } from './resource-policy-evaluator';
import type {
  ResourceAction,
  ResourceDataConstraint,
  ResourcePolicyAuthConfig,
  ResourcePolicyDecision,
} from './resource-policy-types';
import { matchesResourceDataConstraints } from './resource-constraint-matcher';
import type { RegisteredResourceDefinition, ResourceRegistry } from './resource-registry';
import {
  isResourceTenantRowScope,
  rejectResourceRealmUpdate,
  resolveResourceRealm,
  resourceRealmConstraint,
  resourceRowMatchesRealm,
  stampResourceCreateRealm,
} from './resource-realm';

/** Configuration required to evaluate resource policy inside sync. */
export interface ResourceSyncPolicyServiceOptions {
  registry: ResourceRegistry;
  authConfig: ResourcePolicyAuthConfig;
  getUserStore?: () => UserStore | null;
  /** App-local authorization kernel used by authorizationPolicy(). */
  getAuthorizationKernel?: () => AuthorizationKernel | null;
  /** Live advanced role assignments used by authorizationPolicy(). */
  getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
  /** Resolved tenancy capability. Multi mode fails closed for managed app tables. */
  tenancyMode?: AuthTenancyMode;
  /** App-owned table names; framework-owned tables are composed by their adapter. */
  managedTables?: ReadonlySet<string>;
}

type ResourceSyncReadDecision =
  | { ok: true; filter?: SyncRowFilter; fingerprint: string }
  | { ok: false; reason: string; code?: string };

type ResourceSyncDenyDecision = { ok: false; reason: string; code?: string };

interface ResourceSyncPolicyAuthority {
  readonly user: ReturnType<typeof createResourcePolicyUser>;
  readonly authorization: ReturnType<typeof createResourcePolicyAuthorization>;
  readonly fingerprint: string;
}

/**
 * Resource-policy adapter used by the sync WebSocket layer.
 *
 * Row-constrained `list` policies become per-connection row filters. The sync
 * transport applies those filters to snapshots, catchup, and live changes.
 */
export class ResourceSyncPolicyService implements SyncResourcePolicyAdapter {
  constructor(private readonly options: ResourceSyncPolicyServiceOptions) {}

  /** Prove the immutable realm used by multi-tenant Sync startup. */
  classifyManagedTableRealm(table: string): 'global' | 'tenant' | null {
    return this.options.registry.getByTable(table)?.realm?.kind ?? null;
  }

  /** Prove the immutable client-exposure classification used by Sync startup. */
  classifyManagedTableExposure(
    table: string,
  ): 'internal' | 'http' | 'sync' | 'all' | null {
    return this.options.registry.getByTable(table)?.exposure.kind ?? null;
  }

  /** Route registered app tables onto the startup-validated Sync data plane. */
  classifyManagedTableDataPlane(table: string): 'default' | 'tenant' | null {
    const resource = this.options.registry.getByTable(table);
    if (!resource) return null;
    return resource.storage.kind === 'tenant'
      && resource.storage.isolation === 'tenant-database'
      ? 'tenant'
      : 'default';
  }

  /** Resolve readable tables and row filters for already sync-policy-readable tables. */
  async resolveTableAccess(
    context: SyncResourceTableAccessContext
  ): Promise<SyncResourceTableAccess> {
    const readable = new Set<string>();
    const rowFilters = new Map<string, SyncRowFilter>();
    const rowProjectors = new Map<string, SyncRowProjector>();
    const fingerprints: Array<[string, string]> = [];
    // One immutable authority snapshot owns the complete table decision. A
    // separate capture per table could combine policies from two revisions.
    const readAuthority = this.captureMutationAuthority(context.authContext);

    for (const table of context.tableNames) {
      const decision = await this.evaluateSyncRead(
        table,
        context.authContext,
        readAuthority,
      );
      if (!decision.ok) continue;
      readable.add(table);
      if (decision.filter) rowFilters.set(table, decision.filter);
      const fields = this.options.registry.getByTable(table)?.fields;
      if (fields) {
        rowProjectors.set(table, {
          project: (row) => projectResourceRow(row, fields),
        });
      }
      fingerprints.push([table, decision.fingerprint]);
    }

    fingerprints.sort(([left], [right]) => left.localeCompare(right));
    return {
      readableTables: readable,
      rowFilters,
      rowProjectors,
      policyFingerprint: JSON.stringify(fingerprints),
      readAuthorityFingerprint: readAuthority.fingerprint,
    };
  }

  /** Authorize and optionally stamp one direct sync mutation. */
  async authorizeMutation(
    context: SyncResourceMutationContext
  ): Promise<SyncResourceMutationDecision> {
    const resource = this.options.registry.getByTable(context.table);
    if (!resource) {
      if (this.isUnclassifiedManagedTable(context.table)) {
        return {
          ok: false,
          reason: `Managed table '${context.table}' has no data realm`,
          code: 'resource-realm-unclassified',
        };
      }
      return { ok: true };
    }

    if (!resource.exposure.sync) {
      return {
        ok: false,
        reason: `Resource '${resource.name}' is not exposed over Sync`,
        code: 'resource-sync-not-exposed',
      };
    }

    const mutationAuthority = this.captureMutationAuthority(
      context.authContext,
    );

    const realm = resolveResourceRealm(resource, context.authContext);
    if (!realm.ok) {
      return { ok: false, reason: realm.message, code: realm.code };
    }

    const action = syncOpToResourceAction(context.op);
    if (!this.supportsAction(resource, action)) {
      return {
        ok: false,
        reason: `Resource '${resource.name}' does not support ${action}`,
        code: 'resource-action-not-allowed',
      };
    }

    if (action === 'create') {
      const input = normalizeMutationInput(context.row);
      if (!input) {
        return { ok: false, reason: 'INSERT requires a row', code: 'resource-input-invalid' };
      }

      const fieldWrite = validateResourceClientWriteFields(
        input,
        resource.fields,
        'create',
        resource.table,
        [resource.primaryKey],
      );
      if (fieldWrite) {
        return { ok: false, reason: fieldWrite.error, code: fieldWrite.code };
      }

      const realmInput = stampResourceCreateRealm(input, realm.scope);
      if (!realmInput.ok) {
        return { ok: false, reason: realmInput.message, code: realmInput.code };
      }

      const decision = await this.evaluatePolicy(
        resource,
        action,
        context.authContext,
        { input: realmInput.input },
        mutationAuthority,
      );
      if (!decision.allowed) return policyDenied(decision);

      const finalInput = stampResourceCreateRealm(
        mergeStampedInput(realmInput.input, decision.stampedInput),
        realm.scope,
      );
      if (!finalInput.ok) {
        return { ok: false, reason: finalInput.message, code: finalInput.code };
      }

      return {
        ok: true,
        row: finalInput.input,
        createOnly: true,
        authorityFingerprint: mutationAuthority.fingerprint,
        scope: isResourceTenantRowScope(realm.scope)
          ? { field: realm.scope.field, value: realm.scope.tenantId }
          : undefined,
      };
    }

    if (!context.rowId) {
      return {
        ok: false,
        reason: `${context.op} requires rowId`,
        code: 'resource-row-id-required',
      };
    }

    const row = await context.loadRow(context.table, context.rowId);
    if (!row || !resourceRowMatchesRealm(row, realm.scope)) {
      return {
        ok: false,
        reason: `Row not found: ${context.rowId}`,
        code: 'resource-row-not-found',
      };
    }

    const input = action === 'update' ? normalizeMutationInput(context.row) : undefined;
    if (action === 'update' && !input) {
      return { ok: false, reason: 'UPDATE requires row (partial)', code: 'resource-input-invalid' };
    }
    if (input) {
      const fieldWrite = validateResourceClientWriteFields(
        input,
        resource.fields,
        'update',
        resource.table,
      );
      if (fieldWrite) {
        return { ok: false, reason: fieldWrite.error, code: fieldWrite.code };
      }
      const realmUpdate = rejectResourceRealmUpdate(input, realm.scope);
      if (!realmUpdate.ok) {
        return { ok: false, reason: realmUpdate.message, code: realmUpdate.code };
      }
    }

    const decision = await this.evaluatePolicy(
      resource,
      action,
      context.authContext,
      { row, input: input ?? undefined },
      mutationAuthority,
    );
    if (!decision.allowed) return policyDenied(decision);

    if (action === 'update' && input) {
      const nextInput = mergeStampedInput(input, decision.stampedInput);
      const realmUpdate = rejectResourceRealmUpdate(nextInput, realm.scope);
      if (!realmUpdate.ok) {
        return { ok: false, reason: realmUpdate.message, code: realmUpdate.code };
      }
      return {
        ok: true,
        row: nextInput,
        expectedRow: row,
        authorityFingerprint: mutationAuthority.fingerprint,
        scope: isResourceTenantRowScope(realm.scope)
          ? { field: realm.scope.field, value: realm.scope.tenantId }
          : undefined,
      };
    }

    return {
      ok: true,
      expectedRow: row,
      authorityFingerprint: mutationAuthority.fingerprint,
      scope: isResourceTenantRowScope(realm.scope)
        ? { field: realm.scope.field, value: realm.scope.tenantId }
        : undefined,
    };
  }

  /** Re-read identity and trusted properties at the synchronous commit edge. */
  validateMutationAuthorityAtCommit(
    authContext: SyncAuthContext | null,
    expectedFingerprint: string,
  ): boolean {
    return this.mutationAuthorityFingerprint(authContext) === expectedFingerprint;
  }

  /** Re-read the same trusted user/property/RBAC snapshot used by list policy. */
  validateReadAuthorityAtDelivery(
    authContext: SyncAuthContext | null,
    expectedFingerprint: string,
  ): boolean {
    return this.mutationAuthorityFingerprint(authContext) === expectedFingerprint;
  }

  private async evaluateSyncRead(
    table: string,
    authContext: SyncAuthContext | null,
    policyAuthority: ResourceSyncPolicyAuthority,
  ): Promise<ResourceSyncReadDecision> {
    const resource = this.options.registry.getByTable(table);
    if (!resource) {
      if (this.isUnclassifiedManagedTable(table)) {
        return {
          ok: false,
          reason: `Managed table '${table}' has no data realm`,
          code: 'resource-realm-unclassified',
        };
      }
      return { ok: true, fingerprint: 'unmanaged' };
    }

    if (!resource.exposure.sync) {
      return {
        ok: false,
        reason: `Resource '${resource.name}' is not exposed over Sync`,
        code: 'resource-sync-not-exposed',
      };
    }

    const realm = resolveResourceRealm(resource, authContext);
    if (!realm.ok) {
      return { ok: false, reason: realm.message, code: realm.code };
    }

    if (!this.supportsAction(resource, 'list')) {
      return {
        ok: false,
        reason: `Resource '${resource.name}' does not allow WebSocket sync reads`,
        code: 'resource-list-not-allowed',
      };
    }

    const decision = await this.evaluatePolicy(
      resource,
      'list',
      authContext,
      {},
      policyAuthority,
    );
    if (!decision.allowed) return policyDenied(decision);

    const constraints = [
      ...resourceRealmConstraint(realm.scope),
      ...(decision.constraints ?? []),
    ];
    const realmFingerprint = realm.scope?.fingerprint ?? resource.realm?.kind ?? 'legacy';
    const fieldFingerprint = resource.fields
      ? [
          resource.fields.read,
          resource.fields.create,
          resource.fields.update,
          resource.fields.filter,
          resource.fields.sort,
        ]
      : 'legacy-all-fields';
    if (constraints.length > 0) {
      return {
        ok: true,
        filter: createConstraintRowFilter(constraints),
        fingerprint: JSON.stringify([
          realmFingerprint,
          constraints,
          fieldFingerprint,
          policyAuthority.fingerprint,
        ]),
      };
    }

    return {
      ok: true,
      fingerprint: JSON.stringify([
        realmFingerprint,
        'unfiltered',
        fieldFingerprint,
        policyAuthority.fingerprint,
      ]),
    };
  }

  private evaluatePolicy(
    resource: RegisteredResourceDefinition,
    action: ResourceAction,
    authContext: SyncAuthContext | null,
    options: {
      row?: Row;
      input?: Record<string, unknown>;
    } = {},
    policyAuthority = this.captureMutationAuthority(authContext),
  ): Promise<ResourcePolicyDecision> {
    return evaluateResourcePolicy(resource.policy[action]!, {
      action,
      user: policyAuthority.user,
      authorization: policyAuthority.authorization,
      resource,
      row: options.row,
      input: options.input,
      authConfig: this.options.authConfig,
    });
  }

  private mutationAuthorityFingerprint(
    authContext: SyncAuthContext | null,
  ): string {
    return this.captureMutationAuthority(authContext).fingerprint;
  }

  private captureMutationAuthority(
    authContext: SyncAuthContext | null,
  ): ResourceSyncPolicyAuthority {
    const user = createResourcePolicyUser(
      authContext,
      this.options.getUserStore?.() ?? null,
    );
    const authorization = createResourcePolicyAuthorization(
      authContext,
      user,
      this.options.getAuthorizationKernel?.() ?? null,
      this.options.getRoleAssignments?.() ?? null,
    );
    return {
      user,
      authorization,
      fingerprint: JSON.stringify([
        authContextAuthorityFingerprint(authContext, user?.properties ?? {}),
        user ? [user.userId, user.email ?? null, user.role] : null,
        authorization?.subject?.authorization ? [
          authorization.subject.authorization.scopeKind,
          authorization.subject.authorization.scopeId,
          authorization.subject.authorization.roles,
          authorization.subject.authorization.permissions,
          authorization.subject.authorization.allPermissions ?? false,
          authorization.subject.authorization.revision,
        ] : null,
      ]),
    };
  }

  private supportsAction(
    resource: RegisteredResourceDefinition,
    action: ResourceAction
  ): boolean {
    return resource.actions.includes(action) && Boolean(resource.policy[action]);
  }

  private isUnclassifiedManagedTable(table: string): boolean {
    return this.options.tenancyMode === 'multi'
      && (this.options.managedTables?.has(table) ?? true);
  }
}

function syncOpToResourceAction(op: ChangeOp): ResourceAction {
  if (op === 'INSERT') return 'create';
  if (op === 'UPDATE') return 'update';
  return 'delete';
}

function normalizeMutationInput(row: Row | Partial<Row> | undefined): Record<string, unknown> | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return row as Record<string, unknown>;
}

function mergeStampedInput(
  input: Record<string, unknown>,
  stampedInput: Record<string, unknown> | undefined
): Record<string, unknown> {
  return stampedInput ? { ...input, ...stampedInput } : input;
}

function policyDenied(decision: ResourcePolicyDecision): ResourceSyncDenyDecision {
  return {
    ok: false,
    reason: decision.message ?? 'Forbidden',
    code: decision.reason,
  };
}

function createConstraintRowFilter(constraints: readonly ResourceDataConstraint[]): SyncRowFilter {
  return {
    matches(row) {
      return matchesResourceDataConstraints(row, constraints);
    },
  };
}
