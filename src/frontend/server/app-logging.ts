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

/** Publish only after both actors are ready. Shutdown detaches diagnostics before draining/closing Fabric. */
export async function installManagedAppLogging(config: ResolvedConfig, runtime: ZeroAppRuntime, observability: PlatformObservabilityRuntime): Promise<void> {
  if (!config.logging) return;
  assertManagedAppLoggingIsolation(config, true);
  const fallback = { ...observability };
  const logging = await LoggingRuntime.open(config.logging, fallback);
  let bridge: ReturnType<typeof installLoggingObservabilityBridge> | null = null;
  let removeCleanup: (() => void) | null = null;
  try {
    // Adopt ownership before publishing or installing any sink.
    removeCleanup = runtime.addCleanup(async () => {
      bridge?.detach();
      runtime.clear(ZERO_LOGGING_RUNTIME, logging);
      try { await logging.close(); }
      catch (error) { emitPlatformCodeTo(fallback, OBS_CODES.LOGGING_STOP_FAILED); throw error; }
    });
    runtime.set(ZERO_LOGGING_RUNTIME, logging);
    bridge = installLoggingObservabilityBridge(logging, observability);
    emitPlatformCodeTo(fallback, OBS_CODES.LOGGING_STARTED);
  } catch (error) {
    bridge?.detach(); runtime.clear(ZERO_LOGGING_RUNTIME, logging); removeCleanup?.();
    try { await logging.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Logging composition and cleanup failed.'); }
    throw error;
  }
}
