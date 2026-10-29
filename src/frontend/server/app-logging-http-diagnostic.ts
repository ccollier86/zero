/** Payload-free transport diagnostics. Semantic access auditing belongs to the service that knows the records. */
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_LOGGING_RUNTIME, ZERO_OBSERVABILITY_RUNTIME } from '../../runtime/service-keys';
import { emitPlatformEventTo } from '../../observability/sink';

export type LoggingHttpStage = 'admitted' | 'prepared' | 'completed' | 'incomplete' | 'failed';

export function loggingHttpDiagnostic(runtime: ZeroAppRuntime, stage: LoggingHttpStage, requestId: string): void {
  const warning = stage === 'incomplete' || stage === 'failed';
  if (!warning && !runtime.get(ZERO_LOGGING_RUNTIME)?.config.policy.diagnostics.http) return;
  const observability = runtime.get(ZERO_OBSERVABILITY_RUNTIME);
  if (!observability) return;
  emitPlatformEventTo(observability, {
    level: warning ? 'warn' : 'debug', category: 'http', code: 'access.http.' + stage,
    message: warning ? 'Protected HTTP delivery did not complete.' : 'Protected HTTP transport stage.', requestId,
  });
}
