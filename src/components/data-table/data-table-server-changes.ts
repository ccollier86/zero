/** Query-bound live INSERT evidence and trusted transport subscriptions; never evaluates filters, writes collections, or invents unseen counts. */
import type { InternalClient } from '../../frontend/client/sdk';
import type { Row } from '../../sync/types';
import { normalizeDataTableServerQuery } from './data-table-server-query';
import type { DataTableServerChange, DataTableServerQuery, DataTableServerSource } from './data-table-server-types';

export const DATA_TABLE_SERVER_MAX_INSERT_EVIDENCE = 1_000;
const MAX_ROW_ID_LENGTH = 1_024;

/** Stages bounded genuine changes; only a subsequently accepted current response establishes query/page membership. */
export class DataTableServerInsertEvidence {
  private signature: string | null = null;
  private readonly inserted = new Set<string>();
  reconcile(signature: string): void {
    if (signature !== this.signature) { this.clear(); this.signature = signature; }
  }
  clear(): void { this.inserted.clear(); }
  observe(change: DataTableServerChange, baselineIds: readonly string[]): void {
    if (!validChange(change)) return;
    if (change.op === 'DELETE') { this.inserted.delete(change.rowId); return; }
    if (change.op === 'UPDATE') return;
    if (baselineIds.includes(change.rowId)) return;
    this.inserted.add(change.rowId);
    while (this.inserted.size > DATA_TABLE_SERVER_MAX_INSERT_EVIDENCE) this.inserted.delete(this.inserted.values().next().value!);
  }
  /** Consume each matching ID once; cache refreshes and page joins cannot manufacture new insert evidence. */
  accept(signature: string, ids: readonly string[]): readonly string[] {
    if (signature !== this.signature) return [];
    const matched = ids.filter(id => this.inserted.delete(id));
    return matched;
  }
}

/** Custom endpoint streams are explicitly owned by that adapter; built-in data queries observe only admitted SDK Sync messages. */
export function subscribeDataTableServerChanges<T extends Row>(source: DataTableServerSource<T>, query: DataTableServerQuery,
  client: InternalClient | null, listener: (change: DataTableServerChange) => void, signal: AbortSignal): () => void {
  if (signal.aborted || source.live === false) return () => {};
  const callback = (change: DataTableServerChange) => { if (!signal.aborted && validChange(change)) listener(change); };
  if (source.adapter) return source.adapter.subscribeChanges?.(normalizeDataTableServerQuery(query), callback, { signal }) ?? (() => {});
  return client?._syncClient?.onMessage(message => {
    const change = readDataTableSyncChange(message, source.table);
    if (change) callback(change);
  }) ?? (() => {});
}

/** The SDK already admitted socket/stream authority; ignore all snapshot/catchup/ack and malformed change shapes. */
export function readDataTableSyncChange(message: { type: string; [key: string]: unknown }, table: string): DataTableServerChange | null {
  if (message.type !== 'sync.change' || message.table !== table) return null;
  const change = { op: message.op, rowId: message.rowId };
  if (!validChange(change)) return null;
  if (change.op !== 'DELETE' && (!message.row || typeof message.row !== 'object' || Array.isArray(message.row))) return null;
  return change;
}
function validChange(value: unknown): value is DataTableServerChange {
  if (!value || typeof value !== 'object') return false;
  const change = value as DataTableServerChange;
  return (change.op === 'INSERT' || change.op === 'UPDATE' || change.op === 'DELETE')
    && typeof change.rowId === 'string' && change.rowId.length > 0 && change.rowId.length <= MAX_ROW_ID_LENGTH;
}
