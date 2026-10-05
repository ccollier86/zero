/**
 * types.ts
 *
 * Defines Zero's framework-independent observability contracts. This file owns
 * event, sink, store, and configuration types only; it does not emit events,
 * format console output, or depend on Elysia.
 */

/** Severity level for platform observability events. */
export type PlatformEventLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Runtime source that produced a platform event. */
export type PlatformEventSource = 'backend' | 'frontend' | 'cli' | 'test';

/** Stable code definition used by platform modules when emitting events. */
export interface PlatformCodeDefinition {
  /** Machine-readable dotted code, e.g. `sync.policy.callback_failed`. */
  code: string;
  /** Human-readable prefix used in formatted logs, e.g. `ZERO_SYNC_POLICY_CALLBACK_FAILED`. */
  prefix: string;
  /** Default event category. */
  category: string;
  /** Default severity. */
  level: PlatformEventLevel;
  /** Default safe message. */
  message: string;
}

/** Event emitted through the platform observability boundary. */
export interface PlatformEvent {
  /** Unique id assigned by the emitter/runtime. */
  id: string;
  /** Monotonic runtime sequence assigned by the emitter/runtime. */
  sequence: number;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Event source. */
  source: PlatformEventSource;
  /** Severity. */
  level: PlatformEventLevel;
  /** Stable category, such as `app`, `sync`, or `storage`. */
  category: string;
  /** Stable dotted machine code. */
  code: string;
  /** Stable formatted prefix. */
  prefix: string;
  /** Safe human-readable message. */
  message: string;
  /** Optional structured metadata. Must not include secrets. */
  metadata?: Record<string, unknown>;
  /** Optional raw error. Sinks must serialize/redact before external export. */
  error?: unknown;
  /** Optional request correlation id. */
  requestId?: string;
  /** Optional authenticated user id. */
  userId?: string;
  /** Optional distributed trace id. */
  traceId?: string;
}

/** Input accepted by emit helpers before runtime defaults are assigned. */
export interface PlatformEventInput {
  source?: PlatformEventSource;
  level: PlatformEventLevel;
  category: string;
  code: string;
  prefix?: string;
  message: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
  error?: unknown;
  requestId?: string;
  userId?: string;
  traceId?: string;
}

/** Per-event overrides when emitting a known platform code. */
export interface PlatformCodeEmitOptions {
  source?: PlatformEventSource;
  level?: PlatformEventLevel;
  category?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  error?: unknown;
  requestId?: string;
  userId?: string;
  traceId?: string;
}

/** Write-only sink consumed by platform code. */
export interface PlatformSink {
  /** Emit one normalized platform event. Sinks must be best-effort. */
  emit(event: PlatformEvent): void | Promise<void>;
}

/** Query options for a readable event store. */
export interface PlatformEventQuery {
  level?: PlatformEventLevel | PlatformEventLevel[];
  category?: string;
  code?: string;
  source?: PlatformEventSource;
  since?: number;
  cursor?: number;
  limit?: number;
}

/** Paged event-store result. */
export interface PlatformEventPage {
  events: PlatformEvent[];
  count: number;
  nextCursor: number | null;
}

/** Queryable event store used by the default platform endpoint. */
export interface PlatformEventStore extends PlatformSink {
  /** Return recent platform events matching the query. */
  query(options?: PlatformEventQuery): PlatformEventPage;
  /** Remove all stored events, primarily for tests. */
  clear?(): void;
}

/** Access modes for the default observability endpoint. */
export type ObservabilityEndpointReadMode =
  | 'admin'
  | 'development'
  | 'admin-or-dev'
  | 'disabled'
  | ObservabilityEndpointAccess;

/** Custom access callback for reading stored observability events. */
export type ObservabilityEndpointAccess = (context: {
  authContext: { userId: string; email?: string; role?: string } | null;
  request: Request;
}) => boolean | Promise<boolean>;

/** Configuration for Elysia trace event emission. */
export interface ObservabilityTraceConfig {
  /** Enable Elysia lifecycle trace emission. Default: false for this slice. */
  enabled?: boolean;
  /** Emit warning when the whole request crosses this threshold. */
  slowRequestMs?: number;
  /** Emit warning when a lifecycle block crosses this threshold. */
  slowLifecycleMs?: number;
}

/** Configuration for the default platform HTTP access point. */
export interface ObservabilityEndpointConfig {
  /** Enable endpoint registration. Default: true. */
  enabled?: boolean;
  /** Endpoint base path. Default: `/api/_zero/observability`. */
  basePath?: string;
  /** Read policy. Default: admin when auth exists, development-only otherwise. */
  read?: ObservabilityEndpointReadMode;
  /** Accept frontend event reports. Default: true. */
  frontendIngest?: boolean;
  /** Maximum frontend event report payload size in bytes. Default: 32768. */
  maxPayloadBytes?: number;
}

/** Framework-independent observability configuration accepted by createApp(). */
export interface ObservabilityConfig {
  /** Disable the platform observability runtime entirely. */
  enabled?: boolean;
  /** Add a sink to the configured console/store composite. Disable those explicitly for custom-only output. */
  sink?: PlatformSink;
  /** Replace or disable the default readable event store. */
  store?: PlatformEventStore | false;
  /** Keep console output when building a default/composite sink. Default: true. */
  console?: boolean;
  /** Memory store retention limit. Default: 1000. */
  maxEvents?: number;
  /** Configure the default HTTP access point. */
  endpoint?: false | ObservabilityEndpointConfig;
  /** Configure Elysia lifecycle trace emission. */
  trace?: false | ObservabilityTraceConfig;
}

/** Active runtime installed by the composition root. */
export interface PlatformObservabilityRuntime {
  sink: PlatformSink;
  store: PlatformEventStore | null;
  config: ObservabilityConfig;
}
