/**
 * Durable ReactiveDB change-log ownership.
 *
 * This is the only module that installs, validates, allocates, appends, prunes,
 * snapshots, or finalizes the protected `_changes` log and its schema fences.
 */

import type { Database } from 'bun:sqlite';
import {
  CHANGE_LOG_FORMAT_VERSION,
  CHANGE_LOG_MIN_READER_FORMAT,
  CHANGE_LOG_SCHEMA_VERSION,
  isNonNegativeSafeInteger,
  validateChangeLogStateRow,
  validateRetainedChangeRows,
  validateRetainedHistory,
  type ChangeLogStateRow,
} from './reactive-db-change-codec';
import { normalizeSchemaSql } from './reactive-db-table-contract';
import type { Change, ChangeRow, ChangeStatements } from './types';

const CHANGE_LOG_SENTINEL_TABLE = '_zero_sync_fence';
const CHANGE_LOG_SENTINEL_ROW_ID = 'format-v1';
export const CHANGE_LOG_STATE_TABLE = '_zero_sync_log_state';
export const LEGACY_CHANGE_SEQUENCE_TABLE = '_change_sequence';

const CHANGE_LOG_TRIGGER_SQL = Object.freeze({
  insert: `
    CREATE TRIGGER _zero_sync_changes_insert_fence_v1
    BEFORE INSERT ON main._changes
    WHEN CASE
      WHEN NEW.seq > 0
        AND typeof(NEW.format_version) = 'integer'
        AND NEW.format_version = 1
        AND NEW.op COLLATE BINARY IN ('INSERT', 'UPDATE', 'DELETE')
        AND NOT EXISTS (SELECT 1 FROM main._changes WHERE seq = NEW.seq)
        AND EXISTS (
          SELECT 1 FROM main._zero_sync_log_state
          WHERE singleton = 1
            AND schema_version = 1
            AND write_format = 1
            AND min_reader_format = 0
            AND seq = NEW.seq
        )
      THEN 0
      ELSE 1
    END = 1
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    END
  `,
  update: `
    CREATE TRIGGER _zero_sync_changes_update_fence_v1
    BEFORE UPDATE ON main._changes
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_IMMUTABLE');
    END
  `,
  delete: `
    CREATE TRIGGER _zero_sync_changes_delete_fence_v1
    BEFORE DELETE ON main._changes
    WHEN OLD.seq = 0 OR NOT EXISTS (
      SELECT 1 FROM main._zero_sync_log_state
      WHERE singleton = 1
        AND schema_version = 1
        AND write_format = 1
        AND min_reader_format = 0
        AND OLD.seq > 0
        AND OLD.seq <= prune_through
    )
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_DELETE_FORBIDDEN');
    END
  `,
  stateInsert: `
    CREATE TRIGGER _zero_sync_log_state_insert_fence_v1
    BEFORE INSERT ON main._zero_sync_log_state
    WHEN EXISTS (SELECT 1 FROM main._zero_sync_log_state WHERE singleton = 1)
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_STATE_INVALID');
    END
  `,
  stateUpdate: `
    CREATE TRIGGER _zero_sync_log_state_update_fence_v1
    BEFORE UPDATE ON main._zero_sync_log_state
    WHEN
      NEW.singleton <> 1
      OR typeof(NEW.schema_version) <> 'integer'
      OR typeof(NEW.write_format) <> 'integer'
      OR typeof(NEW.min_reader_format) <> 'integer'
      OR typeof(NEW.seq) <> 'integer'
      OR typeof(NEW.prune_through) <> 'integer'
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.write_format <> OLD.write_format
      OR NEW.min_reader_format <> OLD.min_reader_format
      OR NEW.seq < OLD.seq
      OR NEW.seq > 9007199254740991
      OR NEW.prune_through < OLD.prune_through
      OR NEW.prune_through > NEW.seq
      OR NOT (
        (NEW.seq = OLD.seq + 1 AND NEW.prune_through = OLD.prune_through)
        OR (NEW.seq = OLD.seq AND NEW.prune_through >= OLD.prune_through)
      )
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_STATE_INVALID');
    END
  `,
  stateDelete: `
    CREATE TRIGGER _zero_sync_log_state_delete_fence_v1
    BEFORE DELETE ON main._zero_sync_log_state
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_STATE_INVALID');
    END
  `,
  legacySequenceInsert: `
    CREATE TRIGGER _zero_sync_legacy_sequence_insert_fence_v1
    BEFORE INSERT ON main._change_sequence
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    END
  `,
  legacySequenceUpdate: `
    CREATE TRIGGER _zero_sync_legacy_sequence_update_fence_v1
    BEFORE UPDATE ON main._change_sequence
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    END
  `,
  legacySequenceDelete: `
    CREATE TRIGGER _zero_sync_legacy_sequence_delete_fence_v1
    BEFORE DELETE ON main._change_sequence
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    END
  `,
});

