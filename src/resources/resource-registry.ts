/**
 * resource-registry.ts
 *
 * Owns process-wide resource registration and validation. This file validates
 * definitions against table schemas and auth metadata config; it does not load
 * modules, generate CRUD routes, or enforce /api/data or sync policy.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { TableSchema } from '../sync/types';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthTenancyMode } from '../auth/types';
import {
  RESOURCE_EXPOSURES,
  type ResourceDefinition,
  type ResourceExposure,
} from './resource-definition';
import type {
  ResourcePolicyAuthConfig,
  ResourcePolicyValidationIssue,
} from './resource-policy-types';
import { getPolicyOwnerFields } from './resource-policy-inspection';
import { validateResourcePolicy } from './resource-policy-validation';
import {
  getResourceTableColumns,
  inferTablePrimaryKey,
  tableColumnIsDeclaredNotNull,
  tableHasColumn,
} from './resource-schema';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import { quoteSqlIdentifier } from '../sync/identity';
import { bindResourceObservabilityOwner } from './resource-observability';

/** Immutable transport projection normalized by the server-only registry. */
export interface RegisteredResourceExposure {
  readonly kind: ResourceExposure;
  readonly http: boolean;
  readonly sync: boolean;
}

/** How tenant-owned application rows are isolated by the resolved app topology. */
export type ResourceTenantIsolation = 'shared-row' | 'tenant-database';

/**
 * Server-only storage boundary resolved once during resource registration.
 *
 * Resource `realm` remains the developer's logical ownership declaration.
 * This normalized shape tells transports whether that ownership is enforced by
 * a row discriminator or by possession of the tenant's physical database.
 */
export type RegisteredResourceStorage =
  | Readonly<{ kind: 'unscoped' }>
  | Readonly<{ kind: 'global' }>
  | Readonly<{
      kind: 'tenant';
      isolation: 'shared-row';
      field: string;
    }>
  | Readonly<{
      kind: 'tenant';
      isolation: 'tenant-database';
    }>;

/** Registered resource with primary key and client exposure fully resolved. */
export interface RegisteredResourceDefinition extends Omit<
  ResourceDefinition,
  'primaryKey' | 'exposure'
> {
  readonly primaryKey: string;
  readonly exposure: RegisteredResourceExposure;
  readonly storage: RegisteredResourceStorage;
}

/** Resource validation issue codes for registration-time checks. */
export type ResourceRegistryIssueCode =
  | 'resource-duplicate-name'
  | 'resource-duplicate-table'
  | 'resource-table-missing'
  | 'resource-primary-key-missing'
  | 'resource-primary-key-mismatch'
  | 'resource-storage-primary-key-mismatch'
  | 'resource-policy-missing'
  | 'resource-field-unknown'
  | 'resource-field-primary-key-unreadable'
  | 'resource-field-primary-key-mutable'
  | 'resource-field-realm-client-writable'
  | 'resource-exposure-missing'
  | 'resource-exposure-invalid'
  | 'resource-owner-field-missing'
  | 'resource-realm-missing'
  | 'resource-realm-invalid'
  | 'resource-tenant-isolation-invalid'
  | 'resource-tenant-isolation-incompatible'
  | 'resource-tenant-field-invalid'
  | 'resource-tenant-field-missing'
  | 'resource-tenant-field-nullable'
  | 'resource-tenant-field-primary-key'
  | 'resource-tenant-storage-field-missing'
  | 'resource-tenant-storage-field-nullable'
  | 'resource-tenant-storage-field-primary-key'
  | 'resource-tenant-storage-index-missing'
  | 'resource-tenant-storage-unique-unscoped'
  | 'resource-tenant-storage-foreign-key-unscoped'
  | 'resource-managed-table-unclassified'
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
  /** Resolved capability mode. Defaults to the legacy-compatible single mode. */
  tenancyMode?: AuthTenancyMode;
  /** Resolved topology boundary. Omission preserves shared-row behavior. */
  tenantIsolation?: ResourceTenantIsolation;
  /**
   * App tables exposed through managed HTTP or Sync paths. In multi mode every
   * name in this set must have one explicitly classified resource.
   */
  managedTables?: Iterable<string>;
}

