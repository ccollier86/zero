/**
 * index.ts
 *
 * Public observability barrel. Exports the framework-neutral sink contracts,
 * default adapters, stable codes, and the Elysia integration plugin.
 */

export { OBS_CODES } from './codes';
export type { ObservabilityCodeName } from './codes';
export { ConsoleSink, formatConsoleEvent } from './console-sink';
export { CompositeSink } from './composite-sink';
export { MemoryEventStore } from './memory-event-store';
export {
  configureObservability,
  emitPlatformCode,
  emitPlatformEvent,
  errorPlatform,
  getObservabilityRuntime,
  getPlatformEventStore,
  getPlatformSink,
  logPlatformInfo,
  setPlatformSink,
  warnPlatform,
} from './sink';
export { createObservabilityPlugin } from './plugin';
export type { ObservabilityPluginConfig } from './plugin';
export type {
  ObservabilityConfig,
  ObservabilityEndpointAccess,
  ObservabilityEndpointConfig,
  ObservabilityEndpointReadMode,
  ObservabilityTraceConfig,
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformEvent,
  PlatformEventInput,
  PlatformEventLevel,
  PlatformEventPage,
  PlatformEventQuery,
  PlatformEventSource,
  PlatformEventStore,
  PlatformObservabilityRuntime,
  PlatformSink,
} from './types';