const CHANGE_LOG_TRIGGER_DEFINITIONS = Object.freeze([
  ['_zero_sync_changes_insert_fence_v1', CHANGE_LOG_TRIGGER_SQL.insert],
  ['_zero_sync_changes_update_fence_v1', CHANGE_LOG_TRIGGER_SQL.update],
  ['_zero_sync_changes_delete_fence_v1', CHANGE_LOG_TRIGGER_SQL.delete],
  ['_zero_sync_log_state_insert_fence_v1', CHANGE_LOG_TRIGGER_SQL.stateInsert],
  ['_zero_sync_log_state_update_fence_v1', CHANGE_LOG_TRIGGER_SQL.stateUpdate],
  ['_zero_sync_log_state_delete_fence_v1', CHANGE_LOG_TRIGGER_SQL.stateDelete],
  ['_zero_sync_legacy_sequence_insert_fence_v1', CHANGE_LOG_TRIGGER_SQL.legacySequenceInsert],
  ['_zero_sync_legacy_sequence_update_fence_v1', CHANGE_LOG_TRIGGER_SQL.legacySequenceUpdate],
  ['_zero_sync_legacy_sequence_delete_fence_v1', CHANGE_LOG_TRIGGER_SQL.legacySequenceDelete],
] as const);

export interface ChangeLogReadSnapshot {
  state: ChangeLogStateRow;
  rows: ChangeRow[];
  oldestSeq: number;
  contiguous: boolean;
}

export interface ChangeLogReadPage extends ChangeLogReadSnapshot {
  /** True when the durable head contains rows beyond this bounded page. */
  hasMore: boolean;
}

export interface SQLiteSchemaVersions {
  main: number;
  temp: number;
}

interface ReactiveDBChangeLogOptions {
  clearChangesOnStart: boolean;
  ringBufferDepth: number;
  validateManagedTableSchemas: () => void;
}

export class ReactiveDBChangeLog {
  private readonly statements: ChangeStatements;
  private validatedSchemaVersions: SQLiteSchemaVersions;

  constructor(
    private readonly database: Database,
    private readonly options: ReactiveDBChangeLogOptions,
  ) {
    this.install();
    this.statements = this.prepareStatements();
    this.validatedSchemaVersions = this.readSchemaVersions();
  }

  get currentSequence(): number {
    return this.currentState().seq;
  }

  currentState(): ChangeLogStateRow {
    return validateChangeLogStateRow(
      this.statements.current.get() as ChangeLogStateRow | null,
    );
  }

  allocateSequence(): number {
    const row = this.statements.allocate.get() as { seq: number } | null;
    if (!row) {
      throw new Error('ReactiveDB change sequence is not initialized');
    }
    return row.seq;
  }

  record(change: Change, writerEpoch: string): void {
    const data = change.row !== null ? JSON.stringify(change.row) : null;
    const previousData = change.previousRow !== null
      ? JSON.stringify(change.previousRow)
      : null;

