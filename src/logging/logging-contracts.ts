/** Browser-safe logging data contracts. No persistence, identity resolution or transport runs here. */

export const LOGGING_PRESETS = Object.freeze(['basic', 'activity', 'detailed', 'compliance'] as const);
export const LOGGING_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error', 'fatal'] as const);
export const LOGGING_FAMILIES = Object.freeze([
  'operational', 'security', 'records', 'views', 'clipboard', 'printing',
  'transfers', 'workflow', 'communications', 'ai', 'investigations', 'navigation',
] as const);
export const LOGGING_OUTCOMES = Object.freeze(['attempted', 'succeeded', 'denied', 'failed', 'unknown'] as const);
export const LOGGING_EVIDENCE = Object.freeze([
  'server-confirmed', 'provider-confirmed', 'browser-observed', 'estimated', 'incomplete',
] as const);

export type LoggingPreset = typeof LOGGING_PRESETS[number];
export type LoggingLevel = typeof LOGGING_LEVELS[number];
export type LoggingFamily = typeof LOGGING_FAMILIES[number];
export type LoggingOutcome = typeof LOGGING_OUTCOMES[number];
export type LoggingEvidence = typeof LOGGING_EVIDENCE[number];
export type LoggingStream = 'operational' | 'audit';
export type LoggingScalar = string | number | boolean | null;

export type LoggingScope =
  | Readonly<{ kind: 'application'; tenantId: null }>
  | Readonly<{ kind: 'tenant'; tenantId: string }>;

/** Trusted integration context; later request facades derive this server-side, never from browser claims. */
export interface LoggingContext {
  readonly sourceId: string;
  readonly origin: 'backend' | 'frontend' | 'provider' | 'system';
  readonly scope: LoggingScope;
  readonly actor: Readonly<{
    kind: 'user' | 'service' | 'system' | 'anonymous';
    id: string | null;
    sessionId: string | null;
    initiatorId: string | null;
  }>;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly policyVersion: string;
}

/** One versioned evidence envelope; ingestion time is assigned separately by the database. */
export interface LoggingEvent extends LoggingContext {
  readonly version: 1 | 2;
  readonly id: string;
  readonly stream: LoggingStream;
  readonly family: LoggingFamily;
  readonly action: string;
  readonly level: LoggingLevel;
  readonly outcome: LoggingOutcome;
  readonly evidence: LoggingEvidence;
  readonly occurredAt: number;
  readonly target: Readonly<{ type: string; id: string }> | null;
  readonly metadata: Readonly<Record<string, LoggingScalar>>;
  /** Version two retains typed activity facts; historical v1 envelopes remain byte-identical. */
  readonly detail?: import('./logging-activity-contracts').LoggingActivityDetail;
}

/** Source timestamps/IDs must be retained when retrying the same logical event. */
export interface LoggingEventInput {
  readonly id: string;
  readonly family: LoggingFamily;
  readonly action: string;
  readonly level?: LoggingLevel;
  readonly outcome: LoggingOutcome;
  readonly evidence: LoggingEvidence;
  readonly occurredAt: number;
  readonly target?: Readonly<{ type: string; id: string }> | null;
  readonly metadata?: Readonly<Record<string, LoggingScalar>>;
  readonly detail?: import('./logging-activity-contracts').LoggingActivityDetail;
}

/** Internal stored record; ordinal is a source-local position, not a global timeline or public cursor. */
export interface StoredLoggingEvent {
  readonly event: LoggingEvent;
  readonly ordinal: number;
  readonly ingestedAt: number;
}

/** Event-level replay proof survives expiration of a Fabric command receipt. */
export interface LoggingReceipt {
  readonly id: string;
  readonly sourceId: string;
  readonly ordinal: number;
  readonly duplicate: boolean;
}

/** Trusted query boundary; platform authority must be checked before using platform scope. */
export type LoggingReadScope =
  | Readonly<{ kind: 'platform' }>
  | Readonly<{ kind: 'application' }>
  | Readonly<{ kind: 'tenant'; tenantId: string }>;

/** Closed initial query vocabulary. Nested shared Filters execution is a later integration. */
export interface LoggingQuery {
  /** Exact stable [sourceId,eventId] row identities, bounded to 100 per authorized lookup. */
  readonly eventIds?: readonly string[];
  readonly limit?: number;
  /** Defaults to true. Internal cursor/membership reads can skip the matching COUNT without changing evidence selection. */
  readonly includeTotal?: boolean;
  readonly since?: number;
  readonly until?: number;
  readonly beforeOrdinal?: number;
  readonly highWaterOrdinal?: number;
  readonly family?: LoggingFamily;
  readonly action?: string;
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly outcome?: LoggingOutcome;
  readonly level?: LoggingLevel;
}

export interface LoggingPage {
  readonly events: readonly StoredLoggingEvent[];
  readonly highWaterOrdinal: number;
  readonly hasMore: boolean;
  readonly nextBeforeOrdinal: number | null;
  /** Exact retained matches at this high-water, independently of pagination. Omitted by older transports. */
  readonly total?: number;
  /** Current scoped labels, never part of a signed/historical event envelope. */
  readonly people?: readonly import('./logging-directory-contracts').LoggingPerson[];
}

/** Genuine retained appends in increasing ingestion order, with an explicit resumable cursor. */
export interface LoggingChangePage {
  readonly events: readonly StoredLoggingEvent[];
  readonly afterOrdinal: number;
  readonly throughOrdinal: number;
  readonly highWaterOrdinal: number;
  readonly hasMore: boolean;
}
