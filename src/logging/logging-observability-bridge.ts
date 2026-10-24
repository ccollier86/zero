/** Privacy-minimal backend diagnostic adapter; never treats diagnostics as durable user-action audit capture. */
import { CompositeSink } from '../observability/composite-sink';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCodeTo } from '../observability/sink';
import type { PlatformEvent, PlatformObservabilityRuntime, PlatformSink } from '../observability/types';
import type { LoggingContext } from './logging-contracts';
import { LoggingError } from './logging-error';
import type { LoggingRuntime } from './logging-runtime';
import { loggingRecord } from './logging-validation';

/** Mount only onto one app-local runtime and retain previous adapters/endpoint store unchanged. */
export function installLoggingObservabilityBridge(logging: Pick<LoggingRuntime, 'capture'>, observability: PlatformObservabilityRuntime, policyVersion = 'logging-diagnostics-v1') {
  const previous = observability.sink;
  const fallback = { ...observability, sink: previous };
  const context: LoggingContext = Object.freeze({ sourceId: 'runtime:' + crypto.randomUUID(), origin: 'backend',
    scope: Object.freeze({ kind: 'application', tenantId: null }),
    actor: Object.freeze({ kind: 'system', id: 'zero', sessionId: null, initiatorId: null }),
    requestId: null, correlationId: null, policyVersion });
  let attached = true, accepted = 0, filtered = 0, failed = 0, reported = false;
  const sink: PlatformSink = { emit(event: PlatformEvent) {
    if (!attached || observability.config.enabled === false) return;
    try {
      const e = loggingRecord(event);
      // Frontend ingestion needs a separately authenticated observation boundary.
      if (e.source !== 'backend') return;
      const promise = logging.capture(context, { id: e.id, occurredAt: e.timestamp, action: e.code, level: e.level,
        family: 'operational', outcome: 'unknown', evidence: 'server-confirmed', metadata: { category: e.category } } as Parameters<LoggingRuntime['capture']>[1], ['category']);
      return promise.then(receipt => {
        if (receipt) accepted++; else filtered++;
        reported = false;
      }, failure);
    } catch (error) { failure(error); }
  } };
  // Snapshot into logging before an existing custom adapter can mutate the normalized event.
  const combined = new CompositeSink([sink, previous]);
  observability.sink = combined;

  function failure(error: unknown): void {
    failed++;
    if (reported) return;
    reported = true;
    emitPlatformCodeTo(fallback, OBS_CODES.LOGGING_DELIVERY_FAILED, {
      metadata: { failureCode: error instanceof LoggingError ? error.code : 'LOGGING_EVENT_INVALID' },
    });
  }

  return Object.freeze({
    /** Stop intake first. Never clobber a later replacement sink when restoring ownership. */
    detach() { attached = false; if (observability.sink === combined) observability.sink = previous; },
    diagnostics() { return Object.freeze({ attached, accepted, filtered, failed }); },
  });
}
