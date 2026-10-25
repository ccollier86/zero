/** Private bounded delivery-worker wire vocabulary. No paths, SQL or application authority crosses this channel. */
import type { LoggingEvent, LoggingReceipt } from './logging-contracts';
import { LoggingError } from './logging-error';
import { loggingArray, loggingByteLength, loggingId, loggingRecord, normalizeLoggingEvent } from './logging-validation';
import type { LoggingAppendResult } from './logging-fabric-store';
import { isDatabaseExecutorValue } from '../databases/database-executor-validation';

export const LOGGING_DELIVERY_FLAG = '--zero-logging-delivery-child';
export const LOGGING_DELIVERY_PROTOCOL = 'zero.logging-delivery';
export const LOGGING_DELIVERY_VERSION = 1;
export const LOGGING_DELIVERY_MAX_BYTES = 640 * 1024;
export const LOGGING_DELIVERY_MAX_SOURCES = 10002;

export interface DeliveryPage {
  readonly rows: readonly { readonly id: string; readonly event: LoggingEvent }[];
  readonly queued: number;
  readonly bytes: number;
}
export interface DeliverySourcePort {
  /** Acknowledgments have already been fenced against committed sink receipts. */
  page(acknowledge: readonly string[]): DeliveryPage | Promise<DeliveryPage>;
  failed(): void;
}
export interface DeliverySourceState { readonly queued: number; readonly bytes: number; readonly failed: number; readonly pending: boolean; readonly active: boolean }
export interface DeliverySourceRegistration {
  readonly id: string;
  wake(): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  diagnostics(): DeliverySourceState;
}
export type DeliveryOperation = 'write' | 'source.add' | 'source.flush' | 'source.close' | 'flush' | 'stop' | 'status';
export type DeliveryBrokerOperation = 'source.page' | 'sink.append';
export interface DeliveryWire {
  protocol: typeof LOGGING_DELIVERY_PROTOCOL;
  version: typeof LOGGING_DELIVERY_VERSION;
  nonce: string;
  type: 'hello' | 'call' | 'reply' | 'signal';
  id: number;
  op: string;
  value: unknown;
  error?: Readonly<{ code: LoggingError['code']; outcome: LoggingError['outcome'] }>;
}

/** Validate the transport envelope before inspecting any operation-specific fields. */
export function readDeliveryWire(raw: unknown, nonce?: string): DeliveryWire {
  const r = loggingRecord(raw, ['protocol', 'version', 'nonce', 'type', 'id', 'op', 'value', 'error']);
  // Check nested data before JSON byte accounting can encounter a getter or
  // toJSON hook. Source-control vectors have two extra pinned owners beyond
  // Fabric's 10000-source catalog, but contain only bounded opaque IDs.
  const sourceControl = ['source.add', 'source.flush', 'source.close', 'source.wake'].includes(r.op as string) && (r.type === 'call' || r.type === 'signal');
  if (sourceControl) {
    for (const id of loggingArray(r.value, LOGGING_DELIVERY_MAX_SOURCES)) loggingId(id);
    if (r.error !== undefined) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery control failure.');
  } else if (!isDatabaseExecutorValue(r)) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery worker value.');
  if (r.protocol !== LOGGING_DELIVERY_PROTOCOL || r.version !== LOGGING_DELIVERY_VERSION
    || typeof r.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(r.nonce) || nonce !== undefined && r.nonce !== nonce
    || !['hello', 'call', 'reply', 'signal'].includes(r.type as string)
    || !Number.isSafeInteger(r.id) || Number(r.id) < 0 || typeof r.op !== 'string' || r.op.length > 40
    || loggingByteLength(r) > LOGGING_DELIVERY_MAX_BYTES) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery worker message.');
  return r as unknown as DeliveryWire;
}

