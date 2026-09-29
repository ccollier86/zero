/**
 * sink.ts
 *
 * Owns the active process-wide observability runtime and emission helpers.
 * Platform modules depend on this small boundary instead of concrete loggers,
 * stores, Elysia context, or external telemetry SDKs.
 */

import { CompositeSink } from './composite-sink';
import { ConsoleSink } from './console-sink';
import { MemoryEventStore } from './memory-event-store';
import type {
  ObservabilityConfig,
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformEvent,
  PlatformEventInput,
  PlatformEventStore,
  PlatformObservabilityRuntime,
  PlatformSink,
} from './types';

const runtimeSequences = new WeakMap<object, number>();
let runtime: PlatformObservabilityRuntime = createRuntime({});

/** Configure the active process-wide observability runtime. */
export function configureObservability(config: ObservabilityConfig | false | undefined): PlatformObservabilityRuntime {
  runtime = createRuntime(config === false ? { enabled: false } : config ?? {});
  return runtime;
}

/** Return the active observability runtime. */
export function getObservabilityRuntime(): PlatformObservabilityRuntime {
  return runtime;
}

/** Return the active write-only sink. */
export function getPlatformSink(): PlatformSink {
  return runtime.sink;
}

/** Return the active readable event store, when configured. */
export function getPlatformEventStore(): PlatformEventStore | null {
  return runtime.store;
}

/** Replace the active sink while preserving the current store/config. */
export function setPlatformSink(sink: PlatformSink): void {
  const previous = runtime;
  runtime = { ...runtime, sink };
  runtimeSequences.set(runtime, runtimeSequences.get(previous) ?? 0);
}

/** Emit a fully custom platform event. */
export function emitPlatformEvent(input: PlatformEventInput): PlatformEvent {
  return emitPlatformEventTo(runtime, input);
}

/** Emit through an explicitly app-bound observability runtime. */
export function emitPlatformEventTo(
  target: PlatformObservabilityRuntime,
  input: PlatformEventInput,
): PlatformEvent {
  const current = (runtimeSequences.get(target) ?? 0) + 1;
  runtimeSequences.set(target, current);
  const event = normalizeEvent(input, current);

  try {
    const result = target.sink.emit(event);
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // Observability is best-effort by design.
  }

  return event;
}

/** Emit a known platform code with optional overrides. */
export function emitPlatformCode(
  definition: PlatformCodeDefinition,
  options: PlatformCodeEmitOptions = {}
): PlatformEvent {
  return emitPlatformEvent({
    source: options.source,
    level: options.level ?? definition.level,
    category: options.category ?? definition.category,
    code: definition.code,
    prefix: definition.prefix,
    message: options.message ?? definition.message,
    metadata: options.metadata,
    error: options.error,
    requestId: options.requestId,
    userId: options.userId,
    traceId: options.traceId,
  });
}

/** Emit a known code through an explicitly app-bound observability runtime. */
export function emitPlatformCodeTo(
  target: PlatformObservabilityRuntime,
  definition: PlatformCodeDefinition,
  options: PlatformCodeEmitOptions = {},
): PlatformEvent {
  return emitPlatformEventTo(target, {
    source: options.source,
    level: options.level ?? definition.level,
    category: options.category ?? definition.category,
    code: definition.code,
    prefix: definition.prefix,
    message: options.message ?? definition.message,
    metadata: options.metadata,
    error: options.error,
    requestId: options.requestId,
    userId: options.userId,
    traceId: options.traceId,
  });
}

/** Emit a known code as an info event. */
export function logPlatformInfo(
  definition: PlatformCodeDefinition,
  options: PlatformCodeEmitOptions = {}
): PlatformEvent {
  return emitPlatformCode(definition, { ...options, level: 'info' });
}

/** Emit a known code as a warning event. */
export function warnPlatform(
  definition: PlatformCodeDefinition,
  options: PlatformCodeEmitOptions = {}
): PlatformEvent {
  return emitPlatformCode(definition, { ...options, level: 'warn' });
}

/** Emit a known code as an error event. */
export function errorPlatform(
  definition: PlatformCodeDefinition,
  options: PlatformCodeEmitOptions = {}
): PlatformEvent {
  return emitPlatformCode(definition, { ...options, level: 'error' });
}

function createRuntime(config: ObservabilityConfig): PlatformObservabilityRuntime {
  if (config.enabled === false) {
    return {
      sink: { emit() {} },
      store: null,
      config,
    };
  }

  const store = config.store === false
    ? null
    : config.store ?? new MemoryEventStore({ maxEvents: config.maxEvents });

  const sinks: PlatformSink[] = [];
  if (config.console !== false) sinks.push(new ConsoleSink());
  if (store) sinks.push(store);
  if (config.sink) sinks.push(config.sink);

  return {
    sink: sinks.length === 1 ? sinks[0] : new CompositeSink(sinks),
    store,
    config,
  };
}

function normalizeEvent(
  input: PlatformEventInput,
  current: number,
): PlatformEvent {
  return {
    id: `obs_${current}`,
    sequence: current,
    timestamp: input.timestamp ?? Date.now(),
    source: input.source ?? 'backend',
    level: input.level,
    category: input.category,
    code: input.code,
    prefix: input.prefix ?? prefixFromCode(input.code),
    message: input.message,
    metadata: sanitizeMetadata(input.metadata),
    error: input.error,
    requestId: input.requestId,
    userId: input.userId,
    traceId: input.traceId,
  };
}

function prefixFromCode(code: string): string {
  return `ZERO_${code}`.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveKey(key)) {
      clean[key] = '[redacted]';
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function isSensitiveKey(key: string): boolean {
  return /token|secret|password|authorization|cookie|credential/i.test(key);
}
