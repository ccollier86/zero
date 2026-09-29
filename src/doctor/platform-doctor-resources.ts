/**
 * platform-doctor-resources.ts
 *
 * Pure diagnostics for declarative Resource policy, exposure, tenant realms,
 * query indexes, and the default-plane mutation receipt lifecycle.
 */

import type { ResolvedAuthBehaviorConfig } from '../auth/types';
import type { ResolvedConfig } from '../frontend/server/types';
import {
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
  allowsPublicAction,
  getPolicyOwnerFields,
  hasCustomPolicyBranch,
  inferTablePrimaryKey,
  requiresAuthenticatedUser,
  validateResourceDefinitions,
  type ResourceAction,
  type ResourceDefinition,
} from '../resources';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

const WRITE_RESOURCE_ACTIONS = new Set<ResourceAction>(['create', 'update', 'delete']);

/** Validate registered resources and explain data/sync policy behavior. */
export function checkResources(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  authConfig: ResolvedAuthBehaviorConfig | null,
): void {
  if (!authConfig) return;

  for (const issue of validateResourceDefinitions(resolved.resources, {
    tables: resolved.tables,
    authConfig,
    tenancyMode: authConfig.tenancy?.mode ?? 'single',
    tenantIsolation: resolved.databaseTopology.mode === 'multiple'
      ? resolved.databaseTopology.tenantIsolation
      : 'shared-row',
    managedTables: Object.keys(resolved.tables),
  })) {
    addFinding(findings, {
      severity: 'error',
      code: `resource.${issue.code}`,
      path: issue.path
        ? `resources.${issue.resource ?? issue.table}.${issue.path}`
        : `resources.${issue.resource ?? issue.table ?? 'unknown'}`,
      message: issue.message,
      hint: resourceValidationHint(issue.code),
      docs: './docs/framework/resource-policy.md',
    });
  }

  for (const resource of resolved.resources) {
    checkResourceRealmIndex(resource, resolved, findings);
    checkResourceExposureLoading(resource, resolved, findings);
    checkResourceListPolicy(resource, resolved, findings);
    checkResourceAuthShape(resource, resolved, findings);
    checkResourcePublicWrites(resource, findings);
  }

  checkDefaultResourceReceiptLifecycle(resolved, findings);
}

/** Explain the finite receipt lifecycle shared by generated default-plane writes. */
function checkDefaultResourceReceiptLifecycle(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resolved.resourceRoutes === false) return;

  const resources = resolved.resources.filter((resource) => {
    const exposure = resource.exposure ?? 'all';
    if (exposure !== 'http' && exposure !== 'all') return false;
    if (!resource.actions.some((action) =>
      WRITE_RESOURCE_ACTIONS.has(action) && resource.policy[action] !== undefined)) {
      return false;
    }

    return !(resolved.databaseTopology.mode === 'multiple'
      && resolved.databaseTopology.tenantIsolation === 'tenant-database'
      && resource.realm?.kind === 'tenant');
  });
  if (resources.length === 0) return;

  const resourceCount = resources.length.toLocaleString('en-US');
  const resourceLabel = resources.length === 1 ? 'Resource' : 'Resources';
  const verb = resources.length === 1 ? 'uses' : 'use';
  addFinding(findings, {
    severity: 'info',
    code: 'resource.receipts.default_full_result_budget',
    path: 'resources',
    message: `${resourceCount} generated mutating ${resourceLabel} ${verb} the pinned default/shared-row receipt ledger. That shared ledger retains at most ${RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT.toLocaleString('en-US')} full results and ${formatDoctorBinaryBytes(RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES)} of encoded results before compacting the oldest results to permanent tombstones.`,
    hint: 'Size retry and reconciliation windows so clients recover canonical results before compaction; an expired result fails closed and is never re-executed.',
    docs: './docs/framework/multi-database-architecture.md#idempotency-failure-and-restart',
  });
  addFinding(findings, {
    severity: 'warning',
    code: 'resource.receipts.default_permanent_key_capacity',
    path: 'resources',
    message: `The default/shared-row Resource receipt ledger permanently admits at most ${RESOURCE_DEFAULT_RECEIPT_MAX_KEYS.toLocaleString('en-US')} idempotency identities across those generated mutations; compacted tombstones remain to prevent replayed work.`,
    hint: 'Monitor database.receipt.compacted events for databasePlane "default" and resource.receipt.capacity_exhausted; define the default database archive, replacement, or decommission lifecycle well before exhaustion.',
    docs: './docs/framework/multi-database-architecture.md#idempotency-failure-and-restart',
  });
}

