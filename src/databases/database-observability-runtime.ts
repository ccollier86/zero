/**
 * database-observability-runtime.ts
 *
 * App-local emission boundary for validated ReactiveDB Fabric events.
 */

import { emitPlatformCodeTo } from '../observability/sink';
import type {
  PlatformEvent,
  PlatformObservabilityRuntime,
} from '../observability/types';
import type { DatabaseObservabilityEvent } from './database-observability-contract';
import { prepareDatabaseObservabilityEvent } from './database-observability-validation';

/**
 * App-local emitter that never falls back to process-global observability.
 *
 * Executor children should relay the closed event shape to their parent. They
 * must not configure or emit through ambient process-global observability,
 * which would bypass the owning app runtime and can duplicate console output.
 */
export class DatabaseObservability {
  readonly #runtime: PlatformObservabilityRuntime;

  constructor(runtime: PlatformObservabilityRuntime) {
    assertObservabilityRuntime(runtime);
    this.#runtime = runtime;
  }

  /** Emit one validated database event to this app's runtime. */
  emit(event: DatabaseObservabilityEvent): PlatformEvent {
    return emitDatabaseObservabilityEvent(this.#runtime, event);
  }
}

/** Create an emitter bound to exactly one application's observability runtime. */
export function createDatabaseObservability(
  runtime: PlatformObservabilityRuntime,
): DatabaseObservability {
  return new DatabaseObservability(runtime);
}

/** Emit one database event through an explicit app-local runtime. */
export function emitDatabaseObservabilityEvent(
  runtime: PlatformObservabilityRuntime,
  event: DatabaseObservabilityEvent,
): PlatformEvent {
  assertObservabilityRuntime(runtime);
  const prepared = prepareDatabaseObservabilityEvent(event);
  return emitPlatformCodeTo(runtime, prepared.definition, {
    metadata: { ...prepared.metadata },
  });
}

function assertObservabilityRuntime(
  runtime: PlatformObservabilityRuntime,
): void {
  if (!runtime
    || typeof runtime !== 'object'
    || !runtime.sink
    || typeof runtime.sink.emit !== 'function') {
    throw new TypeError('A valid app-local observability runtime is required.');
  }
}
