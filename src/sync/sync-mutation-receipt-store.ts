/**
 * sync-mutation-receipt-store.ts
 *
 * Persists successful mutation results in the same SQLite transaction as the
 * data write so reconnect replay is idempotent across process restarts.
 */

import type { ReactiveDB } from './reactive-db';
import type { SyncAckMessage, SyncMutateMessage } from './types';
import {
  decodeMutationReceipt,
  encodeMutationReceipt,
} from './sync-mutation-receipt-codec';
import { pruneMutationReceipts } from './sync-mutation-receipt-prune';

export type ReceiptLookup =
  | { status: 'miss' }
  | { status: 'conflict' }
  | { status: 'hit'; ack: SyncAckMessage };

/** Durable, bounded receipt ledger for client-generated mutation references. */
export class SyncMutationReceiptStore {
  private writes = 0;
  constructor(private readonly db: ReactiveDB) {
    db.exec(`CREATE TABLE IF NOT EXISTS main._sync_mutation_receipts (
      principal TEXT NOT NULL, ref TEXT NOT NULL, request_hash TEXT NOT NULL,
      ack_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (principal, ref)
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS main._sync_receipts_created_at
      ON _sync_mutation_receipts(created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS main._sync_receipts_principal_created
      ON _sync_mutation_receipts(principal, created_at)`);
  }

  find(principal: string, ref: string, requestHash: string): ReceiptLookup {
    const row = this.db.prepare(
      'SELECT request_hash, ack_json FROM main._sync_mutation_receipts ' +
      'WHERE principal = ? AND ref = ?',
    ).get(principal, ref) as { request_hash: string; ack_json: string } | null;
    if (!row) return { status: 'miss' };
    if (row.request_hash !== requestHash) return { status: 'conflict' };
    try {
      const ack = decodeMutationReceipt(row.ack_json, ref);
      return ack ? { status: 'hit', ack } : { status: 'conflict' };
    } catch {
      return { status: 'conflict' };
    }
  }

  save(principal: string, ref: string, requestHash: string, ack: SyncAckMessage): void {
    this.db.prepare(`INSERT INTO main._sync_mutation_receipts
      (principal, ref, request_hash, ack_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(principal, ref, requestHash, encodeMutationReceipt(ack), Date.now());
    pruneMutationReceipts(this.db, principal, ++this.writes % 100 === 0);
  }
}

/** Hash the semantic mutation request so a reused ref cannot alias new work. */
export function hashSyncMutation(message: SyncMutateMessage): string {
  const value = stableJson([
    message.table, message.op, message.rowId ?? null, message.row ?? null,
  ]);
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(
    (key) => `${JSON.stringify(key)}:${stableJson(record[key])}`,
  ).join(',')}}`;
}
