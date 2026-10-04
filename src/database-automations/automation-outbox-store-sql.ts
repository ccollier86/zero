/**
 * automation-outbox-store-sql.ts
 *
 * Prepares the fixed SQL used by the durable automation outbox store. It owns
 * statement text only; validation, transactions, and lifecycle policy remain
 * in the store.
 */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { DATABASE_AUTOMATION_OUTBOX_ROW_COLUMNS } from './automation-outbox-row';
import {
  DATABASE_AUTOMATION_OUTBOX_STATE_TABLE,
  DATABASE_AUTOMATION_OUTBOX_TABLE,
} from './automation-outbox-schema-sql';

export interface DatabaseAutomationOutboxStatements {
  readonly byId: Statement;
  readonly state: Statement;
  readonly insert: Statement;
  readonly nextDue: Statement;
  readonly claim: Statement;
  readonly complete: Statement;
  readonly retry: Statement;
  readonly dead: Statement;
  readonly extendLease: Statement;
  readonly recoverDead: Statement;
  readonly recoverPending: Statement;
  readonly compactTerminal: Statement;
  readonly statusCounts: Statement;
  readonly activeRealmMismatch: Statement;
  readonly all: readonly Statement[];
}

/** Prepare every private outbox statement as one disposable collection. */
export function prepareDatabaseAutomationOutboxStatements(
  db: ReactiveDB,
): DatabaseAutomationOutboxStatements {
  const all: Statement[] = [];
  const prepare = (sql: string): Statement => {
    const statement = db.prepare(sql);
    all.push(statement);
    return statement;
  };
  try {
    const byId = prepare(`
    SELECT ${DATABASE_AUTOMATION_OUTBOX_ROW_COLUMNS}
    FROM main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    WHERE delivery_id = ?
  `);
  const state = prepare(`
    SELECT
      singleton,
      schema_version,
      total_records,
      active_records,
      active_bytes,
      last_ordinal
    FROM main.${DATABASE_AUTOMATION_OUTBOX_STATE_TABLE}
    WHERE singleton = 1
  `);
  const insert = prepare(`
    INSERT INTO main.${DATABASE_AUTOMATION_OUTBOX_TABLE} (
      delivery_id,
      command_fingerprint,
      invocation_id,
      trigger_identity,
      function_identity,
      manifest_fingerprint,
      realm_name,
      realm_fingerprint,
      source_sequence,
      source_table,
      source_operation,
      source_row_id,
      payload_json,
      payload_bytes,
      status,
      attempt_count,
      max_attempts,
      available_at,
      lease_owner,
      lease_token,
      lease_expires_at,
      last_error_code,
      created_at,
      updated_at,
      completed_at,
      insertion_ordinal,
      schema_version
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?,
      NULL, NULL, NULL, NULL, ?, ?, NULL, ?, ?
    )
  `);
  const nextDue = prepare(`
    SELECT ${DATABASE_AUTOMATION_OUTBOX_ROW_COLUMNS}
    FROM main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    WHERE insertion_ordinal = (
        SELECT MIN(insertion_ordinal)
        FROM main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
        WHERE status IN ('pending', 'processing')
      )
      AND status = 'pending'
      AND available_at <= ?
      AND attempt_count < max_attempts
    LIMIT 1
  `);
  const claim = prepare(`
    UPDATE main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    SET status = 'processing',
        attempt_count = attempt_count + 1,
        lease_owner = ?,
        lease_token = ?,
        lease_expires_at = ?,
        updated_at = MAX(updated_at, ?)
    WHERE delivery_id = ?
      AND status = 'pending'
      AND available_at <= ?
      AND attempt_count < max_attempts
    RETURNING delivery_id
  `);
  const complete = prepare(`
    UPDATE main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    SET status = 'completed',
        payload_json = NULL,
        payload_bytes = 0,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = NULL,
        completed_at = MAX(created_at, ?),
        updated_at = MAX(updated_at, ?)
    WHERE delivery_id = ?
      AND status = 'processing'
      AND lease_owner = ?
      AND lease_token = ?
      AND lease_expires_at > ?
    RETURNING delivery_id
  `);
  const retry = prepare(`
    UPDATE main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    SET status = 'pending',
        available_at = ?,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = ?,
        updated_at = MAX(updated_at, ?)
    WHERE delivery_id = ?
      AND status = 'processing'
      AND lease_owner = ?
      AND lease_token = ?
      AND lease_expires_at > ?
      AND attempt_count < max_attempts
    RETURNING delivery_id
  `);
  const dead = prepare(`
    UPDATE main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    SET status = 'dead',
        payload_json = NULL,
        payload_bytes = 0,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = ?,
        completed_at = MAX(created_at, ?),
        updated_at = MAX(updated_at, ?)
    WHERE delivery_id = ?
      AND status = 'processing'
      AND lease_owner = ?
      AND lease_token = ?
      AND lease_expires_at > ?
    RETURNING delivery_id
  `);
  const extendLease = prepare(`
    UPDATE main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    SET lease_expires_at = ?, updated_at = MAX(updated_at, ?)
    WHERE delivery_id = ?
      AND status = 'processing'
      AND lease_owner = ?
      AND lease_token = ?
      AND lease_expires_at > ?
      AND lease_expires_at < ?
    RETURNING delivery_id
  `);
  const recoverDead = prepare(`
    UPDATE main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    SET status = 'dead',
        payload_json = NULL,
        payload_bytes = 0,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = 'AUTOMATION_MAX_ATTEMPTS',
        completed_at = MAX(created_at, ?),
        updated_at = MAX(updated_at, ?)
    WHERE status = 'processing'
      AND lease_expires_at <= ?
      AND attempt_count >= max_attempts
    RETURNING delivery_id
  `);
  const recoverPending = prepare(`
    UPDATE main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    SET status = 'pending',
        available_at = MIN(available_at, ?),
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = 'AUTOMATION_LEASE_EXPIRED',
        updated_at = MAX(updated_at, ?)
    WHERE status = 'processing'
      AND lease_expires_at <= ?
      AND attempt_count < max_attempts
    RETURNING delivery_id
  `);
  const compactTerminal = prepare(`
    DELETE FROM main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    WHERE delivery_id IN (
      SELECT delivery_id
      FROM main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
      WHERE status IN ('completed', 'dead')
      ORDER BY completed_at ASC, insertion_ordinal ASC
      LIMIT ?
    )
  `);
  const statusCounts = prepare(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pending_records,
      COUNT(*) FILTER (WHERE status = 'processing') AS processing_records,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_records,
      COUNT(*) FILTER (WHERE status = 'dead') AS dead_records
    FROM main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
  `);
  const activeRealmMismatch = prepare(`
    SELECT 1 AS present
    FROM main.${DATABASE_AUTOMATION_OUTBOX_TABLE}
    WHERE status IN ('pending', 'processing')
      AND realm_name != ? COLLATE BINARY
    LIMIT 1
  `);
    return Object.freeze({
      byId,
      state,
      insert,
      nextDue,
      claim,
      complete,
      retry,
      dead,
      extendLease,
      recoverDead,
      recoverPending,
      compactTerminal,
      statusCounts,
      activeRealmMismatch,
      all: Object.freeze([...all]),
    });
  } catch (cause) {
    const failures: unknown[] = [];
    for (const statement of [...all].reverse()) {
      try {
        statement.finalize();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        [cause, ...failures],
        'Database automation outbox statement preparation failed.',
      );
    }
    throw cause;
  }
}
