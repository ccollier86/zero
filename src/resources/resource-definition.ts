/**
 * resource-definition.ts
 *
 * Owns the app-authored resource definition contract for Zero resources. This
 * file validates definition shape only; it does not load modules, register
 * global state, generate routes, or evaluate policy decisions.
 */

import type { ResourceAction, ResourcePolicy } from './resource-policy-types';
import type { TableDefinition } from '../schema/define-schema';
import {
  normalizeResourceFieldAccess,
  type ResourceFieldAccess,
  type ResourceFieldAccessInput,
} from './resource-field-access';

export const ZERO_RESOURCE_DEFINITION_KIND = Symbol.for('zero.resource.definition.kind');

export const RESOURCE_ACTIONS = ['list', 'get', 'create', 'update', 'delete'] as const satisfies readonly ResourceAction[];
const VALID_RESOURCE_ACTIONS = new Set<ResourceAction>(RESOURCE_ACTIONS);

/** Policy map accepted by defineResource(). */
export type ResourcePolicyInput =
  | ResourcePolicy
  | Partial<Record<ResourceAction, ResourcePolicy>>;

/** A table accepted by defineResource(). Typed table objects stay server-adjacent. */
export type ResourceTableInput = string | TableDefinition<any, any>;

/** A deliberately shared table whose rows do not belong to one tenant. */
export interface GlobalResourceRealm {
  readonly kind: 'global';
}

/** A table whose every independently accessible row belongs to one tenant. */
export interface TenantResourceRealm {
  readonly kind: 'tenant';
  readonly field: string;
}

/** Mandatory row-isolation classification enforced outside resource policy. */
export type ResourceRealm = GlobalResourceRealm | TenantResourceRealm;

/** Ergonomic realm input accepted by defineResource(). */
export type ResourceRealmInput = 'global' | 'tenant' | ResourceRealm;

/**
 * Managed client transports that may expose a resource.
 *
 * This is intentionally independent from the table's `full`/`lazy` loading
 * mode. Loading mode controls how an authorized Sync table is hydrated;
 * exposure controls whether HTTP and/or Sync may reach it at all.
 */
export type ResourceExposure = 'internal' | 'http' | 'sync' | 'all';

export const RESOURCE_EXPOSURES = [
  'internal',
  'http',
  'sync',
  'all',
] as const satisfies readonly ResourceExposure[];

const VALID_RESOURCE_EXPOSURES = new Set<ResourceExposure>(RESOURCE_EXPOSURES);

/** Developer-authored resource definition options. */
export interface ResourceDefinitionOptions<
  TTable extends ResourceTableInput = ResourceTableInput,
> {
  /** Stable name for diagnostics and future generated route names. Defaults to table. */
  name?: string;
  /** Database table backing the resource. */
  table: TTable;
  /** Primary key column. Omit to infer from the registered table schema. */
  primaryKey?: string;
  /**
   * Immutable managed-client exposure classification.
   *
   * - `internal`: no generated CRUD, `/api/data`, or WebSocket Sync access
   * - `http`: generated CRUD and `/api/data` only
   * - `sync`: WebSocket Sync only
   * - `all`: HTTP and WebSocket Sync
   *
   * Omission preserves legacy `all` behavior in single-tenant mode. Multi-
   * tenant applications must classify every managed table explicitly.
   */
  exposure?: ResourceExposure;
  /**
   * Immutable data realm. Required for client-visible app tables in multi mode.
   * Omission remains compatible only with single-tenant applications.
   */
  realm?: ResourceRealmInput;
  /** Supported actions. Defaults to list/get/create/update/delete. */
  actions?: readonly ResourceAction[];
  /**
   * Opt-in, fail-closed field allow-lists for every managed client transport.
   * Omission preserves the legacy all-columns behavior. Once present, `read`
   * is required, writes default to none, and filter/sort default to `read`.
   */
  fields?: ResourceFieldAccessInput;
  /** Policy applied to all actions, or a per-action policy map. */
  policy: ResourcePolicyInput;
}

/** Normalized resource definition returned by defineResource(). */
export interface ResourceDefinition {
  readonly kind: 'resource';
  readonly [ZERO_RESOURCE_DEFINITION_KIND]: 'resource';
  readonly name: string;
  readonly table: string;
  readonly primaryKey?: string;
  /** Undefined only for legacy definitions normalized by a single-mode registry. */
  readonly exposure?: ResourceExposure;
  /** Undefined only for legacy definitions accepted in single-tenant mode. */
  readonly realm?: ResourceRealm;
  readonly actions: readonly ResourceAction[];
  readonly fields?: ResourceFieldAccess;
  readonly policy: Partial<Record<ResourceAction, ResourcePolicy>>;
}

/**
 * Define one app-owned resource while preserving a small, validated runtime
 * shape for registry and future CRUD generation.
 */
export function defineResource<TTable extends ResourceTableInput>(
  options: ResourceDefinitionOptions<TTable>,
): ResourceDefinition {
  const tableInput: ResourceTableInput = options.table;
  const typedTable = typeof tableInput === 'string' ? undefined : tableInput;
  const table = normalizeRequiredName(
    typeof tableInput === 'string' ? tableInput : tableInput.name,
    'table',
  );
  const name = normalizeRequiredName(options.name ?? table, 'name');
  const inferredPrimaryKey = typedTable?.schema.primaryKey;
  const primaryKey = options.primaryKey === undefined
    ? inferredPrimaryKey
    : normalizeRequiredName(options.primaryKey, 'primaryKey');
  if (
    inferredPrimaryKey !== undefined
    && options.primaryKey !== undefined
    && primaryKey !== inferredPrimaryKey
  ) {
    throw new Error(
      `[resources] Resource primaryKey "${primaryKey}" does not match typed table primary key "${inferredPrimaryKey}".`,
    );
  }
  const actions = normalizeActions(options.actions);

  return Object.freeze({
    kind: 'resource',
    [ZERO_RESOURCE_DEFINITION_KIND]: 'resource' as const,
    name,
    table,
    primaryKey,
    exposure: normalizeExposure(options.exposure),
    realm: normalizeRealm(options.realm),
    actions: Object.freeze([...actions]),
    fields: normalizeResourceFieldAccess(options.fields),
    policy: Object.freeze(normalizePolicy(actions, options.policy)),
  });
}

