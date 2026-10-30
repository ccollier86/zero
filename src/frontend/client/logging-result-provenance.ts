/** Weak in-memory lineage for server-released objects. Never persisted; optimistic copies get no server proof. */
import type { LoggingDeriveResultInput, LoggingResultReceipt } from '../../logging/logging-result-contracts';
import { LOGGING_RESULT_MAX_RECORDS } from '../../logging/logging-result-contracts';
import { isLoggingResultReceipt } from '../../logging/logging-result-shape';
const releases = new WeakMap<object, Readonly<{ receipt: LoggingResultReceipt; position: number }>>();
const emptyReleases = new WeakMap<object, LoggingResultReceipt>();
export function loggingResultForRow(row: object): LoggingResultReceipt | undefined { return releases.get(row)?.receipt; }
export function emptyLoggingResult(container: object): LoggingResultReceipt | undefined { return emptyReleases.get(container); }
export function carryEmptyLoggingResult(from: object, to: object): void { const receipt = emptyReleases.get(from); if (receipt) emptyReleases.set(to, receipt); }
export function registerLoggingResultRows(rows: readonly object[], receipt: LoggingResultReceipt | undefined): void {
  if (!receipt || !isLoggingResultReceipt(receipt) || receipt.count !== rows.length) return;
  if (!rows.length) emptyReleases.set(rows, Object.freeze({ ...receipt }));
  rows.forEach((row, position) => releases.set(row, { receipt: Object.freeze({ ...receipt }), position }));
}
/** Only for codec-equivalent native copies, never an optimistic patch or arbitrary projection. */
export function carryLoggingResultRow(from: object, to: object): void { const source = releases.get(from); if (source) releases.set(to, source); }
export function selectLoggingResultRows(rows: readonly object[], emptySource?: LoggingResultReceipt): Omit<LoggingDeriveResultInput, 'id'> | null {
  if (rows.length > LOGGING_RESULT_MAX_RECORDS) return null;
  if (!rows.length) return emptySource ? { kind: 'list', sources: [{ receiptId: emptySource.id, positions: [] }] } : null;
  const sources: { receiptId: string; positions: number[] }[] = [];
  let table: string | undefined;
  for (const row of rows) {
    const source = releases.get(row);
    if (!source || table !== undefined && source.receipt.table !== table) return null;
    table = source.receipt.table;
    let selected = sources.at(-1);
    if (selected?.receiptId !== source.receipt.id) { selected = { receiptId: source.receipt.id, positions: [] }; sources.push(selected); }
    selected.positions.push(source.position);
  }
  return { kind: 'list', sources };
}
