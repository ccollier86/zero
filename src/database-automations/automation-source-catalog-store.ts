/**
 * automation-source-catalog-store.ts
 *
 * Persists trusted physical automation-source bindings in Zero's system
 * database and exposes bounded restart-recovery scans. It does not derive
 * authority, open Fabric actors, inspect source outboxes, or dispatch effects.
 */

import { DatabaseError, isDatabaseError } from '../databases/database-error';
import { DatabaseRuntime } from '../databases/database-runtime';
import {
  DEFAULT_DATABASE_AUTOMATION_SOURCE_CATALOG_LIMITS,
  type DatabaseAutomationSourceCatalogLimits,
  type DatabaseAutomationSourceRecord,
  type DatabaseAutomationSourceRegistration,
  type DatabaseAutomationSourceRegistrationResult,
  type DatabaseAutomationSourceScanCursor,
  type DatabaseAutomationSourceScanPage,
  type DatabaseAutomationSourceScanRequest,
  type DatabaseAutomationSourceStatusTransition,
} from './automation-source-catalog-contract';
import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_ROW_COLUMNS,
  databaseAutomationSourceCatalogCorrupt,
  decodeDatabaseAutomationSourceCatalogRow,
  type DatabaseAutomationSourceCatalogRow,
} from './automation-source-catalog-row';
import {
  assertDatabaseAutomationSourceCatalogSchema,
  assertDatabaseAutomationSourceCatalogSchemaShape,
  initializeDatabaseAutomationSourceCatalogSchema,
  readDatabaseAutomationSourceCatalogState,
} from './automation-source-catalog-schema';
import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE,
} from './automation-source-catalog-schema-sql';
import {
  DatabaseAutomationSourceCatalogDurability,
} from './automation-source-catalog-durability';
import {
  normalizeDatabaseAutomationSourceCatalogLimits,
  normalizeDatabaseAutomationSourceRegistration,
  normalizeDatabaseAutomationSourceScanRequest,
  normalizeDatabaseAutomationSourceStatusTransition,
  requireDatabaseAutomationCatalogTimestamp,
  requireDatabaseAutomationSourceRef,
} from './automation-source-catalog-validation';

export interface DatabaseAutomationSourceCatalogOptions {
  /** Zero-owned durable system database. Application/tenant planes are rejected. */
  readonly runtime: DatabaseRuntime;
  /** @internal Test/embedding seam; may only lower the schema hard ceiling. */
  readonly limits?: DatabaseAutomationSourceCatalogLimits;
  /** @internal Deterministic timestamp seam. */
  readonly now?: () => number;
}

/** Durable system-plane registry used to discover automation source outboxes. */
export class DatabaseAutomationSourceCatalog {
  readonly #runtime: DatabaseRuntime;
  readonly #limits: DatabaseAutomationSourceCatalogLimits;
  readonly #now: () => number;
  readonly #durability: DatabaseAutomationSourceCatalogDurability;
  #closed = false;

