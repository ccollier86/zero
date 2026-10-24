/** Browser-safe public logging transport contracts; no auth, filesystem or database dependencies. */
import type { LoggingEventInput, LoggingFamily, LoggingPage, LoggingQuery, LoggingReceipt, LoggingStream } from './logging-contracts';
import type { LoggingCheckpoint, LoggingEvidencePage, LoggingHoldReceipt, LoggingReviewReceipt, LoggingExport, LoggingVerification } from './logging-evidence-contracts';

export interface LoggingHoldInput { readonly id: string; readonly since: number; readonly until: number; readonly reasonRef: string }
export interface LoggingReviewInput { readonly id: string; readonly query: LoggingQuery; readonly highWaterOrdinal: number; readonly result: 'reviewed' | 'follow-up'; readonly reference: string }

export const LOGGING_API = '/api/_zero/logging';
export const LOGGING_BROWSER_ACTIONS = Object.freeze({
  'view.opened': 'views', 'view.interval': 'views', 'view.closed': 'views',
  'clipboard.copy.observed': 'clipboard', 'clipboard.copy.completed': 'clipboard', 'clipboard.copy.failed': 'clipboard',
  'print.requested': 'printing', 'print.dialog.closed': 'printing', 'navigation.changed': 'navigation',
} as const);
export interface LoggingObservation {
  readonly id: string;
  readonly collectorId: string;
  readonly action: keyof typeof LOGGING_BROWSER_ACTIONS;
  readonly occurredAt: number;
  readonly target?: Readonly<{ type: string; id: string }>;
  readonly interval?: Readonly<{ viewId: string; sequence: number; elapsedMs: number; visibleMs: number; activeMs: number; incomplete: boolean }>;
}
export interface LoggingCollectionPolicy {
  readonly enabled: boolean;
  readonly capture: Readonly<Record<LoggingFamily, boolean>>;
  readonly heartbeatMs: number;
  readonly idleMs: number;
}
export interface LoggingHealth {
  readonly state: string;
  readonly preset: string;
  readonly coverage: Readonly<Record<string, boolean | string>>;
  readonly pendingEvents: number;
  readonly failedEvents: number;
  readonly sourcePendingEvents: number;
  readonly sourceDeliveryFailures: number;
  readonly maintenanceFailures: number;
}
/** Query projections never accept a tenant, actor, database ref or raw SQL selector. */
export interface ScopedLogging {
  page(stream: LoggingStream, query?: LoggingQuery): Promise<LoggingPage>;
  platformPage(stream: LoggingStream, query?: LoggingQuery): Promise<LoggingPage>;
  stream(stream: LoggingStream, query: LoggingQuery, signal: AbortSignal, platform?: boolean): Promise<ReadableStream<Uint8Array>>;
  record(input: LoggingEventInput): Promise<LoggingReceipt | null>;
  observe(observations: readonly LoggingObservation[]): Promise<Readonly<{ accepted: number }>>;
  collectionPolicy(): Promise<LoggingCollectionPolicy>;
  health(): Promise<LoggingHealth>;
  /** Capture metadata-only attribution for source mutations performed inside this owned operation. Does not grant domain access. */
  run<T>(operation: () => T | Promise<T>): Promise<T>;
  /** Audit read admission and successful preparation before releasing protected results. Caller still owns domain authorization. */
  read<T>(target: { type: string; id: string }, operation: () => T | Promise<T>): Promise<T>;
  evidence(before?: number): Promise<LoggingEvidencePage>;
  hold(input: LoggingHoldInput): Promise<LoggingHoldReceipt>;
  releaseHold(id: string): Promise<LoggingHoldReceipt>;
  review(input: LoggingReviewInput): Promise<LoggingReviewReceipt>;
  export(stream: LoggingStream, query?: LoggingQuery): Promise<LoggingExport>;
  /** Platform-only bounded verification, optionally against a checkpoint held outside Zero. */
  verify(stream: LoggingStream, afterOrdinal?: number, checkpoint?: LoggingCheckpoint): Promise<LoggingVerification>;
}
export interface LoggingClient {
  /** Pin a collector to the current auth generation before any asynchronous observation occurs. */
  bindObservations(): Pick<LoggingClient, 'observe'>;
  page(stream: LoggingStream, query?: LoggingQuery, options?: { signal?: AbortSignal }): Promise<LoggingPage>;
  platformPage(stream: LoggingStream, query?: LoggingQuery, options?: { signal?: AbortSignal }): Promise<LoggingPage>;
  observe(observations: readonly LoggingObservation[], options?: { signal?: AbortSignal }): Promise<Readonly<{ accepted: number }>>;
  collectionPolicy(options?: { signal?: AbortSignal }): Promise<LoggingCollectionPolicy>;
  health(options?: { signal?: AbortSignal }): Promise<LoggingHealth>;
  evidence(before?: number, options?: { signal?: AbortSignal }): Promise<LoggingEvidencePage>;
  hold(input: LoggingHoldInput, options?: { signal?: AbortSignal }): Promise<LoggingHoldReceipt>;
  releaseHold(id: string, options?: { signal?: AbortSignal }): Promise<LoggingHoldReceipt>;
  review(input: LoggingReviewInput, options?: { signal?: AbortSignal }): Promise<LoggingReviewReceipt>;
  export(stream: LoggingStream, query?: LoggingQuery, options?: { signal?: AbortSignal }): Promise<LoggingExport>;
  verify(stream: LoggingStream, afterOrdinal?: number, checkpoint?: LoggingCheckpoint, options?: { signal?: AbortSignal }): Promise<LoggingVerification>;
  /** Generation-aware committed projections. Stream is default; polling remains an explicit fallback. */
  watch(stream: LoggingStream, query: LoggingQuery, listener: (page: LoggingPage) => void, options?: { signal?: AbortSignal; onError?: (error: unknown) => void; onStatus?: (state: 'connecting' | 'live' | 'reconnecting') => void; intervalMs?: number; platform?: boolean; transport?: 'stream' | 'poll' }): () => void;
  clear(): void;
}