    const stateBeforeInsert = this.currentState();
    if (stateBeforeInsert.seq !== change.seq) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: allocated sequence changed before change recording',
      );
    }

    const inserted = this.statements.insert.get(
      change.seq,
      change.table,
      change.op,
      change.rowId,
      data,
      previousData,
      change.ts,
      writerEpoch,
      CHANGE_LOG_FORMAT_VERSION,
    ) as { seq: number } | null;
    if (inserted?.seq !== change.seq) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: durable change row was not recorded');
    }
    const stateAfterInsert = this.currentState();
    if (stateAfterInsert.seq !== stateBeforeInsert.seq
      || stateAfterInsert.prune_through !== stateBeforeInsert.prune_through) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: durable log state changed during change recording',
      );
    }
    const cutoff = change.seq - this.options.ringBufferDepth;
    if (cutoff <= 0) return;

    const expectedPruneThrough = Math.max(
      stateAfterInsert.prune_through,
      cutoff,
    );
    this.statements.advancePrune.run(cutoff);
    const state = this.currentState();
    if (state.seq !== change.seq
      || state.prune_through !== expectedPruneThrough) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: durable prune watermark was not advanced exactly',
      );
    }
    this.statements.prune.run(state.prune_through);
    const stateAfterPrune = this.currentState();
    if (stateAfterPrune.seq !== change.seq
      || stateAfterPrune.prune_through !== expectedPruneThrough) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: durable log state changed during pruning',
      );
    }
    if (this.statements.unprunedThrough.get(stateAfterPrune.prune_through)) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: retained change rows were not pruned',
      );
    }
  }

  readSnapshot(afterSeq: number, insideWriteTransaction: boolean): ChangeLogReadSnapshot {
    const read = (): ChangeLogReadSnapshot => {
      const state = this.currentState();
      const rows = this.statements.after.all(afterSeq) as ChangeRow[];
      const oldest = this.statements.oldest.get() as { min_seq: number | null } | null;
      const oldestSeq = oldest?.min_seq ?? state.seq;
      let contiguous = afterSeq >= state.prune_through && afterSeq <= state.seq;
      if (contiguous) {
        const expectedCount = state.seq - afterSeq;
        contiguous = rows.length === expectedCount;
        for (let index = 0; contiguous && index < rows.length; index += 1) {
          contiguous = rows[index]!.seq === afterSeq + index + 1;
        }
      }
      return { state, rows, oldestSeq, contiguous };
    };

    return insideWriteTransaction
      ? read()
      : this.database.transaction(read).deferred();
  }

  readPage(
    afterSeq: number,
    maxRows: number,
    insideWriteTransaction: boolean,
  ): ChangeLogReadPage {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
      throw new Error('ReactiveDB change page size must be a positive safe integer');
    }
    const read = (): ChangeLogReadPage => {
      const state = this.currentState();
      const rows = this.statements.afterPage.all(afterSeq, maxRows) as ChangeRow[];
      const oldest = this.statements.oldest.get() as { min_seq: number | null } | null;
      const oldestSeq = oldest?.min_seq ?? state.seq;
      const available = afterSeq <= state.seq ? state.seq - afterSeq : 0;
      const expectedCount = Math.min(available, maxRows);
      let contiguous = afterSeq >= state.prune_through
        && afterSeq <= state.seq
        && rows.length === expectedCount;
      for (let index = 0; contiguous && index < rows.length; index += 1) {
        contiguous = rows[index]!.seq === afterSeq + index + 1;
      }
      return {
        state,
        rows,
        oldestSeq,
        contiguous,
        hasMore: contiguous && available > rows.length,
      };
    };

    return insideWriteTransaction
      ? read()
      : this.database.transaction(read).deferred();
  }

  readSchemaVersions(): SQLiteSchemaVersions {
    const main = this.statements.mainSchemaVersion.get() as {
      schema_version: number;
    } | null;
    const temp = this.statements.tempSchemaVersion.get() as {
      schema_version: number;
    } | null;
    if (!main || !Number.isSafeInteger(main.schema_version)
      || !temp || !Number.isSafeInteger(temp.schema_version)) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: schema version is unavailable');
    }
    return { main: main.schema_version, temp: temp.schema_version };
  }

  /** Validate every schema invariant affected between two observed versions. */
  validateSchemaFence(
    previous: SQLiteSchemaVersions,
    observed: SQLiteSchemaVersions,
  ): SQLiteSchemaVersions {
    this.validateTriggers();
    if (observed.main !== previous.main) {
      this.options.validateManagedTableSchemas();
    }
    const validated = this.readSchemaVersions();
    if (validated.main !== observed.main || validated.temp !== observed.temp) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: schema changed during schema-fence validation',
      );
    }
    return validated;
  }

  assertSchemaFence(): SQLiteSchemaVersions {
    const versions = this.readSchemaVersions();
    if (versions.main !== this.validatedSchemaVersions.main
      || versions.temp !== this.validatedSchemaVersions.temp) {
      const validated = this.validateSchemaFence(
        this.validatedSchemaVersions,
        versions,
      );
      // Entry audits observe already-committed external DDL and are safe to
      // cache immediately. DDL in the active transaction gets a final audit.
      this.validatedSchemaVersions = validated;
      return validated;
    }
    return versions;
  }

  commitSchemaVersions(versions: SQLiteSchemaVersions): void {
    this.validatedSchemaVersions = versions;
  }

  dispose(): void {
    this.statements.insert.finalize();
    this.statements.mainSchemaVersion.finalize();
    this.statements.tempSchemaVersion.finalize();
    this.statements.allocate.finalize();
    this.statements.current.finalize();
    this.statements.advancePrune.finalize();
    this.statements.prune.finalize();
    this.statements.unprunedThrough.finalize();
    this.statements.after.finalize();
    this.statements.afterPage.finalize();
    this.statements.oldest.finalize();
  }

  private install(): void {
    this.database.transaction(() => {
      const existingStateType = this.sqliteObjectType(CHANGE_LOG_STATE_TABLE);
      if (existingStateType && existingStateType !== 'table') {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: state object is not a table');
      }
      const existingChangesType = this.sqliteObjectType('_changes');
      if (existingChangesType && existingChangesType !== 'table') {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: _changes is not a table');
      }

      this.database.run(`
        CREATE TABLE IF NOT EXISTS main._changes (
          seq     INTEGER PRIMARY KEY,
          tbl     TEXT NOT NULL,
          op      TEXT NOT NULL,
          row_id  TEXT NOT NULL,
          data    TEXT,
          previous_data TEXT,
          ts      INTEGER NOT NULL,
          origin  TEXT,
          format_version
        )
      `);

      const columns = this.database.prepare('PRAGMA main.table_info(_changes)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }>;
      if (!columns.some((column) => column.name === 'previous_data')) {
        this.database.run('ALTER TABLE main._changes ADD COLUMN previous_data TEXT');
      }
      if (!columns.some((column) => column.name === 'origin')) {
        this.database.run('ALTER TABLE main._changes ADD COLUMN origin TEXT');
      }
      const formatColumn = columns.find((column) => column.name === 'format_version');
      if (!formatColumn) {
        // Nullable and without affinity/default so legacy rows and text `1`
        // remain distinguishable from the integer v1 format marker.
        this.database.run('ALTER TABLE main._changes ADD COLUMN format_version');
      } else if (formatColumn.type !== ''
        || formatColumn.notnull !== 0
        || formatColumn.dflt_value !== null) {
        throw new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: format_version must be nullable without affinity/default',
        );
      }
      this.validateChangesTableSchema();

      const negativeSequence = this.database.prepare(
        'SELECT seq FROM main._changes WHERE seq < 0 LIMIT 1',
      ).get() as { seq: number } | null;
      if (negativeSequence) {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: negative change sequence');
      }

      const retainedRows = this.database.prepare(
        `SELECT *, typeof(format_version) AS format_version_type
         FROM main._changes WHERE seq > 0 ORDER BY seq`,
      ).all() as ChangeRow[];
      validateRetainedChangeRows(retainedRows);

      if (existingStateType) {
        const state = this.readAndValidateState();
        this.validateSentinel();
        this.validateTriggers();
        validateRetainedHistory(state, retainedRows);

        if (this.options.clearChangesOnStart) this.clearRetainedRows();
        return;
      }

      const existingSentinel = this.database.prepare(
        'SELECT seq FROM main._changes WHERE seq = 0',
      ).get();
      if (existingSentinel) {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: reserved change sequence 0 already exists');
      }

      const legacySequence = this.readLegacySequence();
      const newestRetained = retainedRows.at(-1)?.seq ?? 0;
      let durableSequence = newestRetained;
      if (legacySequence !== null) {
        if (legacySequence > newestRetained && retainedRows.length > 0) {
          throw new Error(
            'ZERO_SYNC_LOG_STATE_INVALID: durable sequence is ahead of retained history',
          );
        }
        durableSequence = Math.max(legacySequence, newestRetained);
      }
      const pruneThrough = retainedRows.length > 0
        ? retainedRows[0]!.seq - 1
        : durableSequence;

      this.database.run(`
        CREATE TABLE main.${CHANGE_LOG_STATE_TABLE} (
          singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
          schema_version    INTEGER NOT NULL,
          write_format      INTEGER NOT NULL,
          min_reader_format INTEGER NOT NULL,
          seq               INTEGER NOT NULL CHECK (
            seq >= 0 AND seq <= 9007199254740991
          ),
          prune_through     INTEGER NOT NULL CHECK (
            prune_through >= 0 AND prune_through <= seq
          )
        ) STRICT
      `);
      this.database.prepare(`
        INSERT INTO main.${CHANGE_LOG_STATE_TABLE}
          (singleton, schema_version, write_format, min_reader_format, seq, prune_through)
        VALUES (1, ?, ?, ?, ?, ?)
      `).run(
        CHANGE_LOG_SCHEMA_VERSION,
        CHANGE_LOG_FORMAT_VERSION,
        CHANGE_LOG_MIN_READER_FORMAT,
        durableSequence,
        pruneThrough,
      );

      this.database.prepare(`
        INSERT INTO main._changes
          (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
        VALUES (0, ?, 'INSERT', ?, NULL, NULL, 0, NULL, ?)
      `).run(
        CHANGE_LOG_SENTINEL_TABLE,
        CHANGE_LOG_SENTINEL_ROW_ID,
        CHANGE_LOG_FORMAT_VERSION,
      );

      // Preserve a poisoned legacy allocator object. Fence-aware code never
      // reads it; intermediate/pre-fence allocators fail before serving.
      const legacyType = this.sqliteObjectType(LEGACY_CHANGE_SEQUENCE_TABLE);
      if (legacyType && legacyType !== 'table') {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence object is not a table');
      }
      this.database.run(`
        CREATE TABLE IF NOT EXISTS main.${LEGACY_CHANGE_SEQUENCE_TABLE} (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          seq       INTEGER NOT NULL CHECK (seq >= 0)
        )
      `);
      const legacyRows = this.database.prepare(
        `SELECT singleton, seq FROM main.${LEGACY_CHANGE_SEQUENCE_TABLE}`,
      ).all() as Array<{ singleton: number; seq: number }>;
      if (legacyRows.length === 0) {
        this.database.prepare(
          `INSERT INTO main.${LEGACY_CHANGE_SEQUENCE_TABLE} (singleton, seq) VALUES (1, ?)`,
        ).run(durableSequence);
      } else if (legacyRows.length !== 1
        || legacyRows[0]!.singleton !== 1
        || !isNonNegativeSafeInteger(legacyRows[0]!.seq)) {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence row is malformed');
      }

      for (const [, sql] of CHANGE_LOG_TRIGGER_DEFINITIONS) this.database.run(sql);

      if (this.options.clearChangesOnStart) this.clearRetainedRows();

      this.readAndValidateState();
      this.validateSentinel();
      this.validateTriggers();
      validateRetainedHistory(
        this.readAndValidateState(),
        this.database.prepare(
          `SELECT *, typeof(format_version) AS format_version_type
           FROM main._changes WHERE seq > 0 ORDER BY seq`,
        ).all() as ChangeRow[],
      );
    }).immediate();
  }

  private clearRetainedRows(): void {
    // Clearing replay history never reuses a cursor. Older cursors fall behind
    // prune_through and therefore require an authoritative snapshot.
    this.database.run(`
      UPDATE main.${CHANGE_LOG_STATE_TABLE}
      SET prune_through = seq
      WHERE singleton = 1
    `);
    this.database.run('DELETE FROM main._changes WHERE seq > 0');
  }

  private prepareStatements(): ChangeStatements {
    return {
      mainSchemaVersion: this.database.prepare('PRAGMA main.schema_version'),
      tempSchemaVersion: this.database.prepare('PRAGMA temp.schema_version'),
      allocate: this.database.prepare(
        `UPDATE main.${CHANGE_LOG_STATE_TABLE} SET seq = seq + 1 ` +
        'WHERE singleton = 1 RETURNING seq',
      ),
      current: this.database.prepare(
        `SELECT singleton, schema_version, write_format, min_reader_format, seq, prune_through ` +
        `FROM main.${CHANGE_LOG_STATE_TABLE} WHERE singleton = 1`,
      ),
      insert: this.database.prepare(
        'INSERT INTO main._changes ' +
        '(seq, tbl, op, row_id, data, previous_data, ts, origin, format_version) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq',
      ),
      advancePrune: this.database.prepare(
        `UPDATE main.${CHANGE_LOG_STATE_TABLE} ` +
        'SET prune_through = MAX(prune_through, ?) WHERE singleton = 1',
      ),
      prune: this.database.prepare('DELETE FROM main._changes WHERE seq > 0 AND seq <= ?'),
      unprunedThrough: this.database.prepare(
        'SELECT seq FROM main._changes WHERE seq > 0 AND seq <= ? LIMIT 1',
      ),
      after: this.database.prepare(
        `SELECT *, typeof(format_version) AS format_version_type
         FROM main._changes WHERE seq > 0 AND seq > ? ORDER BY seq`,
      ),
      afterPage: this.database.prepare(
        `SELECT *, typeof(format_version) AS format_version_type
         FROM main._changes WHERE seq > 0 AND seq > ? ORDER BY seq LIMIT ?`,
      ),
      oldest: this.database.prepare(
        'SELECT MIN(seq) AS min_seq FROM main._changes WHERE seq > 0',
      ),
    };
  }

  private validateChangesTableSchema(): void {
    type Column = {
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
      hidden: number;
    };
    const columns = this.database.prepare('PRAGMA main.table_xinfo(_changes)').all() as Column[];
    const expected = new Map<string, Omit<Column, 'name'>>([
      ['seq', { type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1, hidden: 0 }],
      ['tbl', { type: 'TEXT', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }],
      ['op', { type: 'TEXT', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }],
      ['row_id', { type: 'TEXT', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }],
      ['data', { type: 'TEXT', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
      ['previous_data', { type: 'TEXT', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
      ['ts', { type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }],
      ['origin', { type: 'TEXT', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
      ['format_version', { type: '', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
    ]);
    const compatible = columns.length === expected.size && columns.every((column) => {
      const contract = expected.get(column.name);
      return Boolean(contract)
        && column.type.toUpperCase() === contract!.type
        && column.notnull === contract!.notnull
        && column.dflt_value === contract!.dflt_value
        && column.pk === contract!.pk
        && column.hidden === contract!.hidden;
    });
    const definition = this.database.prepare(
      "SELECT sql FROM main.sqlite_schema WHERE type = 'table' AND name = '_changes' COLLATE BINARY",
    ).get() as { sql: string | null } | null;
    const indexes = this.database.prepare('PRAGMA main.index_list(_changes)').all() as Array<{
      origin: string;
    }>;
    const hasNonCanonicalDefinition = !definition?.sql
      || /\bcollate\b/iu.test(definition.sql)
      || /\bautoincrement\b/iu.test(definition.sql)
      || indexes.length > 0;
    if (!compatible || hasNonCanonicalDefinition) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: _changes schema is incompatible');
    }
  }

  private sqliteObjectType(name: string): string | null {
    const row = this.database.prepare(
      'SELECT type FROM main.sqlite_schema WHERE name = ? COLLATE BINARY',
    ).get(name) as { type: string } | null;
    return row?.type ?? null;
  }

  private readLegacySequence(): number | null {
    const type = this.sqliteObjectType(LEGACY_CHANGE_SEQUENCE_TABLE);
    if (!type) return null;
    if (type !== 'table') {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence object is not a table');
    }
    const columns = this.database.prepare(
      `PRAGMA main.table_info(${LEGACY_CHANGE_SEQUENCE_TABLE})`,
    ).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'singleton')
      || !columns.some((column) => column.name === 'seq')) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence schema is malformed');
    }
    const rows = this.database.prepare(
      `SELECT singleton, seq FROM main.${LEGACY_CHANGE_SEQUENCE_TABLE}`,
    ).all() as Array<{ singleton: number; seq: number }>;
    if (rows.length === 0) return 0;
    if (rows.length !== 1
      || rows[0]!.singleton !== 1
      || !isNonNegativeSafeInteger(rows[0]!.seq)) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence row is malformed');
    }
    return rows[0]!.seq;
  }

  private readAndValidateState(): ChangeLogStateRow {
    const table = this.database.prepare(
      `PRAGMA main.table_list(${JSON.stringify(CHANGE_LOG_STATE_TABLE)})`,
    ).get() as { type?: string; strict?: number } | null;
    if (!table || table.type !== 'table' || table.strict !== 1) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: log state table must be STRICT');
    }
    const rows = this.database.prepare(`
      SELECT singleton, schema_version, write_format, min_reader_format, seq, prune_through,
        typeof(singleton) AS singleton_type,
        typeof(schema_version) AS schema_version_type,
        typeof(write_format) AS write_format_type,
        typeof(min_reader_format) AS min_reader_format_type,
        typeof(seq) AS seq_type,
        typeof(prune_through) AS prune_through_type
      FROM main.${CHANGE_LOG_STATE_TABLE}
    `).all() as Array<ChangeLogStateWithTypes>;
    const row = rows[0];
    if (rows.length !== 1
      || !row
      || row.singleton !== 1
      || row.singleton_type !== 'integer'
      || row.schema_version_type !== 'integer'
      || row.write_format_type !== 'integer'
      || row.min_reader_format_type !== 'integer'
      || row.seq_type !== 'integer'
      || row.prune_through_type !== 'integer'
      || row.schema_version !== CHANGE_LOG_SCHEMA_VERSION
      || row.write_format !== CHANGE_LOG_FORMAT_VERSION
      || row.min_reader_format !== CHANGE_LOG_MIN_READER_FORMAT
      || !isNonNegativeSafeInteger(row.seq)
      || !isNonNegativeSafeInteger(row.prune_through)
      || row.prune_through > row.seq) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: unsupported or malformed log state');
    }
    return validateChangeLogStateRow(row);
  }

  private validateSentinel(): void {
    const rows = this.database.prepare(
      `SELECT *, typeof(format_version) AS format_version_type
       FROM main._changes WHERE seq = 0`,
    ).all() as ChangeRow[];
    const row = rows[0];
    if (rows.length !== 1
      || !row
      || row.tbl !== CHANGE_LOG_SENTINEL_TABLE
      || row.op !== 'INSERT'
      || row.row_id !== CHANGE_LOG_SENTINEL_ROW_ID
      || row.data !== null
      || (row.previous_data ?? null) !== null
      || row.ts !== 0
      || (row.origin ?? null) !== null
      || row.format_version !== CHANGE_LOG_FORMAT_VERSION
      || row.format_version_type !== 'integer') {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: change-log sentinel is malformed');
    }
  }

  private validateTriggers(): void {
    const ownedTables = [
      '_changes',
      CHANGE_LOG_STATE_TABLE,
      LEGACY_CHANGE_SEQUENCE_TABLE,
    ];
    const installed = this.database.prepare(`
      SELECT name, sql
      FROM main.sqlite_schema
      WHERE type = 'trigger'
        AND lower(tbl_name) IN (lower(?), lower(?), lower(?))
      ORDER BY name
    `).all(...ownedTables) as Array<{ name: string; sql: string | null }>;
    const expected = new Map<string, string>(CHANGE_LOG_TRIGGER_DEFINITIONS.map(
      ([name, sql]) => [name, normalizeSchemaSql(sql)] as const,
    ));
    const expectedNames = [...expected.keys()].sort();
    if (installed.length !== expected.size
      || installed.some((row, index) => row.name !== expectedNames[index])) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: owned log trigger set is incompatible');
    }
    for (const row of installed) {
      if (!row.sql || normalizeSchemaSql(row.sql) !== expected.get(row.name)) {
        throw new Error(
          `ZERO_SYNC_LOG_STATE_INVALID: trigger ${row.name} is missing or altered`,
        );
      }
    }
    const tempInstalled = this.database.prepare(`
      SELECT name
      FROM temp.sqlite_schema
      WHERE type = 'trigger'
        AND lower(tbl_name) IN (lower(?), lower(?), lower(?))
      LIMIT 1
    `).get(...ownedTables) as { name: string } | null;
    if (tempInstalled) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: temporary owned log trigger is incompatible');
    }
  }
}

type ChangeLogStateWithTypes = ChangeLogStateRow & Record<
  | 'singleton_type'
  | 'schema_version_type'
  | 'write_format_type'
  | 'min_reader_format_type'
  | 'seq_type'
  | 'prune_through_type',
  string | number
>;
