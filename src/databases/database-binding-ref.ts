/**
 * Stable public references for DatabaseManager-owned binding namespaces.
 *
 * DatabaseManager deliberately domain-separates named and tenant bindings
 * before handing them to DatabaseCoordinator. Placement policy therefore
 * cannot compare its opaque `databaseRef` with `createDatabaseRef(tenantId)`
 * directly. These helpers reproduce the manager's exact pseudonymous routing
 * reference without exposing the derived physical id or a filesystem path.
 * References are deterministic correlation IDs, not secrets or authority.
 */

import { createHash } from 'node:crypto';

import { DatabaseError } from './database-error';
import {
  createDatabaseRef,
  normalizeDatabaseId,
  type DatabaseId,
  type DatabaseRef,
} from './database-file';

const NAMED_BINDING_DOMAIN = 'zero.named-database-binding.v1\0';
const TENANT_BINDING_DOMAIN = 'zero.tenant-database-binding.v1\0';

/** Return the opaque placement reference used for a named manager binding. */
export function createNamedDatabaseRef(name: string): DatabaseRef {
  return createDatabaseRef(deriveNamedDatabaseId(name));
}

/** Return the opaque placement reference used for an auth-derived tenant file. */
export function createTenantDatabaseRef(tenantId: string): DatabaseRef {
  return createDatabaseRef(deriveTenantDatabaseId(tenantId));
}

/** @internal Derive the domain-separated physical id owned by DatabaseManager. */
export function deriveNamedDatabaseId(name: string): DatabaseId {
  return deriveBindingId(NAMED_BINDING_DOMAIN, name);
}

/** @internal Derive the domain-separated physical id owned by DatabaseManager. */
export function deriveTenantDatabaseId(tenantId: string): DatabaseId {
  return deriveBindingId(TENANT_BINDING_DOMAIN, tenantId);
}

function deriveBindingId(domain: string, input: string): DatabaseId {
  let logicalId: DatabaseId;
  try {
    logicalId = normalizeDatabaseId(input);
  } catch {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database binding identity is invalid.',
    );
  }

  const digest = createHash('sha256')
    .update(domain, 'utf8')
    .update(logicalId, 'utf8')
    .digest('hex');
  return normalizeDatabaseId(`binding-v1-${digest}`);
}
