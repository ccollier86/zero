/** In-memory provenance matching. No current requery, row contents, URL, or criteria are sent to the audit collector. */
import type { LoggingResultReceipt } from '../../logging/logging-result-contracts';
import type { Row } from '../../sync/types';
import { stableValueKey } from '../../frontend/client/query-params';
import { registerLoggingResultRows, loggingResultForRow } from '../../frontend/client/logging-result-provenance';
import { isLoggingResultReceipt } from '../../logging/logging-result-shape';

export class DataTableAuditResult<T extends Row> {
  private candidates: { rows: readonly T[]; receipt: LoggingResultReceipt }[] = [];
  private active: { rowsKey: string; receipt: LoggingResultReceipt } | null = null;
  source: LoggingResultReceipt | undefined;
  remember(rows: readonly T[], receipt: LoggingResultReceipt | undefined): void {
    registerLoggingResultRows(rows, receipt);
    this.source = receipt ?? (rows[0] ? loggingResultForRow(rows[0]) : undefined) ?? this.source;
    if (!receipt || !isLoggingResultReceipt(receipt) || receipt.kind !== 'list' || receipt.count !== rows.length || this.candidates.some(candidate => candidate.receipt.id === receipt.id)) return;
    this.candidates.push({ rows, receipt });
    if (this.candidates.length > 16) this.candidates.shift();
  }
  displayed(rows: readonly T[]): LoggingResultReceipt | undefined {
    const rowsKey = stableValueKey(rows); // Equality only, retained in component memory and never transmitted/persisted.
    if (this.active?.rowsKey === rowsKey) return this.active.receipt;
    const match = [...this.candidates].reverse().find(candidate => candidate.rows.length === rows.length && candidate.rows.every((row, index) => row === rows[index]));
    if (!match) { this.active = null; return undefined; }
    this.active = { rowsKey, receipt: match.receipt }; return match.receipt;
  }
}
