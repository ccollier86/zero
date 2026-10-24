/** Managed app composition for optional logging. Owns publication/cleanup, not auth or user-action audit semantics. */
import { LoggingRuntime } from '../../logging/logging-runtime';
import { installLoggingObservabilityBridge } from '../../logging/logging-observability-bridge';
import { emitPlatformCodeTo } from '../../observability/sink';
import { OBS_CODES } from '../../observability/codes';
import type { PlatformObservabilityRuntime } from '../../observability/types';
import { ZERO_LOGGING_RUNTIME } from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ResolvedConfig } from './types';
import { assertManagedAppLoggingIsolation } from './app-logging-isolation';
import { installLoggingSourceCapture } from '../../logging/logging-source-capture';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { ResourceRegistry } from '../../resources/resource-registry';

/** Publish only after both actors are ready. Shutdown detaches diagnostics before draining/closing Fabric. */
export async function installManagedAppLogging(config: ResolvedConfig, runtime: ZeroAppRuntime, observability: PlatformObservabilityRuntime,
  sources?: { application: ReactiveDB; system: ReactiveDB; resources: ResourceRegistry }): Promise<void> {
  if (!config.logging) return;
  assertManagedAppLoggingIsolation(config, true);
  const fallback = { ...observability };
  const logging = await LoggingRuntime.open(config.logging, fallback);
  let bridge: ReturnType<typeof installLoggingObservabilityBridge> | null = null;
  let capture: ReturnType<typeof installLoggingSourceCapture> | null = null;
  let removeCleanup: (() => void) | null = null;
  const closeOwners = async () => {
    const failures: unknown[] = [];
    try { await capture?.close(); } catch (error) { failures.push(error); }
    try { await logging.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Logging ownership cleanup failed.');
  };
  try {
    // Adopt ownership before publishing or installing any sink.
    removeCleanup = runtime.addCleanup(async () => {
      bridge?.detach();
      runtime.clear(ZERO_LOGGING_RUNTIME, logging);
      try { await closeOwners(); }
      catch (error) { emitPlatformCodeTo(fallback, OBS_CODES.LOGGING_STOP_FAILED); throw error; }
    });
    if (sources) {
      const fields: Record<string, string> = {};
      for (const resource of sources.resources.list()) {
        if (resource.storage.kind === 'tenant' && resource.storage.isolation === 'shared-row') fields[resource.table] = resource.storage.field;
      }
      capture = installLoggingSourceCapture(logging, sources.application, sources.system, fields,
        () => emitPlatformCodeTo(fallback, OBS_CODES.LOGGING_DELIVERY_FAILED));
      logging.attachSource(capture);
    }
    runtime.set(ZERO_LOGGING_RUNTIME, logging);
    bridge = installLoggingObservabilityBridge(logging, observability, logging.config.policyVersion);
    emitPlatformCodeTo(fallback, OBS_CODES.LOGGING_STARTED);
  } catch (error) {
    bridge?.detach(); runtime.clear(ZERO_LOGGING_RUNTIME, logging); removeCleanup?.();
    try { await closeOwners(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Logging composition and cleanup failed.'); }
    throw error;
  }
}
