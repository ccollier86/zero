/** Bounded per-socket read evidence. Never blocks a SQLite writer or the process-wide change dispatcher. */
import type { ServerWebSocket } from 'bun';
import type { Row, SyncCatchupMessage, SyncSocketData } from './types';
import { isLoggingResultReceipt } from '../logging/logging-result-shape';

const queues = new WeakMap<ServerWebSocket<SyncSocketData>, { tail: Promise<void>; pending: number; bytes: number }>();
export function syncReadDeliveryTail(socket: ServerWebSocket<SyncSocketData>): Promise<void> | undefined { return queues.get(socket)?.tail; }
export function enqueueSyncReadDelivery(socket: ServerWebSocket<SyncSocketData>, action: () => Promise<void>, bytes = 0): void {
  if (socket.data.syncReadDeliveryClosed) return;
  let queue = queues.get(socket);
  if (!queue) { queue = { tail: Promise.resolve(), pending: 0, bytes: 0 }; queues.set(socket, queue); }
  if (queue.pending >= 256 || queue.bytes + bytes > 8 * 1024 * 1024) { socket.data.syncReadDeliveryClosed = true; socket.close(1013, 'Bounded read delivery capacity exhausted'); return; }
  queue.pending++; queue.bytes += bytes;
  queue.tail = queue.tail.then(async () => { if (!socket.data.syncReadDeliveryClosed) await action(); }).catch(() => {
    socket.data.syncReadDeliveryClosed = true; socket.close(1013, 'Read evidence delivery unavailable');
  }).finally(() => { queue!.pending--; queue!.bytes -= bytes; if (!queue!.pending && queues.get(socket) === queue) queues.delete(socket); });
}
export async function prepareSyncReadResult(socket: ServerWebSocket<SyncSocketData>, table: string, rows: readonly Row[], seq: number, epoch: string) {
  if (socket.data.syncReadDeliveryClosed) throw new Error('Read delivery is closed.');
  const receipt = await socket.data.prepareReadResult?.(table, rows, seq, epoch);
  if (socket.data.syncReadDeliveryClosed) throw new Error('Read delivery is closed.');
  if (receipt && (!isLoggingResultReceipt(receipt) || receipt.table !== table || receipt.count !== rows.length)) throw new Error('Invalid native read evidence.');
  return receipt ?? undefined;
}
/** Catch-up is applied atomically: only the final retained object for an identity can become visible. */
export async function prepareSyncCatchupResults(socket: ServerWebSocket<SyncSocketData>, changes: SyncCatchupMessage['changes'], seq: number, epoch: string) {
  if (!socket.data.prepareReadResult) return undefined;
  const final = new Map<string, Map<string, Row>>();
  for (const change of changes) {
    let rows = final.get(change.table); if (!rows) final.set(change.table, rows = new Map());
    if (change.row && change.op !== 'DELETE') rows.set(change.rowId, change.row); else rows.delete(change.rowId);
  }
  const results: NonNullable<SyncCatchupMessage['auditResults']>[number][] = [];
  for (const [table, entries] of final) {
    const rows = [...entries];
    for (let offset = 0; offset < rows.length; offset += 1000) {
      const part = rows.slice(offset, offset + 1000), receipt = await prepareSyncReadResult(socket, table, part.map(([, row]) => row), seq, epoch);
      if (receipt) results.push({ table, rowIds: part.map(([id]) => id), receipt });
    }
  }
  return results.length ? results : undefined;
}