  constructor(options: DatabaseAutomationSourceCatalogOptions) {
    if (!options || typeof options !== 'object'
      || !(options.runtime instanceof DatabaseRuntime)
      || options.runtime.role !== 'system'
      || options.runtime.diagnostics().closed
      || (options.now !== undefined && typeof options.now !== 'function')) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database automation source catalog requires a live system runtime.',
      );
    }
    this.#runtime = options.runtime;
    this.#limits = normalizeDatabaseAutomationSourceCatalogLimits(
      options.limits ?? DEFAULT_DATABASE_AUTOMATION_SOURCE_CATALOG_LIMITS,
    );
    this.#now = options.now ?? Date.now;
    this.#durability = new DatabaseAutomationSourceCatalogDurability(
      this.#runtime,
    );
    initializeDatabaseAutomationSourceCatalogSchema(this.#runtime.db);
  }

  /** Register one trusted physical source or replay its exact existing binding. */
  register(
    input: DatabaseAutomationSourceRegistration,
  ): DatabaseAutomationSourceRegistrationResult {
    this.#assertOpen();
    const registration = normalizeDatabaseAutomationSourceRegistration(input);
    return this.#write(() => {
      this.#assertSchemaShape();
      const state = readDatabaseAutomationSourceCatalogState(this.#runtime.db);
      const existing = this.#readByRef(registration.sourceRef);
      if (existing) {
        if (!sameRegistration(existing, registration)) throw registrationConflict();
        return Object.freeze({
          disposition: 'existing' as const,
          source: existing,
        });
      }

      const logical = this.#readByLogicalIdentity(
        registration.sourceKind,
        registration.logicalSourceId,
      );
      if (logical) throw registrationConflict();
      if (state.totalSources >= this.#limits.maxSources) {
        throw catalogCapacityReached(this.#limits.maxSources);
      }

      const now = requireDatabaseAutomationCatalogTimestamp(this.#now());
      const insert = this.#runtime.db.prepare(`
        INSERT INTO main.${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE} (
          source_ref,
          source_kind,
          logical_source_id,
          scope_kind,
          scope_id,
          tenant_id,
          lifecycle_status,
          source_revision,
          insertion_ordinal,
          registered_at,
          updated_at,
          schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, 1)
      `);
      try {
        insert.run(
          registration.sourceRef,
          registration.sourceKind,
          registration.logicalSourceId,
          registration.authority.scopeKind,
          registration.authority.scopeId,
          registration.authority.tenantId,
          state.lastOrdinal + 1,
          now,
          now,
        );
      } finally {
        insert.finalize();
      }

      const source = this.#readByRef(registration.sourceRef);
      const after = readDatabaseAutomationSourceCatalogState(this.#runtime.db);
      if (!source
        || !sameRegistration(source, registration)
        || source.ordinal !== state.lastOrdinal + 1
        || after.totalSources !== state.totalSources + 1
        || after.lastOrdinal !== source.ordinal
        || after.catalogRevision !== state.catalogRevision + 1) {
        throw databaseAutomationSourceCatalogCorrupt();
      }
      this.#durability.afterMutation();
      return Object.freeze({
        disposition: 'created' as const,
        source,
      });
    });
  }

  /** Read one source by its opaque physical reference. */
  get(sourceRef: string): DatabaseAutomationSourceRecord | null {
    this.#assertOpen();
    const normalized = requireDatabaseAutomationSourceRef(sourceRef);
    return this.#readSnapshot(() => {
      this.#assertSchemaShape();
      return this.#readByRef(normalized);
    });
  }

  /**
   * Apply one optimistic active/disabled transition.
   *
   * Source identities are never deleted or reassigned. A stale revision fails
   * closed so an operator cannot silently overwrite a newer lifecycle choice.
   */
  setStatus(
    input: DatabaseAutomationSourceStatusTransition,
  ): DatabaseAutomationSourceRecord {
    this.#assertOpen();
    const transition = normalizeDatabaseAutomationSourceStatusTransition(input);
    return this.#write(() => {
      this.#assertSchemaShape();
      const state = readDatabaseAutomationSourceCatalogState(this.#runtime.db);
      const current = this.#readByRef(transition.sourceRef);
      if (!current) throw sourceNotFound();
      if (current.revision !== transition.expectedRevision) {
        throw lifecycleConflict();
      }
      if (current.status === transition.status) return current;

      const now = Math.max(
        current.updatedAt,
        requireDatabaseAutomationCatalogTimestamp(this.#now()),
      );
      const update = this.#runtime.db.prepare(`
        UPDATE main.${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
        SET
          lifecycle_status = ?,
          source_revision = source_revision + 1,
          updated_at = ?
        WHERE source_ref = ? AND source_revision = ?
      `);
      try {
        if (update.run(
          transition.status,
          now,
          transition.sourceRef,
          transition.expectedRevision,
        ).changes === 0) throw lifecycleConflict();
      } finally {
        update.finalize();
      }

      const source = this.#readByRef(transition.sourceRef);
      const after = readDatabaseAutomationSourceCatalogState(this.#runtime.db);
      if (!source
        || source.status !== transition.status
        || source.revision !== current.revision + 1
        || after.totalSources !== state.totalSources
        || after.lastOrdinal !== state.lastOrdinal
        || after.catalogRevision !== state.catalogRevision + 1) {
        throw databaseAutomationSourceCatalogCorrupt();
      }
      this.#durability.afterMutation();
      return source;
    });
  }

  /** Return one bounded, revision-fenced recovery page in insertion order. */
  scan(
    input: DatabaseAutomationSourceScanRequest = {},
  ): DatabaseAutomationSourceScanPage {
    this.#assertOpen();
    const request = normalizeDatabaseAutomationSourceScanRequest(input);
    return this.#readSnapshot(() => {
      this.#assertSchemaShape();
      const state = readDatabaseAutomationSourceCatalogState(this.#runtime.db);
      const cursor = request.cursor;
      if (cursor && cursor.catalogRevision !== state.catalogRevision) {
        throw scanRevisionChanged();
      }
      const afterOrdinal = cursor?.afterOrdinal ?? 0;
      const throughOrdinal = cursor?.throughOrdinal ?? state.lastOrdinal;
      const statement = this.#runtime.db.prepare(`
        SELECT ${DATABASE_AUTOMATION_SOURCE_CATALOG_ROW_COLUMNS}
        FROM main.${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
        WHERE insertion_ordinal > ?
          AND insertion_ordinal <= ?
          AND (? = 'all' OR lifecycle_status = ?)
        ORDER BY insertion_ordinal ASC, source_ref ASC
        LIMIT ?
      `);
      let rows: DatabaseAutomationSourceCatalogRow[];
      try {
        rows = statement.all(
          afterOrdinal,
          throughOrdinal,
          request.status,
          request.status,
          request.limit + 1,
        ) as DatabaseAutomationSourceCatalogRow[];
      } finally {
        statement.finalize();
      }
      const hasMore = rows.length > request.limit;
      const selected = hasMore ? rows.slice(0, request.limit) : rows;
      const sources = Object.freeze(
        selected.map(decodeDatabaseAutomationSourceCatalogRow),
      );
      const last = sources.at(-1);
      const nextCursor: DatabaseAutomationSourceScanCursor | null = hasMore && last
        ? Object.freeze({
            version: 1,
            status: request.status,
            afterOrdinal: last.ordinal,
            throughOrdinal,
            catalogRevision: state.catalogRevision,
          })
        : null;
      return Object.freeze({
        sources,
        page: Object.freeze({
          limit: request.limit,
          count: sources.length,
          hasMore,
          nextCursor,
        }),
      });
    });
  }

  /** Perform a complete bounded integrity audit of catalog schema and rows. */
  validate(): void {
    this.#assertOpen();
    assertDatabaseAutomationSourceCatalogSchema(this.#runtime.db);
  }

  /** @internal Prove manager ownership without exposing the system runtime. */
  isBoundToSystemRuntime(runtime: DatabaseRuntime): boolean {
    return !this.#closed
      && !this.#runtime.diagnostics().closed
      && this.#runtime === runtime;
  }

  /** Close this lightweight catalog capability without closing the system DB. */
  close(): void {
    this.#closed = true;
  }

  #readByRef(sourceRef: string): DatabaseAutomationSourceRecord | null {
    const statement = this.#runtime.db.prepare(`
      SELECT ${DATABASE_AUTOMATION_SOURCE_CATALOG_ROW_COLUMNS}
      FROM main.${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
      WHERE source_ref = ?
    `);
    try {
      const row = statement.get(sourceRef) as DatabaseAutomationSourceCatalogRow | null;
      return row ? decodeDatabaseAutomationSourceCatalogRow(row) : null;
    } finally {
      statement.finalize();
    }
  }

  #readByLogicalIdentity(
    sourceKind: DatabaseAutomationSourceRegistration['sourceKind'],
    logicalSourceId: string,
  ): DatabaseAutomationSourceRecord | null {
    const statement = this.#runtime.db.prepare(`
      SELECT ${DATABASE_AUTOMATION_SOURCE_CATALOG_ROW_COLUMNS}
      FROM main.${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
      WHERE source_kind = ? AND logical_source_id = ?
    `);
    try {
      const row = statement.get(
        sourceKind,
        logicalSourceId,
      ) as DatabaseAutomationSourceCatalogRow | null;
      return row ? decodeDatabaseAutomationSourceCatalogRow(row) : null;
    } finally {
      statement.finalize();
    }
  }

  #write<T>(operation: () => T): T {
    try {
      const result = this.#runtime.db.transaction(operation);
      // A root transaction runs the hot post-commit fence synchronously before
      // returning. Surface its committed-but-uncertain outcome to this caller.
      this.#durability.assertHealthy();
      return result;
    } catch (cause) {
      if (isDatabaseError(cause)) throw cause;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database automation source catalog write failed.',
        { cause, retryable: false, outcome: 'not-committed' },
      );
    }
  }

  #readSnapshot<T>(operation: () => T): T {
    try {
      return this.#runtime.db.transaction(operation);
    } catch (cause) {
      if (isDatabaseError(cause)) throw cause;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database automation source catalog scan failed.',
        { cause, retryable: true, outcome: 'not-started' },
      );
    }
  }

  #assertSchemaShape(): void {
    assertDatabaseAutomationSourceCatalogSchemaShape(this.#runtime.db);
  }

  #assertOpen(): void {
    if (this.#closed || this.#runtime.diagnostics().closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database automation source catalog is closed.',
      );
    }
    this.#durability.assertHealthy();
  }
}

function sameRegistration(
  source: DatabaseAutomationSourceRecord,
  registration: DatabaseAutomationSourceRegistration,
): boolean {
  return source.sourceRef === registration.sourceRef
    && source.sourceKind === registration.sourceKind
    && source.logicalSourceId === registration.logicalSourceId
    && source.authority.scopeKind === registration.authority.scopeKind
    && source.authority.scopeId === registration.authority.scopeId
    && source.authority.tenantId === registration.authority.tenantId;
}

function catalogCapacityReached(limit: number): DatabaseError {
  return new DatabaseError(
    'DATABASE_CAPACITY_EXHAUSTED',
    'Database automation source catalog capacity is exhausted.',
    { details: { limit } },
  );
}

function registrationConflict(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFLICT',
    'Database automation source is already registered with another identity.',
    {
      retryable: false,
      outcome: 'not-committed',
      details: { conflictType: 'automation-source-registration' },
    },
  );
}

function sourceNotFound(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_INVALID',
    'Database automation source is not registered.',
  );
}

function lifecycleConflict(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFLICT',
    'Database automation source lifecycle revision changed.',
    {
      retryable: false,
      outcome: 'not-committed',
      details: { conflictType: 'automation-source-lifecycle' },
    },
  );
}

function scanRevisionChanged(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFLICT',
    'Database automation source catalog changed during recovery.',
    {
      retryable: true,
      outcome: 'not-started',
      details: { conflictType: 'automation-source-scan-revision' },
    },
  );
}