/** Options used to create or replace the process resource registry. */
export interface ConfigureResourceRegistryOptions extends ResourceRegistryValidationContext {
  resources?: readonly ResourceDefinition[];
  /** App-local event owner. Standalone callers may omit it for legacy behavior. */
  observability?: PlatformObservabilityRuntime | null;
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
  private tenantIsolation: ResourceTenantIsolation | null = null;
  private sealed = false;

  constructor(
    private readonly observability: PlatformObservabilityRuntime | null = null,
  ) {}

  /** Register one or more resource definitions after validating them. */
  register(
    resources: readonly ResourceDefinition[] | ResourceDefinition,
    context: ResourceRegistryValidationContext
  ): void {
    if (this.sealed) {
      throw new Error('[resources] Resource registry is sealed after startup validation.');
    }
    const next = Array.isArray(resources) ? resources : [resources];
    const issues = validateResourceDefinitions(next, context, this);
    const isolation = normalizeTenantIsolation(context.tenantIsolation);
    if (issues.length > 0) {
      throw new ResourceRegistryError('[resources] Resource registration failed.', issues);
    }

    this.tenantIsolation ??= isolation;
    for (const resource of next) {
      const primaryKey = resource.primaryKey ?? inferTablePrimaryKey(context.tables[resource.table]);
      if (!primaryKey) continue;

      const registered: RegisteredResourceDefinition = Object.freeze({
        ...resource,
        primaryKey,
        exposure: normalizeRegisteredResourceExposure(resource.exposure),
        storage: normalizeRegisteredResourceStorage(resource, isolation),
      });
      bindResourceObservabilityOwner(registered, this.observability);
      this.resourcesByName.set(registered.name, registered);
      this.resourcesByTable.set(registered.table, registered);
    }
  }

  /** Prevent policy/realm mutation after startup has built transport guards. */
  seal(): this {
    this.sealed = true;
    return this;
  }

