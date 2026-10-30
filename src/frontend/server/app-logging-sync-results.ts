/** Managed Sync uses the same private result receipts as native HTTP/Resource reads. */
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_LOGGING_RUNTIME } from '../../runtime/service-keys';
import type { SyncPluginConfig } from '../../sync/types';
import { loggingAuthContext } from '../../logging/logging-auth-context';
export function managedLoggingSyncResults(runtime: ZeroAppRuntime, primaryKey: (table: string) => string): Pick<SyncPluginConfig, 'prepareReadResult'> {
  return { async prepareReadResult({ authContext, table, rows, seq, epoch }) {
    const logging = runtime.get(ZERO_LOGGING_RUNTIME);
    if (!logging || !logging.config.policy.capture.records || !authContext?.userId || !authContext.sessionId) return null;
    return logging.prepareResult(loggingAuthContext(authContext, logging.config.policyVersion),
      { table, rows, kind: 'list', primaryKey: primaryKey(table), revision: `sync:${epoch}:${seq}` });
  } };
}
