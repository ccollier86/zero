import type { SyncAckMessage } from './types';

interface StoredReceipt {
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string;
}

/** Persist only row coordinates; canonical row bodies are reloaded on replay. */
export function encodeMutationReceipt(ack: SyncAckMessage): string {
  if (!ack.ok || !ack.change) throw new Error('Successful mutation receipt required');
  const { table, op, rowId } = ack.change;
  return JSON.stringify({ table, op, rowId } satisfies StoredReceipt);
}

/** Rebuild a wire ack whose row will be populated through current authorization. */
export function decodeMutationReceipt(value: string, ref: string): SyncAckMessage | null {
  const stored = JSON.parse(value) as Record<string, unknown>;
  if (!stored || typeof stored.table !== 'string'
    || typeof stored.rowId !== 'string'
    || !['INSERT', 'UPDATE', 'DELETE'].includes(String(stored.op))) return null;
  return {
    type: 'sync.ack', ref, seq: null, ok: true,
    change: {
      table: stored.table,
      op: stored.op as StoredReceipt['op'],
      rowId: stored.rowId,
      row: null,
    },
  };
}