  /** Return whether registration has been permanently closed. */
  isSealed(): boolean {
    return this.sealed;
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

  /** Return the immutable topology boundary used to normalize this registry. */
  getTenantIsolation(): ResourceTenantIsolation | null {
    return this.tenantIsolation;
  }

  /** Return true when a resource for the table is registered. */
  hasTable(table: string): boolean {
    return this.resourcesByTable.has(table);
  }
}

const emptyResourceRegistry = new ResourceRegistry().seal();
const resourceRegistryProviders = new CompatibilityProviderRegistry<ResourceRegistry>(
  'Resource registry',
);
const manualResourceRegistryOwner = {};
let manualResourceRegistryRegistration: { unregister(): void } | null = null;

/** Create a validated registry without installing ambient process state. */
export function createResourceRegistry(
  options: ConfigureResourceRegistryOptions,
): ResourceRegistry {
  const registry = new ResourceRegistry(options.observability ?? null);
  registry.register(options.resources ?? [], {
    tables: options.tables,
    authConfig: options.authConfig,
    tenancyMode: options.tenancyMode,
    tenantIsolation: options.tenantIsolation,
    managedTables: options.managedTables,
  });
  registry.seal();

  const event = {
    metadata: {
      resources: registry.list().length,
      tables: registry.list().map((resource) => resource.table),
      tenantIsolation: registry.getTenantIsolation(),
    },
  };
  if (options.observability) {
    emitPlatformCodeTo(options.observability, OBS_CODES.RESOURCE_REGISTRY_READY, event);
  } else {
    emitPlatformCode(OBS_CODES.RESOURCE_REGISTRY_READY, event);
  }

  return registry;
}

/**
 * Verify tenant resource invariants against SQLite's actual storage schema.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot repair an older table, index, unique
 * constraint, or foreign key, so declared config validation alone is not
 * enough for a production boundary. Column affinity and collation are not
 * rejected here: managed realm/policy SQL supplies storage-class and BINARY
 * exact predicates rather than inheriting either declaration.
 */
export function validateResourceStorageRealms(
  registry: ResourceRegistry,
  db: Pick<ReactiveDB, 'prepare'>,
): ResourceRegistryIssue[] {
  const issues: ResourceRegistryIssue[] = [];

  for (const resource of registry.list()) {
    // A physical tenant resource is deliberately absent from the shared
    // default/control database. Its actual schema is owned by the immutable
    // actor realm and is verified when that realm is configured/opened. Do
    // not turn the default database into a shadow copy merely so this
    // default-plane validator can inspect it.
    if (resource.storage.kind === 'tenant'
      && resource.storage.isolation === 'tenant-database') continue;

    const statement = db.prepare(
      `PRAGMA table_info(${quoteSqlIdentifier(resource.table)})`,
    );
    let columns: Array<{ name: string; notnull: number; pk: number }>;
    try {
      columns = statement.all() as Array<{ name: string; notnull: number; pk: number }>;
    } finally {
      statement.finalize();
    }

    const actualPrimaryKeys = columns
      .filter((candidate) => candidate.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((candidate) => candidate.name);
    if (actualPrimaryKeys.length !== 1 || actualPrimaryKeys[0] !== resource.primaryKey) {
      issues.push(issue(
        'resource-storage-primary-key-mismatch',
        `Resource "${resource.name}" expects sole primary key "${resource.primaryKey}", but the actual SQLite table "${resource.table}" uses ${formatActualPrimaryKeys(actualPrimaryKeys)}. Apply a migration before startup.`,
        resource,
        {
          expected: resource.primaryKey,
          actual: actualPrimaryKeys,
        },
      ));
    }

    if (resource.storage.kind !== 'tenant'
      || resource.storage.isolation !== 'shared-row') continue;
    const tenantField = resource.storage.field;

    const column = columns.find((candidate) => candidate.name === tenantField);
    if (!column) {
      issues.push(issue(
        'resource-tenant-storage-field-missing',
        `Tenant resource "${resource.name}" is missing discriminator "${tenantField}" in the actual SQLite table "${resource.table}". Apply a migration before startup.`,
        resource,
        { field: tenantField },
      ));
      continue;
    }
    if (column.pk !== 0) {
      issues.push(issue(
        'resource-tenant-storage-field-primary-key',
        `Tenant resource "${resource.name}" discriminator "${tenantField}" is a primary key in the actual SQLite schema. Use a separate row primary key and migrate the table.`,
        resource,
        { field: tenantField },
      ));
    }
    if (column.notnull !== 1) {
      issues.push(issue(
        'resource-tenant-storage-field-nullable',
        `Tenant resource "${resource.name}" discriminator "${tenantField}" is nullable in the actual SQLite schema. Apply a NOT NULL migration before enabling multi-tenancy.`,
        resource,
        { field: tenantField },
      ));
    }

    validateTenantStorageIndexes(resource, tenantField, db, issues);
    validateTenantStorageForeignKeys(resource, tenantField, registry, db, issues);
  }

  return issues;
}

interface SQLiteIndexListRow {
  name: string;
  unique: number;
  origin: 'c' | 'u' | 'pk' | string;
  partial: number;
}

interface SQLiteIndexInfoRow {
  seqno: number;
  cid: number;
  name: string | null;
}

interface SQLiteForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
}

function validateTenantStorageIndexes(
  resource: RegisteredResourceDefinition,
  tenantField: string,
  db: Pick<ReactiveDB, 'prepare'>,
  issues: ResourceRegistryIssue[],
): void {
  const indexes = queryPragmaRows<SQLiteIndexListRow>(
    db,
    `PRAGMA index_list(${quoteSqlIdentifier(resource.table)})`,
  );
  const resolved = indexes.map((index) => ({
    ...index,
    columns: queryPragmaRows<SQLiteIndexInfoRow>(
      db,
      `PRAGMA index_info(${quoteSQLiteMetadataIdentifier(index.name)})`,
    )
      .sort((left, right) => left.seqno - right.seqno)
      .map((entry) => entry.name),
  }));

  const hasTenantLeadingIndex = resolved.some((index) =>
    index.partial === 0 && index.columns[0] === tenantField);
  if (!hasTenantLeadingIndex) {
    issues.push(issue(
      'resource-tenant-storage-index-missing',
      `Tenant resource "${resource.name}" requires a non-partial SQLite index beginning with discriminator "${tenantField}" on table "${resource.table}". Apply a tenant-leading index migration before startup.`,
      resource,
      { field: tenantField },
    ));
  }

  for (const index of resolved) {
    if (index.unique !== 1 || index.origin === 'pk') continue;
    // A unique index containing the already-unique row key adds no new
    // cross-tenant uniqueness restriction, so it is safe to ignore.
    if (index.columns.includes(resource.primaryKey)) continue;
    if (index.columns.includes(tenantField)) continue;

    issues.push(issue(
      'resource-tenant-storage-unique-unscoped',
      `Tenant resource "${resource.name}" has unique SQLite index "${index.name}" without discriminator "${tenantField}". Make tenant-owned business uniqueness composite with the tenant discriminator.`,
      resource,
      {
        field: tenantField,
        index: index.name,
        columns: index.columns,
      },
    ));
  }
}

function validateTenantStorageForeignKeys(
  resource: RegisteredResourceDefinition,
  tenantField: string,
  registry: ResourceRegistry,
  db: Pick<ReactiveDB, 'prepare'>,
  issues: ResourceRegistryIssue[],
): void {
  const foreignKeys = queryPragmaRows<SQLiteForeignKeyRow>(
    db,
    `PRAGMA foreign_key_list(${quoteSqlIdentifier(resource.table)})`,
  );
  const groups = new Map<number, SQLiteForeignKeyRow[]>();
  for (const row of foreignKeys) {
    const group = groups.get(row.id) ?? [];
    group.push(row);
    groups.set(row.id, group);
  }

  for (const [foreignKeyId, group] of groups) {
    const ordered = group.sort((left, right) => left.seq - right.seq);
    const parentTable = ordered[0]?.table;
    if (!parentTable) continue;
    const parent = registry.getByTable(parentTable);
    if (parent?.storage.kind !== 'tenant'
      || parent.storage.isolation !== 'shared-row') continue;
    const parentTenantField = parent.storage.field;

    const hasTenantPair = ordered.some((entry) =>
      entry.from === tenantField && entry.to === parentTenantField);
    if (hasTenantPair) continue;

    issues.push(issue(
      'resource-tenant-storage-foreign-key-unscoped',
      `Tenant resource "${resource.name}" has a foreign key to tenant resource "${parent.name}" that does not pair "${tenantField}" with parent discriminator "${parentTenantField}" in the same composite constraint. Apply a tenant-consistent foreign-key migration before startup.`,
      resource,
      {
        foreignKeyId,
        parentResource: parent.name,
        parentTable,
        childTenantField: tenantField,
        parentTenantField,
        columns: ordered.map((entry) => ({ from: entry.from, to: entry.to })),
      },
    ));
  }
}

function queryPragmaRows<TRow>(
  db: Pick<ReactiveDB, 'prepare'>,
  sql: string,
): TRow[] {
  const statement = db.prepare(sql);
  try {
    return statement.all() as TRow[];
  } finally {
    statement.finalize();
  }
}

function quoteSQLiteMetadataIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function formatActualPrimaryKeys(columns: readonly string[]): string {
  if (columns.length === 0) return 'no primary key';
  if (columns.length === 1) return `"${columns[0]}"`;
  return `composite primary key (${columns.map((column) => `"${column}"`).join(', ')})`;
}

/** Fail startup when an existing database contradicts a tenant resource realm. */
export function assertResourceStorageRealms(
  registry: ResourceRegistry,
  db: Pick<ReactiveDB, 'prepare'>,
): void {
  const issues = validateResourceStorageRealms(registry, db);
  if (issues.length > 0) {
    throw new ResourceRegistryError(
      '[resources] Actual SQLite resource validation failed. Apply the required schema migration before starting Zero.',
      issues,
    );
  }
}

/** Register one app-owned registry for legacy no-argument getter compatibility. */
export function registerResourceRegistry(
  owner: object,
  registry: ResourceRegistry,
): { unregister(): void } {
  return resourceRegistryProviders.register(owner, () => registry);
}

/** Replace the process-wide resource registry with validated definitions. */
export function configureResourceRegistry(options: ConfigureResourceRegistryOptions): ResourceRegistry {
  manualResourceRegistryRegistration?.unregister();
  const registry = createResourceRegistry(options);
  manualResourceRegistryRegistration = registerResourceRegistry(
    manualResourceRegistryOwner,
    registry,
  );
  return registry;
}

/** Remove the legacy process-wide registry installed by configureResourceRegistry(). */
export function clearResourceRegistry(): void {
  manualResourceRegistryRegistration?.unregister();
  manualResourceRegistryRegistration = null;
}

/** Return the active process resource registry. */
export function getResourceRegistry(): ResourceRegistry {
  return resourceRegistryProviders.get() ?? emptyResourceRegistry;
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
  const tenancyMode = context.tenancyMode ?? 'single';
  const tenantIsolation = normalizeTenantIsolation(context.tenantIsolation);

  if (context.tenantIsolation !== undefined
    && context.tenantIsolation !== 'shared-row'
    && context.tenantIsolation !== 'tenant-database') {
    issues.push({
      code: 'resource-tenant-isolation-invalid',
      message: `Unsupported resource tenant isolation "${String(context.tenantIsolation)}". Expected "shared-row" or "tenant-database".`,
      path: 'tenantIsolation',
      severity: 'error',
      metadata: { tenantIsolation: context.tenantIsolation },
    });
  }
  if (tenantIsolation === 'tenant-database' && tenancyMode !== 'multi') {
    issues.push({
      code: 'resource-tenant-isolation-incompatible',
      message: 'Tenant-database resource isolation requires multi-tenant auth.',
      path: 'tenantIsolation',
      severity: 'error',
      metadata: { tenantIsolation, tenancyMode },
    });
  }
  if (existingRegistry?.getTenantIsolation()
    && existingRegistry.getTenantIsolation() !== tenantIsolation) {
    issues.push({
      code: 'resource-tenant-isolation-incompatible',
      message: `Resource registry is already bound to tenant isolation "${existingRegistry.getTenantIsolation()}" and cannot validate definitions using "${tenantIsolation}".`,
      path: 'tenantIsolation',
      severity: 'error',
      metadata: {
        expected: existingRegistry.getTenantIsolation(),
        actual: tenantIsolation,
      },
    });
  }

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

    validateResourceRealm(
      resource,
      schema,
      primaryKey,
      tenancyMode,
      tenantIsolation,
      issues,
    );
    validateResourceFields(resource, schema, primaryKey, tenantIsolation, issues);
    if (tenancyMode === 'multi' && resource.exposure === undefined) {
      issues.push(issue(
        'resource-exposure-missing',
        `Resource "${resource.name}" must declare exposure: "internal", "http", "sync", or "all" in multi-tenant mode.`,
        resource,
      ));
    } else if (resource.exposure !== undefined
      && !RESOURCE_EXPOSURE_VALUES.has(resource.exposure)) {
      issues.push(issue(
        'resource-exposure-invalid',
        `Resource "${resource.name}" has unsupported exposure "${String(resource.exposure)}". Expected "internal", "http", "sync", or "all".`,
        resource,
      ));
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

      if (schema) {
        for (const ownerField of getPolicyOwnerFields(policy)) {
          if (tableHasColumn(schema, ownerField)) continue;
          issues.push({
            code: 'resource-owner-field-missing',
            message: `Resource "${resource.name}" ownerPolicy references missing column "${ownerField}" on table "${resource.table}".`,
            resource: resource.name,
            table: resource.table,
            action,
            path: `policy.${action}.owner.${ownerField}`,
            severity: 'error',
            metadata: { field: ownerField },
          });
        }
      }
    }
  }

