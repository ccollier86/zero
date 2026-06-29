/**
 * resource-registry.ts
 *
 * Owns process-wide resource registration and validation. This file validates
 * definitions against table schemas and auth metadata config; it does not load
 * modules, generate CRUD routes, or enforce /api/data or sync policy.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { TableSchema } from '../sync/types';
import type { ResourceDefinition } from './resource-definition';
import type {
  ResourcePolicyAuthConfig,
  ResourcePolicyValidationIssue,
} from './resource-policy-types';
import { validateResourcePolicy } from './resource-policy-validation';
import { inferTablePrimaryKey } from './resource-schema';

/** Registered resource with primary key resolved against the app table schema. */
export interface RegisteredResourceDefinition extends Omit<ResourceDefinition, 'primaryKey'> {
  readonly primaryKey: string;
}

/** Resource validation issue codes for registration-time checks. */
export type ResourceRegistryIssueCode =
  | 'resource-duplicate-name'
  | 'resource-duplicate-table'
  | 'resource-table-missing'
  | 'resource-primary-key-missing'
  | 'resource-primary-key-mismatch'
  | 'resource-policy-missing'
  | ResourcePolicyValidationIssue['code'];

/** Structured registration-time resource validation issue. */
export interface ResourceRegistryIssue {
  code: ResourceRegistryIssueCode;
  message: string;
  resource?: string;
  table?: string;
  action?: string;
  path?: string;
  severity: 'error';
  metadata?: Record<string, unknown>;
}

/** Inputs required to validate resources before registration. */
export interface ResourceRegistryValidationContext {
  tables: Record<string, TableSchema>;
  authConfig: ResourcePolicyAuthConfig;
}

/** Options used to create or replace the process resource registry. */
export interface ConfigureResourceRegistryOptions extends ResourceRegistryValidationContext {
  resources?: readonly ResourceDefinition[];
}

/** Error thrown when resource registration finds invalid definitions. */
export class ResourceRegistryError extends Error {
  constructor(message: string, readonly issues: ResourceRegistryIssue[]) {
    super(message);
    this.name = 'ResourceRegistryError';
  }
}

/** In-memory registry for app resource definitions. */
export class ResourceRegistry {
  private readonly resourcesByName = new Map<string, RegisteredResourceDefinition>();
  private readonly resourcesByTable = new Map<string, RegisteredResourceDefinition>();

  /** Register one or more resource definitions after validating them. */
  register(
    resources: readonly ResourceDefinition[] | ResourceDefinition,
    context: ResourceRegistryValidationContext
  ): void {
    const next = Array.isArray(resources) ? resources : [resources];
    const issues = validateResourceDefinitions(next, context, this);
    if (issues.length > 0) {
      throw new ResourceRegistryError('[resources] Resource registration failed.', issues);
    }

    for (const resource of next) {
      const primaryKey = resource.primaryKey ?? inferTablePrimaryKey(context.tables[resource.table]);
      if (!primaryKey) continue;

      const registered: RegisteredResourceDefinition = {
        ...resource,
        primaryKey,
      };
      this.resourcesByName.set(registered.name, registered);
      this.resourcesByTable.set(registered.table, registered);
    }
  }

  /** Return all registered resources in registration order. */
  list(): RegisteredResourceDefinition[] {
    return [...this.resourcesByName.values()];
  }

  /** Return a resource by stable name. */
  get(name: string): RegisteredResourceDefinition | null {
    return this.resourcesByName.get(name) ?? null;
  }

  /** Return a resource by backing table name. */
  getByTable(table: string): RegisteredResourceDefinition | null {
    return this.resourcesByTable.get(table) ?? null;
  }

  /** Return true when a resource for the table is registered. */
  hasTable(table: string): boolean {
    return this.resourcesByTable.has(table);
  }
}

let activeResourceRegistry = new ResourceRegistry();

/** Replace the process-wide resource registry with validated definitions. */
export function configureResourceRegistry(options: ConfigureResourceRegistryOptions): ResourceRegistry {
  const registry = new ResourceRegistry();
  registry.register(options.resources ?? [], {
    tables: options.tables,
    authConfig: options.authConfig,
  });
  activeResourceRegistry = registry;

  emitPlatformCode(OBS_CODES.RESOURCE_REGISTRY_READY, {
    metadata: {
      resources: registry.list().length,
      tables: registry.list().map((resource) => resource.table),
    },
  });

  return registry;
}

/** Return the active process resource registry. */
export function getResourceRegistry(): ResourceRegistry {
  return activeResourceRegistry;
}

/** Validate resource definitions without mutating a registry. */
export function validateResourceDefinitions(
  resources: readonly ResourceDefinition[],
  context: ResourceRegistryValidationContext,
  existingRegistry?: ResourceRegistry
): ResourceRegistryIssue[] {
  const issues: ResourceRegistryIssue[] = [];
  const seenNames = new Set<string>();
  const seenTables = new Set<string>();

  for (const resource of resources) {
    if (seenNames.has(resource.name) || existingRegistry?.get(resource.name)) {
      issues.push(issue('resource-duplicate-name', `Resource name "${resource.name}" is already registered.`, resource));
    }
    if (seenTables.has(resource.table) || existingRegistry?.getByTable(resource.table)) {
      issues.push(issue('resource-duplicate-table', `Resource table "${resource.table}" is already registered.`, resource));
    }
    seenNames.add(resource.name);
    seenTables.add(resource.table);

    const schema = context.tables[resource.table];
    const inferredPrimaryKey = inferTablePrimaryKey(schema);
    const primaryKey = resource.primaryKey ?? inferredPrimaryKey;

    if (!schema) {
      issues.push(issue('resource-table-missing', `Resource table "${resource.table}" is not defined in createApp tables.`, resource));
    } else if (!inferredPrimaryKey) {
      issues.push(issue('resource-primary-key-missing', `Resource table "${resource.table}" has no primary key column.`, resource));
    } else if (resource.primaryKey && resource.primaryKey !== inferredPrimaryKey) {
      issues.push(issue('resource-primary-key-mismatch', `Resource primaryKey "${resource.primaryKey}" does not match table primary key "${inferredPrimaryKey}".`, resource, {
        expected: inferredPrimaryKey,
        actual: resource.primaryKey,
      }));
    } else if (!primaryKey) {
      issues.push(issue('resource-primary-key-missing', `Resource "${resource.name}" could not resolve a primary key.`, resource));
    }

    for (const action of resource.actions) {
      const policy = resource.policy[action];
      if (!policy) {
        issues.push(issue('resource-policy-missing', `Resource "${resource.name}" is missing policy for action "${action}".`, resource, undefined, action));
        continue;
      }

      const policyIssues = validateResourcePolicy(policy, { authConfig: context.authConfig });
      for (const policyIssue of policyIssues) {
        issues.push({
          code: policyIssue.code,
          message: policyIssue.message,
          resource: resource.name,
          table: resource.table,
          action,
          path: policyIssue.path ? `policy.${action}.${policyIssue.path}` : `policy.${action}`,
          severity: 'error',
          metadata: policyIssue.metadata,
        });
      }
    }
  }

  return issues;
}

function issue(
  code: ResourceRegistryIssueCode,
  message: string,
  resource: ResourceDefinition,
  metadata?: Record<string, unknown>,
  action?: string
): ResourceRegistryIssue {
  return {
    code,
    message,
    resource: resource.name,
    table: resource.table,
    action,
    path: action ? `policy.${action}` : undefined,
    severity: 'error',
    metadata,
  };
}
