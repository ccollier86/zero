/** Read-only logging deployment/coverage diagnostics. Never opens workers, prunes evidence or certifies compliance. */
import { existsSync } from 'node:fs';
import type { ResolvedConfig } from '../frontend/server/types';
import { assertManagedAppLoggingIsolation } from '../frontend/server/app-logging-isolation';
import type { PlatformDoctorFindingSink } from './platform-doctor-contracts';

export function checkLogging(config: ResolvedConfig, findings: PlatformDoctorFindingSink): void {
  if (!config.logging) return;
  const docs = './docs-next/backend/logging/index.md';
  try { assertManagedAppLoggingIsolation(config, true); }
  catch { findings.push({ severity: 'error', code: 'logging.directory.unsafe', path: 'logging.rootDirectory', message: 'Logging storage overlaps another application-owned path or resolves through an unsafe filesystem alias.', hint: 'Use a private dedicated directory outside assets, Storage, app sources and the application/control/Fabric databases.', docs }); }
  if (config.logging.defaultActorEntrypoint && !existsSync(config.logging.defaultActorEntrypoint)) findings.push({ severity: 'error', code: 'logging.actor.missing', path: 'logging.actors', message: 'The default logging actor is missing from this package.', hint: 'Install the complete package or provide an explicit logging actor launch for the deployment.', docs });
  if (config.databaseTopology.mode === 'multiple' && config.logging.policy.capture.records) findings.push({ severity: 'warning', code: 'logging.coverage.fabric', path: 'logging.capture.records', message: 'Automatic record capture covers the pinned application database, not independent tenant Fabric actors.', hint: 'Declare and test actor-local durable capture before relying on complete tenant change evidence. Strict compliance remains gated.', docs });
  if (config.auth === false) findings.push({ severity: 'info', code: 'logging.api.no_auth', path: 'auth', message: 'Logging storage is enabled without Guardian; the authenticated browser/query API is not mounted.', hint: 'Use trusted server logging, or enable Guardian for the workspace and browser collector.', docs });
  if (config.logging.retention.auditDays === null) findings.push({ severity: 'info', code: 'logging.retention.indefinite', path: 'logging.retention.auditDays', message: 'Audit retention is indefinite; no automatic audit deletion is configured.', hint: 'Budget storage and set a reviewed retention period when appropriate. No universal legal period is inferred.', docs });
  findings.push({ severity: 'info', code: 'logging.coverage.declared', path: 'logging', message: 'Raw SQL, semantic record reads, and external/service outcomes require explicit instrumentation.', hint: 'Use zero.logging.run/read/record and the documented coverage matrix. Browser signals remain untrusted observations.', docs });
}
