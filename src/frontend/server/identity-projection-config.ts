import {
  getGuardianAnchorRequirements,
  inspectGuardianReferenceSchema,
  type GuardianReferenceSchemaReader,
} from '../../schema/guardian-references';
import type { TableSchema } from '../../sync/types';
import { DatabaseError } from '../../databases/database-error';

export interface IdentityProjectionRequirements {
  readonly user: boolean;
  readonly membership: boolean;
}

export interface PartitionedIdentityProjectionRequirements {
  readonly application: IdentityProjectionRequirements;
  readonly tenant: IdentityProjectionRequirements;
}

/** Fail startup before any unusable Guardian FK schema reaches a transport. */
export function assertAppIdentityProjectionConfiguration(input: Readonly<{
  tables: Readonly<Record<string, TableSchema>>;
  authEnabled: boolean;
  tenancyMode: 'single' | 'multi';
}>): void {
  let hasReference = false;
  let hasMembership = false;
  for (const [tableName, table] of Object.entries(input.tables)) {
    const declarationIssue = inspectGuardianReferenceSchema(table)[0];
    if (declarationIssue) {
      throw invalidIdentityProjectionConfiguration(
        `[app] Table "${tableName}" Guardian field "${declarationIssue.field}" does not declare its exact managed foreign key.`,
        'reference-schema-invalid',
        { table: tableName, field: declarationIssue.field, issue: declarationIssue.code },
      );
    }
    const requirements = getGuardianAnchorRequirements(table);
    hasReference ||= requirements.length > 0;
    hasMembership ||= requirements.includes('membership');
  }
  if (hasReference && !input.authEnabled) {
    throw invalidIdentityProjectionConfiguration(
      '[app] Guardian identity references require Guardian auth to be enabled.',
      'auth-required',
    );
  }
  if (hasMembership && input.tenancyMode !== 'multi') {
    throw invalidIdentityProjectionConfiguration(
      '[app] field.guardianMembership() requires auth.tenancy.mode "multi".',
      'membership-requires-multi-tenancy',
    );
  }
}

/**
 * Fail startup when an existing application SQLite table drifted from its
 * declarative Guardian metadata. Tenant tables are verified inside their actor
 * before the realm is published.
 */
export function assertApplicationGuardianReferenceStorage(input: Readonly<{
  database: GuardianReferenceSchemaReader;
  tables: Readonly<Record<string, TableSchema>>;
  tenantTables: ReadonlySet<string>;
}>): void {
  for (const [tableName, table] of Object.entries(input.tables)) {
    if (input.tenantTables.has(tableName)) continue;
    const storageIssue = inspectGuardianReferenceSchema(table, {
      database: input.database,
      tableName,
    }).find((issue) => issue.code === 'missing-foreign-key'
      || issue.code === 'invalid-foreign-key');
    if (!storageIssue) continue;
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      `[app] Table "${tableName}" Guardian field "${storageIssue.field}" does not match its exact installed foreign key.`,
      {
        retryable: false,
        outcome: 'not-started',
        details: {
          component: 'guardian-identity-projection',
          reason: 'reference-storage-invalid',
          table: tableName,
          field: storageIssue.field,
          issue: storageIssue.code,
        },
      },
    );
  }
}

/** Partition declared Guardian FKs by the physical database that owns them. */
export function partitionIdentityProjectionRequirements(
  tables: Readonly<Record<string, TableSchema>>,
  tenantTables: ReadonlySet<string>,
): PartitionedIdentityProjectionRequirements {
  let applicationUser = false;
  let applicationMembership = false;
  let tenantUser = false;
  let tenantMembership = false;
  for (const [name, table] of Object.entries(tables)) {
    const requirements = getGuardianAnchorRequirements(table);
    if (tenantTables.has(name)) {
      tenantUser ||= requirements.includes('user');
      tenantMembership ||= requirements.includes('membership');
    } else {
      applicationUser ||= requirements.includes('user');
      applicationMembership ||= requirements.includes('membership');
    }
  }
  return Object.freeze({
    application: Object.freeze({
      user: applicationUser || applicationMembership,
      membership: applicationMembership,
    }),
    tenant: Object.freeze({
      user: tenantUser || tenantMembership,
      membership: tenantMembership,
    }),
  });
}

function invalidIdentityProjectionConfiguration(
  message: string,
  reason:
    | 'auth-required'
    | 'membership-requires-multi-tenancy'
    | 'reference-schema-invalid',
  details: Readonly<Record<string, string>> = {},
): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message, {
    retryable: false,
    outcome: 'not-started',
    details: {
      component: 'guardian-identity-projection',
      reason,
      ...details,
    },
  });
}