/** Reject a Sync-only declaration that can require denied HTTP hydration. */
function checkResourceExposureLoading(
  resource: ResourceDefinition,
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resource.exposure !== 'sync') return;
  const mode = resolved.declaredSyncModes.get(resource.table)
    ?? resolved.syncDefaults.defaultMode;
  const tableDefault = resolved.syncDefaults.tables.get(resource.table);
  const autoCanResolveLazy = (tableDefault?.action ?? resolved.syncDefaults.action) === 'lazy';
  if (mode !== 'lazy' && !(mode === 'auto' && autoCanResolveLazy)) return;

  addFinding(findings, {
    severity: 'error',
    code: 'resource.exposure.sync_lazy_requires_http',
    path: `resources.${resource.name}.exposure`,
    message: `Sync-only resource "${resource.name}" can resolve to lazy loading, but lazy Sync hydration requires /api/data and exposure: "sync" denies HTTP.`,
    hint: 'Use exposure: "all" or configure this table for guaranteed full Sync.',
    docs: './docs/framework/resource-policy.md#client-exposure',
  });
}

/** Recommend the compound-query foundation every tenant resource will use. */
function checkResourceRealmIndex(
  resource: ResourceDefinition,
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resource.realm?.kind !== 'tenant') return;
  if (resolved.databaseTopology.mode === 'multiple'
    && resolved.databaseTopology.tenantIsolation === 'tenant-database') {
    const schema = resolved.tables[resource.table];
    const retainsDeclaredField = Boolean(schema && resource.realm.field in schema);
    addFinding(findings, {
      severity: 'info',
      code: retainsDeclaredField
        ? 'resource.tenant_field.not_isolation_boundary'
        : 'resource.tenant_database.physical_boundary',
      path: `resources.${resource.name}.realm`,
      message: retainsDeclaredField
        ? `Tenant resource "${resource.name}" is physically isolated by its bound database; "${resource.realm.field}" is ordinary application data, not the authorization boundary.`
        : `Tenant resource "${resource.name}" is physically isolated by its bound database and does not need a tenant discriminator column.`,
      hint: retainsDeclaredField
        ? `Keep ${resource.realm.field} only when the value has a business/export purpose; otherwise remove it through an explicit verified migration.`
        : 'Keep tenant selection framework-derived; routes, Sync, and services must never accept a caller-selected database.',
      docs: './docs/framework/multi-database-architecture.md#where-tenant-scope-lives',
    });
    return;
  }
  if (isLikelyTenantLeadingIndex(
    resolved,
    resource.table,
    resource.realm.field,
  )) return;

  addFinding(findings, {
    severity: 'warning',
    code: 'resource.tenant_field.index_guidance',
    path: `resources.${resource.name}.realm.${resource.realm.field}`,
    message: `Tenant resource "${resource.name}" filters every managed read and mutation by "${resource.realm.field}".`,
    hint: `Add a migration index beginning with ${resource.realm.field}; include common sort/filter fields after it for hot list queries.`,
    docs: './docs/framework/resource-policy.md',
  });
}