/** Source pages are bounded independently from sink batches, with stable, unique identities. */
export function readDeliveryPage(raw: unknown): DeliveryPage {
  const r = loggingRecord(raw, ['rows', 'queued', 'bytes']);
  for (const n of [r.queued, r.bytes]) if (!Number.isSafeInteger(n) || Number(n) < 0) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid source queue counters.');
  const ids = new Set<string>();
  const rows = loggingArray(r.rows, 256).map(rawRow => {
    const row = loggingRecord(rawRow, ['id', 'event']), id = loggingId(row.id)!;
    if (ids.has(id)) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Repeated source queue identity.');
    const event = normalizeLoggingEvent(row.event); if (event.id !== id) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Source queue identity mismatch.');
    ids.add(id); return Object.freeze({ id, event });
  });
  if (Number(r.queued) < rows.length || Number(r.queued) > 0 && !rows.length || loggingByteLength(rows.map(row => row.event)) > 256 * 1024 + 512)
    throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Source queue page exceeds its budget.');
  return Object.freeze({ rows: Object.freeze(rows), queued: Number(r.queued), bytes: Number(r.bytes) });
}

/** Never forward exception text, SQL, paths, event bodies or provider credentials. */
export function deliveryFailure(error: unknown): NonNullable<DeliveryWire['error']> {
  return Object.freeze(error instanceof LoggingError ? { code: error.code, outcome: error.outcome }
    : { code: 'LOGGING_OUTCOME_UNKNOWN', outcome: 'unknown' });
}
export function deliveryError(raw: unknown): LoggingError {
  const r = loggingRecord(raw, ['code', 'outcome']);
  const codes: readonly string[] = ['LOGGING_CONFIG_INVALID', 'LOGGING_NOT_READY', 'LOGGING_FORBIDDEN', 'LOGGING_AUDIT_UNAVAILABLE', 'LOGGING_EVENT_INVALID', 'LOGGING_EVENT_CONFLICT',
    'LOGGING_QUERY_INVALID', 'LOGGING_BACKPRESSURE', 'LOGGING_CLOSED', 'LOGGING_WRITE_FAILED', 'LOGGING_OUTCOME_UNKNOWN', 'LOGGING_RESPONSE_INVALID'];
  if (!codes.includes(r.code as string) || !['not-admitted', 'not-committed', 'unknown'].includes(r.outcome as string))
    throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery worker failure.', 'unknown');
  return new LoggingError(r.code as LoggingError['code'], 'Logging delivery worker operation failed.', r.outcome as LoggingError['outcome']);
}
export function deliveryIdentity(event: Pick<LoggingEvent, 'id' | 'sourceId'> | LoggingReceipt): string { return JSON.stringify([event.sourceId, event.id]); }

export function readDeliveryAppend(raw: unknown, events: readonly LoggingEvent[]): LoggingAppendResult {
  try {
    const r = loggingRecord(raw, ['receipts', 'sequence']), sequence = loggingRecord(r.sequence, ['seq']);
    if (!Number.isSafeInteger(sequence.seq) || Number(sequence.seq) < 0) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery sequence.', 'unknown');
    const receipts = loggingArray(r.receipts, events.length).map((value, i) => {
      const receipt = loggingRecord(value, ['id', 'sourceId', 'ordinal', 'duplicate']);
      if (receipt.id !== events[i]!.id || receipt.sourceId !== events[i]!.sourceId || !Number.isSafeInteger(receipt.ordinal) || Number(receipt.ordinal) < 1 || typeof receipt.duplicate !== 'boolean')
        throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery receipt.', 'unknown');
      return Object.freeze(receipt as unknown as LoggingReceipt);
    });
    if (receipts.length !== events.length) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Incomplete delivery receipts.', 'unknown');
    return Object.freeze({ receipts: Object.freeze(receipts), sequence: Object.freeze({ seq: Number(sequence.seq) }) });
  } catch { throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Delivery append acknowledgment is invalid.', 'unknown'); }
}
