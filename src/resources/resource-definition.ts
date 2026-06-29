/**
 * resource-definition.ts
 *
 * Owns the app-authored resource definition contract for Zero resources. This
 * file validates definition shape only; it does not load modules, register
 * global state, generate routes, or evaluate policy decisions.
 */

import type { ResourceAction, ResourcePolicy } from './resource-policy-types';

export const ZERO_RESOURCE_DEFINITION_KIND = Symbol.for('zero.resource.definition.kind');

export const RESOURCE_ACTIONS = ['list', 'get', 'create', 'update', 'delete'] as const satisfies readonly ResourceAction[];
const VALID_RESOURCE_ACTIONS = new Set<ResourceAction>(RESOURCE_ACTIONS);

/** Policy map accepted by defineResource(). */
export type ResourcePolicyInput =
  | ResourcePolicy
  | Partial<Record<ResourceAction, ResourcePolicy>>;

/** Developer-authored resource definition options. */
export interface ResourceDefinitionOptions {
  /** Stable name for diagnostics and future generated route names. Defaults to table. */
  name?: string;
  /** Database table backing the resource. */
  table: string;
  /** Primary key column. Omit to infer from the registered table schema. */
  primaryKey?: string;
  /** Supported actions. Defaults to list/get/create/update/delete. */
  actions?: readonly ResourceAction[];
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
  readonly actions: readonly ResourceAction[];
  readonly policy: Partial<Record<ResourceAction, ResourcePolicy>>;
}

/**
 * Define one app-owned resource while preserving a small, validated runtime
 * shape for registry and future CRUD generation.
 */
export function defineResource(options: ResourceDefinitionOptions): ResourceDefinition {
  const table = normalizeRequiredName(options.table, 'table');
  const name = normalizeRequiredName(options.name ?? table, 'name');
  const primaryKey = options.primaryKey === undefined
    ? undefined
    : normalizeRequiredName(options.primaryKey, 'primaryKey');
  const actions = normalizeActions(options.actions);

  return {
    kind: 'resource',
    [ZERO_RESOURCE_DEFINITION_KIND]: 'resource',
    name,
    table,
    primaryKey,
    actions,
    policy: normalizePolicy(actions, options.policy),
  };
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
  if (!actions || actions.length === 0) return RESOURCE_ACTIONS;

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

function normalizePolicy(
  actions: readonly ResourceAction[],
  policy: ResourcePolicyInput
): Partial<Record<ResourceAction, ResourcePolicy>> {
  if (isResourcePolicy(policy)) {
    return Object.fromEntries(actions.map((action) => [action, policy])) as Partial<Record<ResourceAction, ResourcePolicy>>;
  }

  if (!policy || typeof policy !== 'object') {
    throw new Error('[resources] Resource policy must be a resource policy or per-action policy map.');
  }

  const normalized: Partial<Record<ResourceAction, ResourcePolicy>> = {};
  for (const [action, value] of Object.entries(policy) as Array<[ResourceAction, unknown]>) {
    if (!VALID_RESOURCE_ACTIONS.has(action)) {
      throw new Error(`[resources] Unknown resource policy action "${String(action)}".`);
    }
    if (value !== undefined) {
      if (!isResourcePolicy(value)) {
        throw new Error(`[resources] Resource policy for action "${action}" is not a valid resource policy.`);
      }
      normalized[action] = value;
    }
  }

  return normalized;
}