/** Emit warnings for resource reads that affect `/api/data` and sync. */
function checkResourceListPolicy(
  resource: ResourceDefinition,
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resource.exposure === 'internal') return;
  const listPolicy = resource.policy.list;
  const path = `resources.${resource.name}.policy.list`;
  if (!listPolicy) {
    addFinding(findings, {
      severity: 'warning',
      code: 'resource.list_policy.missing',
      path,
      message: `Resource "${resource.name}" is client-exposed for table "${resource.table}" without a list policy. Its managed list/data/Sync reads fail closed.`,
      hint: 'Add a list policy when the table should be readable through platform data/sync APIs, or keep it omitted intentionally for write-only/custom access.',
      docs: './docs/framework/resource-policy.md#generic-data-and-sync-policy',
    });
    return;
  }

  if (hasCustomPolicyBranch(listPolicy)) {
    addFinding(findings, {
      severity: 'warning',
      code: 'resource.list_policy.custom_static_unknown',
      path,
      message: `Resource "${resource.name}" list policy includes a custom policy branch, so doctor cannot statically prove its /api/data and sync row scope.`,
      hint: 'Return explicit constraints from custom list policies when they are intended to scope rows, and cover the behavior with tests.',
      docs: './docs/framework/resource-policy.md#custom-policy',
    });
  }

  const ownerFields = getPolicyOwnerFields(listPolicy);
  for (const field of ownerFields) {
    if (!isLikelyIndexedResourceField(resolved, resource.table, field)) {
      addFinding(findings, {
        severity: 'warning',
        code: 'resource.owner_field.index_guidance',
        path,
        message: `Resource "${resource.name}" list policy filters by "${field}". Add a migration index for this column when the table can grow.`,
        hint: 'Owner/list constraints feed /api/data filters and row-filtered sync; indexed owner columns keep those paths fast.',
        docs: './docs/framework/resource-policy.md#generic-data-and-sync-policy',
      });
    }
  }

  if (ownerFields.length > 0 && resource.exposure !== 'http') {
    addFinding(findings, {
      severity: 'info',
      code: 'resource.sync.row_filtered',
      path,
      message: `Resource "${resource.name}" uses owner/list constraints. WebSocket sync will use per-connection row filters for table "${resource.table}".`,
      hint: 'Rows moving out of scope are projected as DELETE changes so client stores do not retain stale data.',
      docs: './docs/framework/resource-policy.md#websocket-sync',
    });
  }
}

/** Warn when resource policies require auth but the app has auth disabled. */
function checkResourceAuthShape(
  resource: ResourceDefinition,
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resolved.auth !== false) return;

  for (const action of resource.actions) {
    const policy = resource.policy[action];
    if (!policy) continue;
    if (requiresAuthenticatedUser(policy, action) !== 'yes') continue;

    addFinding(findings, {
      severity: 'warning',
      code: 'resource.auth_required_but_disabled',
      path: `resources.${resource.name}.policy.${action}`,
      message: `Resource "${resource.name}" ${action} policy requires an authenticated user, but auth is disabled.`,
      hint: 'Enable auth, switch this action to a public policy, or disable generated routes/data/sync access for this resource.',
      docs: './docs/framework/resource-policy.md',
    });
  }
}

/** Warn when a resource write/delete action is publicly allowed or unknown. */
function checkResourcePublicWrites(
  resource: ResourceDefinition,
  findings: PlatformDoctorFindingSink,
): void {
  for (const action of resource.actions) {
    if (!WRITE_RESOURCE_ACTIONS.has(action)) continue;

    const policy = resource.policy[action];
    if (!policy) continue;

    const publicAccess = allowsPublicAction(policy, action);
    if (publicAccess === 'no') continue;

    addFinding(findings, {
      severity: 'warning',
      code: publicAccess === 'yes'
        ? 'resource.public_write_policy'
        : 'resource.public_write_policy_uninspectable',
      path: `resources.${resource.name}.policy.${action}`,
      message: publicAccess === 'yes'
        ? `Resource "${resource.name}" ${action} policy statically allows public writes.`
        : `Resource "${resource.name}" ${action} policy includes a custom branch, so doctor cannot prove public write access is denied.`,
      hint: 'Use authenticatedOnly(), ownerPolicy(), metadataPolicy(), or adminOnly() for write/delete actions unless public writes are intentional.',
      docs: './docs/framework/resource-policy.md',
    });
  }
}

