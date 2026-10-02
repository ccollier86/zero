/**
 * Sync authorization for framework-owned workflow records.
 *
 * Definitions describe server code and never cross the Sync transport. Runtime
 * records are visible only to the identity that started the workflow, except
 * for the stable single-tenant platform administrator role.
 */

import { createHash } from 'node:crypto';
import type { ReactiveDB } from '../sync/reactive-db';
import type {
  Row,
  SyncResourceMutationContext,
  SyncResourceMutationDecision,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccess,
  SyncResourceTableAccessContext,
  SyncRowFilter,
  SyncRowProjector,
} from '../sync/types';
import { WORKFLOW_SERVER_TABLE_NAMES } from './types';
import {
  toPublicWorkflowEvent,
  toPublicWorkflowInstance,
  toPublicWorkflowInteraction,
  toPublicWorkflowStep,
} from './workflow-public-record';

const WORKFLOW_RUNTIME_TABLES = new Set([
  'workflow_instances',
  'workflow_steps',
  'workflow_events',
  'workflow_interactions',
]);

const WORKFLOW_PRIVATE_TABLES = new Set(
  [...WORKFLOW_SERVER_TABLE_NAMES].filter((table) => !WORKFLOW_RUNTIME_TABLES.has(table)),
);

const WORKFLOW_READ_AUTHORITY_VERSION = 'zero-workflow-read-v1';

export interface WorkflowSyncPolicyOptions {
  /** Resolve the current app-local ReactiveDB after Sync composition. */
  getDB: () => ReactiveDB | null;
  /** Existing app resource adapter. Its decisions remain authoritative. */
  delegate?: SyncResourcePolicyAdapter;
  /**
   * Resolve live Guardian management authority for this exact Sync scope.
   * Required to grant peer-row access from advanced RBAC assignments; the
   * compatibility tenantRole field is intentionally ignored in that mode. A
   * synchronous result is required for delivery-time comparability. An async
   * result may resolve connection policy, but fails the live read fence closed.
   */
  resolveManagementAccess?: (
    context: SyncResourceTableAccessContext,
  ) => WorkflowSyncManagementDecision | Promise<WorkflowSyncManagementDecision>;
}

export interface WorkflowSyncManagementDecision {
  manageAll: boolean;
  /** Stable live-authority revision included in the Sync policy fingerprint. */
  authorityFingerprint?: string;
}

interface WorkflowSyncScopeResolution {
  scope: WorkflowSyncScope | null;
  comparable: boolean;
}

interface WorkflowReadAuthority {
  delegate: string | null;
  workflow: string;
  tableNames: string[];
}

/**
 * Compose workflow row ownership with an existing resource Sync adapter.
 *
 * The adapter is deliberately deny-wins: a delegate-denied table stays denied,
 * and an existing row predicate is ANDed with workflow ownership.
 */