  const managedTables = context.managedTables
    ?? (tenancyMode === 'multi' ? Object.keys(context.tables) : undefined);
  if (tenancyMode === 'multi' && managedTables) {
    const classifiedTables = new Set<string>([
      ...seenTables,
      ...(existingRegistry?.list().map((resource) => resource.table) ?? []),
    ]);
    for (const rawTable of managedTables) {
      const table = String(rawTable).trim();
      if (!table || table.startsWith('_') || classifiedTables.has(table)) continue;
      issues.push({
        code: 'resource-managed-table-unclassified',
        message: `Managed table "${table}" must have an explicit global or tenant resource realm in multi-tenant mode.`,
        table,
        path: 'realm',
        severity: 'error',
        metadata: { tenancyMode },
      });
    }
  }

  return issues;
}

function validateResourceFields(
  resource: ResourceDefinition,
  schema: TableSchema | undefined,
  primaryKey: string | null | undefined,
  tenantIsolation: ResourceTenantIsolation,
  issues: ResourceRegistryIssue[],
): void {
  if (!resource.fields || !schema) return;
  const columns = new Set(getResourceTableColumns(schema));

  for (const capability of ['read', 'create', 'update', 'filter', 'sort'] as const) {
    for (const field of resource.fields[capability]) {
      if (columns.has(field)) continue;
      issues.push({
        code: 'resource-field-unknown',
        message: `Resource "${resource.name}" fields.${capability} references missing column "${field}" on table "${resource.table}".`,
        resource: resource.name,
        table: resource.table,
        path: `fields.${capability}`,
        severity: 'error',
        metadata: { capability, field },
      });
    }
  }

  if (primaryKey && resource.fields.update.includes(primaryKey)) {
    issues.push({
      code: 'resource-field-primary-key-mutable',
      message: `Resource "${resource.name}" cannot make primary key "${primaryKey}" client-updatable.`,
      resource: resource.name,
      table: resource.table,
      path: 'fields.update',
      severity: 'error',
      metadata: { field: primaryKey },
    });
  }

  if (primaryKey
    && resource.exposure !== 'internal'
    && !resource.fields.read.includes(primaryKey)) {
    issues.push({
      code: 'resource-field-primary-key-unreadable',
      message: `Client-exposed resource "${resource.name}" must include primary key "${primaryKey}" in fields.read so managed caches can retain stable row identity.`,
      resource: resource.name,
      table: resource.table,
      path: 'fields.read',
      severity: 'error',
      metadata: { field: primaryKey },
    });
  }

  if (resource.realm?.kind !== 'tenant' || tenantIsolation !== 'shared-row') return;
  for (const capability of ['create', 'update'] as const) {
    if (!resource.fields[capability].includes(resource.realm.field)) continue;
    issues.push({
      code: 'resource-field-realm-client-writable',
      message: `Tenant resource "${resource.name}" cannot make server-derived discriminator "${resource.realm.field}" client-writable through fields.${capability}.`,
      resource: resource.name,
      table: resource.table,
      path: `fields.${capability}`,
      severity: 'error',
      metadata: { capability, field: resource.realm.field },
    });
  }
}

