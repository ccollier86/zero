/** Frozen runtime-created 1.3 tables and explicit replay reconciliation, not app-owned data. */
import type { Database } from 'bun:sqlite';
import type { LegacyStateMigrationPlan } from './contracts';
import { failLegacyState } from './contracts';
import { hasTable } from './ledger';

export const LEGACY_APPLICATION_RUNTIME_TABLES = ['_sync_mutation_receipts'] as const;
export const LEGACY_OPTIONAL_RUNTIME_TABLES = ['_auth_user_generations', '_sync_mutation_receipts', '_zero_sync_table_modes'] as const;

/** Match the released runtime schemas; do not edit historical migrations to add them. */
export function defineLegacyRuntimeReference(db: Database): void {
  db.exec(`CREATE TABLE _sync_mutation_receipts (
    principal TEXT NOT NULL, ref TEXT NOT NULL, request_hash TEXT NOT NULL,
    ack_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (principal, ref)
  )`);
  db.exec(`CREATE TABLE _zero_sync_table_modes (
    table_name text primary key, mode text not null, source text not null,
    reason text not null, row_count_at_decision integer not null,
    row_limit integer not null, created_at integer not null, updated_at integer not null
  )`);
}

/** Only this admitted offline boundary can mark an old unscoped receipt for lookup. */
export function bindLegacyMutationReceipts(db: Database, plan: LegacyStateMigrationPlan): void {
  if (!hasTable(db, '_sync_mutation_receipts')) return;
  db.exec(`CREATE TABLE _sync_legacy_mutation_receipt_bindings (
    principal TEXT NOT NULL, ref TEXT NOT NULL, request_hash TEXT NOT NULL,
    source_sha256 TEXT NOT NULL, PRIMARY KEY (principal, ref),
    FOREIGN KEY (principal, ref) REFERENCES _sync_mutation_receipts(principal, ref) ON DELETE CASCADE
  )`);
  db.query(`INSERT INTO _sync_legacy_mutation_receipt_bindings
    SELECT principal,ref,request_hash,? FROM _sync_mutation_receipts WHERE substr(principal,1,5)='user:'`).run(plan.sourceSha256);
}

export function verifyLegacyMutationReceiptBindings(source: Database, target: Database, plan: LegacyStateMigrationPlan): void {
  if (!hasTable(source, '_sync_mutation_receipts')) {
    if (hasTable(target, '_sync_legacy_mutation_receipt_bindings')) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
    return;
  }
  const expected = source.query<{ total: bigint }, []>("SELECT COUNT(*) AS total FROM _sync_mutation_receipts WHERE substr(principal,1,5)='user:'").get()!.total;
  const actual = target.query<{ total: bigint }, []>('SELECT COUNT(*) AS total FROM _sync_legacy_mutation_receipt_bindings').get()!.total;
  if (expected !== actual || target.query(`SELECT 1 FROM _sync_legacy_mutation_receipt_bindings AS binding
    LEFT JOIN _sync_mutation_receipts AS receipt ON receipt.principal=binding.principal AND receipt.ref=binding.ref
    WHERE receipt.principal IS NULL OR receipt.request_hash<>binding.request_hash OR binding.source_sha256<>?
      OR substr(binding.principal,1,5)<>'user:' LIMIT 1`).get(plan.sourceSha256)) failLegacyState('LEGACY_STATE_PRESERVATION_FAILED');
}