export function createWorkflowSyncPolicyAdapter(
  options: WorkflowSyncPolicyOptions,
): SyncResourcePolicyAdapter {
  return {
    async resolveTableAccess(
      context: SyncResourceTableAccessContext,
    ): Promise<SyncResourceTableAccess> {
      const delegated = options.delegate
        ? await options.delegate.resolveTableAccess(context)
        : unrestrictedAccess(context.tableNames);
      const readableTables = new Set(delegated.readableTables);
      const rowFilters = new Map(delegated.rowFilters);
      const rowProjectors = new Map(delegated.rowProjectors ?? []);
      const workflowAuthority = await workflowSyncScope(
        context,
        options.resolveManagementAccess,
      );
      const workflowScope = workflowAuthority.scope;

      // Definitions, topology, memory, policies, and response payloads are
      // execution internals. Only the explicit runtime projection may Sync.
      for (const table of WORKFLOW_PRIVATE_TABLES) {
        readableTables.delete(table);
        rowFilters.delete(table);
        rowProjectors.delete(table);
      }

      for (const table of WORKFLOW_RUNTIME_TABLES) {
        if (!readableTables.has(table)) continue;
        const ownership = createOwnershipFilter(
          table,
          context,
          options.getDB,
          workflowScope,
        );
        const delegatedFilter = rowFilters.get(table);
        rowFilters.set(table, andFilters(delegatedFilter, {
          matches: ownership.matches,
        }));
        const projector = composeProjectors(
          ownership.project ? { project: ownership.project } : undefined,
          delegatedFilter?.project ? { project: delegatedFilter.project } : undefined,
          rowProjectors.get(table),
        );
        if (projector) rowProjectors.set(table, projector);
      }

      const delegateReadAuthority = delegated.readAuthorityFingerprint;
      const delegateComparable = options.delegate === undefined
        || (typeof delegateReadAuthority === 'string'
          && typeof options.delegate.validateReadAuthorityAtDelivery === 'function');
      const readAuthorityFingerprint = workflowAuthority.comparable && delegateComparable
        ? encodeWorkflowReadAuthority({
            delegate: options.delegate ? delegateReadAuthority! : null,
            workflow: workflowFingerprint(context, workflowScope),
            tableNames: [...context.tableNames],
          })
        : undefined;

      return {
        readableTables,
        rowFilters,
        rowProjectors,
        ...(readAuthorityFingerprint === undefined ? {} : { readAuthorityFingerprint }),
        policyFingerprint: delegated.policyFingerprint === undefined
          && (delegated.rowFilters.size > 0
            || (delegated.rowProjectors?.size ?? 0) > 0)
          ? undefined
          : JSON.stringify({
              delegate: delegated.policyFingerprint ?? null,
              workflows: workflowFingerprint(context, workflowScope),
            }),
      };
    },

    async authorizeMutation(
      context: SyncResourceMutationContext,
    ): Promise<SyncResourceMutationDecision> {
      if (WORKFLOW_SERVER_TABLE_NAMES.has(context.table)) {
        return {
          ok: false,
          reason: `Table is read-only over sync: ${context.table}`,
          code: 'workflow-sync-read-only',
        };
      }
      return options.delegate?.authorizeMutation(context) ?? { ok: true };
    },

    validateMutationAuthorityAtCommit(authContext, expectedFingerprint): boolean {
      return options.delegate?.validateMutationAuthorityAtCommit?.(
        authContext,
        expectedFingerprint,
      ) === true;
    },

    validateReadAuthorityAtDelivery(authContext, expectedFingerprint): boolean {
      try {
        const expected = decodeWorkflowReadAuthority(expectedFingerprint);
        if (!expected) return false;
        const context: SyncResourceTableAccessContext = {
          tableNames: expected.tableNames,
          authContext,
        };
        const current = workflowSyncScopeSynchronously(
          context,
          options.resolveManagementAccess,
        );
        if (!current.comparable
          || workflowFingerprint(context, current.scope) !== expected.workflow) return false;

        if (!options.delegate) return expected.delegate === null;
        if (expected.delegate === null) return false;
        return options.delegate.validateReadAuthorityAtDelivery?.(
          authContext,
          expected.delegate,
        ) === true;
      } catch {
        return false;
      }
    },
  };
}

function unrestrictedAccess(
  tableNames: Iterable<string>,
): SyncResourceTableAccess {
  return {
    readableTables: new Set(tableNames),
    rowFilters: new Map(),
    rowProjectors: new Map(),
    policyFingerprint: 'unrestricted',
  };
}

function createOwnershipFilter(
  table: string,
  context: SyncResourceTableAccessContext,
  getDB: () => ReactiveDB | null,
  scope: WorkflowSyncScope | null,
): SyncRowFilter {
  const auth = context.authContext;
  const project = table === 'workflow_instances'
    ? (row: Row): Row => toPublicWorkflowInstance(row)
    : table === 'workflow_steps'
      ? (row: Row): Row => {
          const instanceId = workflowInstanceId(row);
          const instance = instanceId
            ? getDB()?.queryOne('workflow_instances', instanceId)
            : null;
          return toPublicWorkflowStep(
            row,
            instance?.steps_json,
            instance,
          );
        }
      : table === 'workflow_events'
        ? (row: Row): Row => {
          const instanceId = workflowInstanceId(row);
          const instance = instanceId
            ? getDB()?.queryOne('workflow_instances', instanceId)
            : null;
          return toPublicWorkflowEvent(row, instance);
        }
        : table === 'workflow_interactions'
          ? (row: Row): Row => toPublicWorkflowInteraction(row)
          : undefined;
  if (!auth || !scope) return { matches: () => false, project };

  if (table === 'workflow_instances') {
    return {
      matches(row) {
        return rowMatchesScope(row, scope)
          && (scope.manageAll || row.started_by === auth.userId);
      },
      project,
    };
  }

  return {
    matches(row) {
      const instanceId = workflowInstanceId(row);
      if (!instanceId) return false;
      const instance = getDB()?.queryOne('workflow_instances', instanceId);
      if (!instance || !rowMatchesScope(instance, scope)
        || !rowMatchesParentTenant(row, instance)) return false;
      return scope.manageAll || instance.started_by === auth.userId;
    },
    project,
  };
}