function normalizeRegisteredResourceExposure(
  exposure: ResourceExposure | undefined,
): RegisteredResourceExposure {
  const kind = exposure ?? 'all';
  if (!RESOURCE_EXPOSURE_VALUES.has(kind)) {
    throw new Error(`[resources] Cannot normalize unsupported resource exposure "${String(kind)}".`);
  }
  return Object.freeze({
    kind,
    http: kind === 'http' || kind === 'all',
    sync: kind === 'sync' || kind === 'all',
  });
}

const RESOURCE_EXPOSURE_VALUES = new Set<ResourceExposure>(RESOURCE_EXPOSURES);

const SAFE_SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateResourceRealm(
  resource: ResourceDefinition,
  schema: TableSchema | undefined,
  primaryKey: string | null | undefined,
  tenancyMode: AuthTenancyMode,
  tenantIsolation: ResourceTenantIsolation,
  issues: ResourceRegistryIssue[],
): void {
  const realm = resource.realm;
  if (!realm) {
    if (tenancyMode === 'multi') {
      issues.push(issue(
        'resource-realm-missing',
        `Resource "${resource.name}" must declare realm: "global" or tenantRealm(...) in multi-tenant mode.`,
        resource,
      ));
    }
    return;
  }

  if (realm.kind === 'global') return;
  if (realm.kind !== 'tenant') {
    issues.push(issue(
      'resource-realm-invalid',
      `Resource "${resource.name}" has an unsupported data realm.`,
      resource,
    ));
    return;
  }

  if (!SAFE_SQL_IDENTIFIER.test(realm.field)) {
    issues.push(issue(
      'resource-tenant-field-invalid',
      `Resource "${resource.name}" tenant discriminator "${realm.field}" is not a safe SQL column name.`,
      resource,
      { field: realm.field },
    ));
    return;
  }

  // In tenant-database mode the trusted database capability is the mandatory
  // tenant boundary. The realm field remains a portable declaration default,
  // but it is not a required or server-managed application column.
  if (tenantIsolation === 'tenant-database') return;

  if (!schema || !tableHasColumn(schema, realm.field)) {
    issues.push(issue(
      'resource-tenant-field-missing',
      `Resource "${resource.name}" tenant discriminator "${realm.field}" is not defined on table "${resource.table}".`,
      resource,
      { field: realm.field },
    ));
    return;
  }

  if (realm.field === primaryKey) {
    issues.push(issue(
      'resource-tenant-field-primary-key',
      `Resource "${resource.name}" tenant discriminator cannot also be its row primary key.`,
      resource,
      { field: realm.field },
    ));
  }

  if (!tableColumnIsDeclaredNotNull(schema, realm.field)) {
    issues.push(issue(
      'resource-tenant-field-nullable',
      `Resource "${resource.name}" tenant discriminator "${realm.field}" must be NOT NULL.`,
      resource,
      { field: realm.field },
    ));
  }
}

function normalizeTenantIsolation(
  isolation: ResourceTenantIsolation | undefined,
): ResourceTenantIsolation {
  return isolation === 'tenant-database' ? 'tenant-database' : 'shared-row';
}

function normalizeRegisteredResourceStorage(
  resource: ResourceDefinition,
  tenantIsolation: ResourceTenantIsolation,
): RegisteredResourceStorage {
  if (!resource.realm) return Object.freeze({ kind: 'unscoped' });
  if (resource.realm.kind === 'global') return Object.freeze({ kind: 'global' });
  return tenantIsolation === 'tenant-database'
    ? Object.freeze({ kind: 'tenant', isolation: 'tenant-database' })
    : Object.freeze({
        kind: 'tenant',
        isolation: 'shared-row',
        field: resource.realm.field,
      });
}

function issue(
  code: ResourceRegistryIssueCode,
  message: string,
  resource: Pick<ResourceDefinition, 'name' | 'table'>,
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
