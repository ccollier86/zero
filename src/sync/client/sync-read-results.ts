/** Attach opaque provenance only to accepted server objects, before the store publishes them. */
import type { ServerMessage, Row } from '../types';
import { isLoggingResultReceipt } from '../../logging/logging-result-shape';
import { registerLoggingResultRows } from '../../frontend/client/logging-result-provenance';
export function registerSyncReadResults(message: ServerMessage): boolean {
  if (message.type === 'sync.ack' && message.auditReceipt) {
    if (!message.ok || !message.change?.row || message.change.op === 'DELETE' || !isLoggingResultReceipt(message.auditReceipt)
      || message.auditReceipt.table !== message.change.table || message.auditReceipt.count !== 1) return false;
    registerLoggingResultRows([message.change.row], message.auditReceipt);
  }
  if (message.type === 'sync.change' && message.auditReceipt) {
    if (!message.row || message.op === 'DELETE' || !isLoggingResultReceipt(message.auditReceipt)
      || message.auditReceipt.table !== message.table || message.auditReceipt.count !== 1) return false;
    registerLoggingResultRows([message.row], message.auditReceipt);
  }
  if (message.type === 'sync.catchup' && message.auditResults !== undefined) {
    if (!Array.isArray(message.auditResults) || message.auditResults.length > 10000) return false;
    const final = new Map<string, Row | null>();
    for (const change of message.changes) final.set(JSON.stringify([change.table, change.rowId]), change.op === 'DELETE' ? null : change.row);
    const assigned = new Set<string>();
    for (const result of message.auditResults) {
      if (!result || typeof result.table !== 'string' || !isLoggingResultReceipt(result.receipt)
        || result.receipt.table !== result.table || !Array.isArray(result.rowIds) || result.rowIds.length !== result.receipt.count) return false;
      const rows: Row[] = [];
      for (const id of result.rowIds) {
        const key = JSON.stringify([result.table, id]), row = final.get(key);
        if (typeof id !== 'string' || !row || assigned.has(key)) return false;
        assigned.add(key); rows.push(row);
      }
      registerLoggingResultRows(rows, result.receipt);
    }
  }
  return true;
}