function workflowInstanceId(row: Row): string | null {
  return typeof row.instance_id === 'string' && row.instance_id.length > 0
    ? row.instance_id
    : null;
}

function andFilters(
  left: SyncRowFilter | undefined,
  right: SyncRowFilter,
): SyncRowFilter {
  if (!left) return right;
  return {
    matches(row) {
      return left.matches(row) && right.matches(row);
    },
  };
}

function composeProjectors(
  ...projectors: Array<SyncRowProjector | undefined>
): SyncRowProjector | undefined {
  const active = projectors.filter(
    (projector): projector is SyncRowProjector => projector !== undefined,
  );
  if (active.length === 0) return undefined;
  return {
    project(row) {
      return active.reduce((current, projector) => projector.project(current), row);
    },
  };
}

function workflowFingerprint(
  context: SyncResourceTableAccessContext,
  scope: WorkflowSyncScope | null,
): string {
  const auth = context.authContext;
  if (!auth) return 'topology-v3:anonymous:none';
  if (!scope) return `topology-v4:invalid:${auth.userId}`;
  return JSON.stringify({
    version: 'topology-v5',
    scopeKind: scope.kind,
    tenantId: scope.tenantId,
    audience: scope.manageAll ? 'manager' : 'owner',
    userId: scope.manageAll ? null : auth.userId,
    managementAuthority: scope.managementAuthority,
    authGeneration: auth.authGeneration ?? null,
    sessionGeneration: auth.sessionGeneration ?? null,
    tenantAuthorizationGeneration: auth.tenantAuthorizationGeneration ?? null,
    membershipAuthorizationGeneration: auth.membershipAuthorizationGeneration ?? null,
    authorizationAssignmentRevision: auth.authorizationAssignmentRevision ?? null,
  });
}

interface WorkflowSyncScope {
  kind: 'application' | 'tenant';
  tenantId: string | null;
  manageAll: boolean;
  managementAuthority: string;
}

/** Resolve only coherent, server-validated session scope snapshots. */
async function workflowSyncScope(
  context: SyncResourceTableAccessContext,
  resolveManagementAccess:
    | WorkflowSyncPolicyOptions['resolveManagementAccess']
    | undefined,
): Promise<WorkflowSyncScopeResolution> {
  const base = workflowSyncScopeBase(context);
  if (!base) return { scope: null, comparable: true };
  if (!resolveManagementAccess) {
    return { scope: compatibilityWorkflowScope(base), comparable: true };
  }
  const result = resolveManagementAccess(context);
  const comparable = !isPromiseLike(result);
  return {
    scope: resolvedWorkflowScope(base, await result),
    comparable,
  };
}

function workflowSyncScopeSynchronously(
  context: SyncResourceTableAccessContext,
  resolveManagementAccess:
    | WorkflowSyncPolicyOptions['resolveManagementAccess']
    | undefined,
): WorkflowSyncScopeResolution {
  const base = workflowSyncScopeBase(context);
  if (!base) return { scope: null, comparable: true };
  if (!resolveManagementAccess) {
    return { scope: compatibilityWorkflowScope(base), comparable: true };
  }
  const result = resolveManagementAccess(context);
  if (isPromiseLike(result)) {
    // Delivery validation is deliberately synchronous. Consume a later
    // rejection so an invalid async resolver cannot also create an unrelated
    // unhandled-rejection failure after the socket is failed closed.
    void Promise.resolve(result).catch(() => undefined);
    return { scope: null, comparable: false };
  }
  return { scope: resolvedWorkflowScope(base, result), comparable: true };
}

interface WorkflowSyncScopeBase {
  kind: 'application' | 'tenant';
  tenantId: string | null;
  compatibilityManageAll: boolean;
}