function normalizeExposure(
  exposure: ResourceExposure | undefined,
): ResourceExposure | undefined {
  if (exposure === undefined) return undefined;
  if (!VALID_RESOURCE_EXPOSURES.has(exposure)) {
    throw new Error(
      `[resources] Unknown resource exposure "${String(exposure)}". `
      + 'Expected "internal", "http", "sync", or "all".',
    );
  }
  return exposure;
}

/** Mark a resource as deliberately shared across tenants. */
export function globalRealm(): GlobalResourceRealm {
  return Object.freeze({ kind: 'global' });
}

/**
 * Mark a resource as tenant-owned. The default discriminator is `tenant_id`;
 * registry validation still requires that exact non-nullable column to exist.
 */
export function tenantRealm(
  options: { field?: string } = {},
): TenantResourceRealm {
  return Object.freeze({
    kind: 'tenant',
    field: normalizeRequiredName(options.field ?? 'tenant_id', 'realm tenant field'),
  });
}

/** Return true when a value is a Zero resource definition. */
export function isResourceDefinition(value: unknown): value is ResourceDefinition {
  if (!value || typeof value !== 'object') return false;
  return (value as Record<PropertyKey, unknown>)[ZERO_RESOURCE_DEFINITION_KIND] === 'resource';
}

/** Return true when a value looks like a resource policy primitive. */
export function isResourcePolicy(value: unknown): value is ResourcePolicy {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ResourcePolicy>;
  return typeof candidate.kind === 'string' && typeof candidate.evaluate === 'function';
}

function normalizeRequiredName(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`[resources] Resource ${label} must be a non-empty string.`);
  return normalized;
}

function normalizeActions(actions: readonly ResourceAction[] | undefined): readonly ResourceAction[] {
  if (actions === undefined) return RESOURCE_ACTIONS;

  const normalized: ResourceAction[] = [];
  const seen = new Set<ResourceAction>();
  for (const action of actions) {
    if (!VALID_RESOURCE_ACTIONS.has(action)) {
      throw new Error(`[resources] Unknown resource action "${String(action)}".`);
    }
    if (seen.has(action)) {
      throw new Error(`[resources] Duplicate resource action "${action}".`);
    }
    seen.add(action);
    normalized.push(action);
  }

  return normalized;
}

function normalizeRealm(realm: ResourceRealmInput | undefined): ResourceRealm | undefined {
  if (realm === undefined) return undefined;
  if (realm === 'global') return globalRealm();
  if (realm === 'tenant') return tenantRealm();
  if (!realm || typeof realm !== 'object') {
    throw new Error('[resources] Resource realm must be "global", "tenant", or a realm helper.');
  }
  if (realm.kind === 'global') return globalRealm();
  if (realm.kind === 'tenant') return tenantRealm({ field: realm.field });
  throw new Error(`[resources] Unknown resource realm "${String((realm as { kind?: unknown }).kind)}".`);
}

function normalizePolicy(
  actions: readonly ResourceAction[],
  policy: ResourcePolicyInput
): Partial<Record<ResourceAction, ResourcePolicy>> {
  if (isResourcePolicy(policy)) {
    const frozenPolicy = freezeResourcePolicy(policy);
    return Object.fromEntries(actions.map((action) => [action, frozenPolicy])) as Partial<Record<ResourceAction, ResourcePolicy>>;
  }

  if (!policy || typeof policy !== 'object') {
    throw new Error('[resources] Resource policy must be a resource policy or per-action policy map.');
  }

  const normalized: Partial<Record<ResourceAction, ResourcePolicy>> = {};
  for (const [action, value] of Object.entries(policy) as Array<[ResourceAction, unknown]>) {
    if (!VALID_RESOURCE_ACTIONS.has(action)) {
      throw new Error(`[resources] Unknown resource policy action "${String(action)}".`);
    }
    if (!actions.includes(action)) {
      throw new Error(
        `[resources] Resource policy action "${action}" is not listed in actions.`,
      );
    }
    if (value !== undefined) {
      if (!isResourcePolicy(value)) {
        throw new Error(`[resources] Resource policy for action "${action}" is not a valid resource policy.`);
      }
      normalized[action] = freezeResourcePolicy(value);
    }
  }

  return normalized;
}

function freezeResourcePolicy(
  policy: ResourcePolicy,
  seen: WeakSet<object> = new WeakSet(),
): ResourcePolicy {
  if (seen.has(policy)) return policy;
  seen.add(policy);

  const diagnostics = policy.diagnostics;
  if (diagnostics) {
    for (const child of diagnostics.children ?? []) {
      freezeResourcePolicy(child, seen);
    }
    if (diagnostics.children) Object.freeze(diagnostics.children);
    if (diagnostics.metadataKeys) Object.freeze(diagnostics.metadataKeys);
    if (diagnostics.publicActions) Object.freeze(diagnostics.publicActions);
    if (diagnostics.authenticatedActions) Object.freeze(diagnostics.authenticatedActions);
    Object.freeze(diagnostics);
  }
  return Object.freeze(policy);
}
