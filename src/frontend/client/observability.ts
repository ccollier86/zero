'use client';

/**
 * observability.ts
 *
 * Browser-side observability boundary for Zero apps. This file owns frontend
 * event emission and default browser adapters only; backend storage, routing,
 * and event querying live in the server observability plugin.
 */

import { OBS_CODES } from '../../observability/codes';
import type {
  PlatformCodeDefinition,
  PlatformEventLevel,
} from '../../observability/types';

/** Browser event payload sent to the platform ingest endpoint. */
export interface FrontendObservabilityEvent {
  level: PlatformEventLevel;
  category: string;
  code: string;
  prefix?: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: unknown;
  requestId?: string;
  traceId?: string;
}

/** Write-only browser sink. */
export interface FrontendObservabilitySink {
  /** Emit one frontend event. Must be best-effort. */
  emit(event: FrontendObservabilityEvent): void | Promise<void>;
}

/** Frontend observability configuration. */
export interface FrontendObservabilityConfig {
  /** Replace the default sink. */
  sink?: FrontendObservabilitySink;
  /** Ingest endpoint path. Default: `/api/_zero/observability/events`. */
  endpoint?: string;
  /** Also print through browser console. Default: true. */
  console?: boolean;
  /** Send events to backend ingest endpoint. Default: true. */
  http?: boolean;
}

let sink: FrontendObservabilitySink | null = null;

/** Configure the browser-side observability sink. */
export function configureFrontendObservability(config: FrontendObservabilityConfig = {}): FrontendObservabilitySink {
  sink = config.sink ?? createDefaultFrontendSink(config);
  return sink;
}

/** Return the active browser-side sink. */
export function getFrontendObservabilitySink(): FrontendObservabilitySink {
  if (!sink) sink = createDefaultFrontendSink();
  return sink;
}

/** Emit a frontend observability event. */
export function emitFrontendEvent(event: FrontendObservabilityEvent): void {
  try {
    const result = getFrontendObservabilitySink().emit(normalizeFrontendEvent(event));
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // Frontend observability must never break rendering or interaction.
  }
}

/** Emit a frontend event from a stable platform code definition. */
export function emitFrontendCode(
  definition: PlatformCodeDefinition,
  options: Partial<FrontendObservabilityEvent> = {}
): void {
  emitFrontendEvent({
    level: options.level ?? definition.level,
    category: options.category ?? definition.category,
    code: definition.code,
    prefix: definition.prefix,
    message: options.message ?? definition.message,
    metadata: options.metadata,
    error: options.error,
    requestId: options.requestId,
    traceId: options.traceId,
  });
}

/** Browser console adapter for frontend events. */
export class ConsoleFrontendSink implements FrontendObservabilitySink {
  emit(event: FrontendObservabilityEvent): void {
    const line = `[${event.prefix ?? prefixFromCode(event.code)}] ${event.code}: ${event.message}`;
    const details = event.error || event.metadata ? {
      metadata: event.metadata,
      error: serializeError(event.error),
    } : undefined;

    if (event.level === 'fatal' || event.level === 'error') {
      details ? console.error(line, details) : console.error(line);
      return;
    }
    if (event.level === 'warn') {
      details ? console.warn(line, details) : console.warn(line);
      return;
    }
    if (event.level === 'debug') {
      details ? console.debug(line, details) : console.debug(line);
      return;
    }
    details ? console.log(line, details) : console.log(line);
  }
}

/** HTTP adapter that sends frontend events to the Zero backend ingest route. */
export class HttpFrontendSink implements FrontendObservabilitySink {
  constructor(private readonly endpoint = '/api/_zero/observability/events') {}

  async emit(event: FrontendObservabilityEvent): Promise<void> {
    if (typeof fetch === 'undefined') return;

    await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify(normalizeFrontendEvent(event)),
    });
  }
}

/** Fan-out browser sink. */
export class CompositeFrontendSink implements FrontendObservabilitySink {
  constructor(private readonly sinks: FrontendObservabilitySink[]) {}

  emit(event: FrontendObservabilityEvent): void {
    for (const target of this.sinks) {
      try {
        const result = target.emit(event);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        // Keep browser observability best-effort.
      }
    }
  }
}

function createDefaultFrontendSink(config: FrontendObservabilityConfig = {}): FrontendObservabilitySink {
  const sinks: FrontendObservabilitySink[] = [];
  if (config.console !== false) sinks.push(new ConsoleFrontendSink());
  if (config.http !== false) sinks.push(new HttpFrontendSink(config.endpoint));
  return sinks.length === 1 ? sinks[0] : new CompositeFrontendSink(sinks);
}

function normalizeFrontendEvent(event: FrontendObservabilityEvent): FrontendObservabilityEvent {
  return {
    ...event,
    prefix: event.prefix ?? prefixFromCode(event.code),
    metadata: sanitizeMetadata(event.metadata),
    error: serializeError(event.error),
  };
}

function prefixFromCode(code: string): string {
  return `ZERO_${code}`.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    clean[key] = /token|secret|password|authorization|cookie|credential/i.test(key)
      ? '[redacted]'
      : value;
  }
  return clean;
}

export { OBS_CODES as FRONTEND_OBS_CODES };