function workflowSyncScopeBase(
  context: SyncResourceTableAccessContext,
): WorkflowSyncScopeBase | null {
  const auth = context.authContext;
  if (!auth) return null;
  let base: Omit<WorkflowSyncScopeBase, 'compatibilityManageAll'>;
  let compatibilityManageAll = false;
  if (auth.sessionScopeKind === undefined) {
    // Preserve the standalone single-tenant verifier contract only when no
    // partial tenant/session-scope authority has leaked into the context.
    if (auth.sessionScopeId !== undefined || auth.tenantId !== undefined
      || auth.membershipId !== undefined || auth.tenantRole !== undefined) return null;
    base = { kind: 'application', tenantId: null };
    compatibilityManageAll = auth.role === 'admin';
  } else if (auth.sessionScopeKind === 'application') {
    if (auth.sessionScopeId !== 'application' || auth.tenantId !== undefined
      || auth.membershipId !== undefined || auth.tenantRole !== undefined) return null;
    base = { kind: 'application', tenantId: null };
    compatibilityManageAll = auth.role === 'admin';
  } else {
    const tenantId = auth.tenantId?.trim();
    const membershipId = auth.membershipId?.trim();
    if (!tenantId || !membershipId || auth.sessionScopeId !== tenantId) return null;
    base = { kind: 'tenant', tenantId };
    // An assignment revision marks advanced RBAC. tenantRole is retained only
    // as compatibility metadata and cannot grant management in that mode.
    compatibilityManageAll = auth.authorizationAssignmentRevision === undefined
      && auth.tenantRole === 'owner';
  }

  return { ...base, compatibilityManageAll };
}

function compatibilityWorkflowScope(base: WorkflowSyncScopeBase): WorkflowSyncScope {
  return {
    kind: base.kind,
    tenantId: base.tenantId,
    manageAll: base.compatibilityManageAll,
    managementAuthority: base.compatibilityManageAll ? 'compatibility:manager' : 'owner-only',
  };
}

function resolvedWorkflowScope(
  base: WorkflowSyncScopeBase,
  resolved: WorkflowSyncManagementDecision,
): WorkflowSyncScope {
  const authorityFingerprint = typeof resolved?.authorityFingerprint === 'string'
    ? fingerprintText(resolved.authorityFingerprint)
    : 'resolver-result';
  return {
    kind: base.kind,
    tenantId: base.tenantId,
    manageAll: resolved?.manageAll === true,
    managementAuthority: `${authorityFingerprint}:${resolved?.manageAll === true ? 'manager' : 'owner-only'}`,
  };
}

function rowMatchesScope(row: Row, scope: WorkflowSyncScope): boolean {
  const tenantId = rowTenantId(row);
  return tenantId.valid && tenantId.value === scope.tenantId;
}

function rowMatchesParentTenant(row: Row, parent: Row): boolean {
  const childTenant = rowTenantId(row);
  const parentTenant = rowTenantId(parent);
  return childTenant.valid && parentTenant.valid
    && childTenant.value === parentTenant.value;
}

function rowTenantId(row: Row): { valid: boolean; value: string | null } {
  const value = row.tenant_id;
  if (value === null || value === undefined) return { valid: true, value: null };
  return typeof value === 'string' && value.length > 0
    ? { valid: true, value }
    : { valid: false, value: null };
}

function encodeWorkflowReadAuthority(value: WorkflowReadAuthority): string {
  return JSON.stringify([
    WORKFLOW_READ_AUTHORITY_VERSION,
    value.delegate,
    value.workflow,
    value.tableNames,
  ]);
}

function decodeWorkflowReadAuthority(value: string): WorkflowReadAuthority | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)
    || parsed.length !== 4
    || parsed[0] !== WORKFLOW_READ_AUTHORITY_VERSION
    || (parsed[1] !== null && typeof parsed[1] !== 'string')
    || typeof parsed[2] !== 'string'
    || !Array.isArray(parsed[3])
    || parsed[3].some((table) => typeof table !== 'string')) return null;
  return {
    delegate: parsed[1],
    workflow: parsed[2],
    tableNames: [...parsed[3]],
  };
}

function fingerprintText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return ((typeof value === 'object' && value !== null) || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}