function resourceValidationHint(code: string): string | undefined {
  switch (code) {
    case 'resource-table-missing':
      return 'Add the table to createApp({ tables }) or update the resource table name.';
    case 'resource-primary-key-missing':
    case 'resource-primary-key-mismatch':
      return 'Resource primary keys must match the single string sync primary key declared on the table.';
    case 'resource-policy-missing':
      return 'Every action listed on a resource needs an explicit policy.';
    case 'resource-owner-field-missing':
      return 'Add the owner column to the table schema or update ownerPolicy({ userField }).';
    case 'resource-field-unknown':
      return 'Every fields.read/create/update/filter/sort entry must name a real table column.';
    case 'resource-field-primary-key-unreadable':
      return 'Include the resource primary key in fields.read so managed HTTP and Sync caches keep stable row identity.';
    case 'resource-field-primary-key-mutable':
      return 'Remove the primary key from fields.update; managed updates cannot move a row to a new identity.';
    case 'resource-field-realm-client-writable':
      return 'Remove the tenant discriminator from fields.create/update; Zero derives and stamps it from the live session.';
    case 'resource-exposure-missing':
    case 'resource-exposure-invalid':
      return 'Classify managed client access with exposure: "internal", "http", "sync", or "all"; multi-tenant mode requires an explicit choice.';
    case 'resource-realm-missing':
    case 'resource-realm-invalid':
    case 'resource-managed-table-unclassified':
      return 'Classify every managed app table with realm: "global" or tenantRealm({ field: "tenant_id" }); multi-tenant mode never assumes shared data.';
    case 'resource-tenant-isolation-invalid':
    case 'resource-tenant-isolation-incompatible':
      return 'Use shared-row for the historical row-discriminator model, or enable tenant-database only with multi-tenant auth and an actor-backed database topology.';
    case 'resource-tenant-field-missing':
    case 'resource-tenant-field-nullable':
    case 'resource-tenant-field-primary-key':
    case 'resource-tenant-field-invalid':
      return 'Use a dedicated, non-nullable tenant discriminator column (normally tenant_id), separate from the row primary key.';
    case 'metadata-property-unknown':
    case 'metadata-property-untrusted':
      return 'Configure auth.userProperties for every metadataPolicy key and set useInPolicies: true only on admin/system/none-editable fields.';
    default:
      return undefined;
  }
}

function isLikelyIndexedResourceField(
  resolved: ResolvedConfig,
  tableName: string,
  field: string,
): boolean {
  const schema = resolved.tables[tableName];
  if (!schema) return false;
  if (inferTablePrimaryKey(schema) === field) return true;
  if (schema._identity?.includes(field)) return true;
  if (resolved.doctor.indexedFields?.[tableName]?.includes(field)) return true;

  const definition = schema[field];
  return typeof definition === 'string' && /\b(primary\s+key|unique)\b/i.test(definition);
}

/**
 * Tenant predicates lead every managed query. An identity index only satisfies
 * that access pattern when the discriminator is its first column.
 */
function isLikelyTenantLeadingIndex(
  resolved: ResolvedConfig,
  tableName: string,
  field: string,
): boolean {
  const schema = resolved.tables[tableName];
  if (!schema) return false;
  if (inferTablePrimaryKey(schema) === field) return true;
  if (schema._identity?.[0] === field) return true;
  if (resolved.doctor.indexedFields?.[tableName]?.includes(field)) return true;

  const definition = schema[field];
  return typeof definition === 'string' && /\b(primary\s+key|unique)\b/i.test(definition);
}

/** Prefer an operator-friendly binary unit while preserving the exact byte bound. */
function formatDoctorBinaryBytes(value: number | bigint): string {
  const bytes = typeof value === 'bigint' ? value : BigInt(value);
  const mebibyte = 1024n * 1024n;
  if (bytes % mebibyte !== 0n) return formatDoctorBytes(bytes);
  return `${(bytes / mebibyte).toLocaleString('en-US')} MiB (${formatDoctorBytes(bytes)})`;
}

function formatDoctorBytes(value: number | bigint): string {
  const bytes = typeof value === 'bigint' ? value : BigInt(value);
  return `${bytes.toLocaleString('en-US')} bytes`;
}
