/**
 * console-sink.ts
 *
 * Formats Zero observability events for the process console. This sink preserves
 * the existing developer experience while using stable codes and prefixes.
 */

import type { PlatformEvent, PlatformSink } from './types';

/** Console-backed platform sink. */
export class ConsoleSink implements PlatformSink {
  /** Emit one event to the matching console method. */
  emit(event: PlatformEvent): void {
    const line = formatConsoleEvent(event);
    const details = buildDetails(event);

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

/** Format a platform event into a one-line console message. */
export function formatConsoleEvent(event: PlatformEvent): string {
  const ts = new Date(event.timestamp).toISOString();
  return `${ts} ${event.level.toUpperCase()} [${event.prefix}] ${event.code}: ${event.message}`;
}

function buildDetails(event: PlatformEvent): Record<string, unknown> | null {
  const details: Record<string, unknown> = {};
  if (event.requestId) details.requestId = event.requestId;
  if (event.userId) details.userId = event.userId;
  if (event.traceId) details.traceId = event.traceId;
  if (event.metadata && Object.keys(event.metadata).length > 0) details.metadata = event.metadata;
  if (event.error) details.error = serializeError(event.error);
  return Object.keys(details).length > 0 ? details : null;
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
