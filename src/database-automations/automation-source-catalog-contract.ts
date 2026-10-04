/**
 * automation-source-catalog-contract.ts
 *
 * Defines the trusted system-plane identity and pagination contracts for
 * durable automation sources. This file owns bounded value shapes only; it
 * does not open databases, derive tenant authority, or dispatch effects.
 */

/** Current private catalog schema version. */
export const DATABASE_AUTOMATION_SOURCE_CATALOG_SCHEMA_VERSION = 1 as const;

/** Permanent hard ceiling enforced by the private SQLite schema. */
export const DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES = 100_000;

/** Default number of source records returned by one recovery page. */
export const DATABASE_AUTOMATION_SOURCE_CATALOG_DEFAULT_PAGE_SIZE = 100;

/** Largest source page accepted by the catalog boundary. */
export const DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_PAGE_SIZE = 500;

/** Stable physical source categories understood by Fabric recovery. */
export type DatabaseAutomationSourceKind =
  | 'application'
  | 'tenant'
  | 'named';

/** Durable lifecycle state. Disabled sources remain reserved and immutable. */
export type DatabaseAutomationSourceStatus = 'active' | 'disabled';

/** Filter used by deterministic recovery scans. */
export type DatabaseAutomationSourceStatusFilter =
  | DatabaseAutomationSourceStatus
  | 'all';

/** Trusted authority projection persisted independently of row payloads. */
export type DatabaseAutomationSourceAuthority = Readonly<
  | {
      readonly scopeKind: 'application';
      readonly scopeId: 'application';
      readonly tenantId: null;
    }
  | {
      readonly scopeKind: 'tenant';
      readonly scopeId: string;
      readonly tenantId: string;
    }
>;

/**
 * Exact source registration supplied by trusted database routing code.
 *
 * `sourceRef` is the stable opaque physical database reference. Tenant
 * identity is retained only in this system-plane catalog and never inferred
 * from a changed application row.
 */
export type DatabaseAutomationSourceRegistration = Readonly<
  | {
      readonly sourceRef: string;
      readonly sourceKind: 'application';
      readonly logicalSourceId: 'application';
      readonly authority: Readonly<{
        readonly scopeKind: 'application';
        readonly scopeId: 'application';
        readonly tenantId: null;
      }>;
    }
  | {
      readonly sourceRef: string;
      readonly sourceKind: 'named';
      readonly logicalSourceId: string;
      readonly authority: Readonly<{
        readonly scopeKind: 'application';
        readonly scopeId: 'application';
        readonly tenantId: null;
      }>;
    }
  | {
      readonly sourceRef: string;
      readonly sourceKind: 'tenant';
      readonly logicalSourceId: string;
      readonly authority: Readonly<{
        readonly scopeKind: 'tenant';
        readonly scopeId: string;
        readonly tenantId: string;
      }>;
    }
>;

/** Canonical durable catalog record returned to recovery coordinators. */
export interface DatabaseAutomationSourceRecord {
  readonly sourceRef: string;
  readonly sourceKind: DatabaseAutomationSourceKind;
  readonly logicalSourceId: string;
  readonly authority: DatabaseAutomationSourceAuthority;
  readonly status: DatabaseAutomationSourceStatus;
  readonly revision: number;
  readonly ordinal: number;
  readonly registeredAt: number;
  readonly updatedAt: number;
}

/** Result of an exact, idempotent registration attempt. */
export interface DatabaseAutomationSourceRegistrationResult {
  readonly disposition: 'created' | 'existing';
  readonly source: DatabaseAutomationSourceRecord;
}

/** Optimistic lifecycle transition for one already registered source. */
export interface DatabaseAutomationSourceStatusTransition {
  readonly sourceRef: string;
  readonly expectedRevision: number;
  readonly status: DatabaseAutomationSourceStatus;
}

/**
 * Snapshot fence carried between catalog pages.
 *
 * Any registration or lifecycle transition advances `catalogRevision`; a
 * later page then fails closed so recovery restarts from a coherent boundary.
 */
export interface DatabaseAutomationSourceScanCursor {
  readonly version: 1;
  readonly status: DatabaseAutomationSourceStatusFilter;
  readonly afterOrdinal: number;
  readonly throughOrdinal: number;
  readonly catalogRevision: number;
}

/** Bounded deterministic recovery scan request. */
export interface DatabaseAutomationSourceScanRequest {
  readonly status?: DatabaseAutomationSourceStatusFilter;
  readonly limit?: number;
  readonly cursor?: DatabaseAutomationSourceScanCursor | null;
}

/** One bounded recovery page. */
export interface DatabaseAutomationSourceScanPage {
  readonly sources: readonly DatabaseAutomationSourceRecord[];
  readonly page: Readonly<{
    readonly limit: number;
    readonly count: number;
    readonly hasMore: boolean;
    readonly nextCursor: DatabaseAutomationSourceScanCursor | null;
  }>;
}

/** Runtime limits; callers may only lower the permanent schema ceiling. */
export interface DatabaseAutomationSourceCatalogLimits {
  readonly maxSources: number;
}

/** Default production catalog limit. */
export const DEFAULT_DATABASE_AUTOMATION_SOURCE_CATALOG_LIMITS = Object.freeze({
  maxSources: DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES,
}) satisfies DatabaseAutomationSourceCatalogLimits;
