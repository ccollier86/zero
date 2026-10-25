/** Browser-safe durable export projections. No provider path, Storage checksum selector or private query capability. */
import type { LoggingQuery, LoggingStream } from './logging-contracts';
export interface LoggingExportRequest { readonly id: string; readonly stream: LoggingStream; readonly query?: LoggingQuery }
export interface LoggingExportJob {
  readonly id: string;
  readonly stream: LoggingStream;
  readonly state: 'pending' | 'ready' | 'failed' | 'expired';
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly completedAt: number | null;
  readonly highWaterOrdinal: number;
  readonly count: number;
  readonly complete: boolean;
  readonly nextBeforeOrdinal: number | null;
  /** Exact downloadable bytes, including their manifest line. */
  readonly sha256: string | null;
}
