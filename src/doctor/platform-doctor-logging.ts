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
  if (config.databaseTopology.mode === 'multiple' && config.logging.policy.capture.records) findings.push({ severity: 'info', code: 'logging.coverage.fabric', path: 'logging.capture.records', message: 'Managed tenant/named Fabric ReactiveDB writes install actor-local same-commit audit capture.', hint: 'Keep the private source catalog and source queues intact. Source crash guarantees follow the selected placement/durability. Raw SQL and external/service outcomes still require explicit capture.', docs });
  if (config.databaseTopology.mode === 'multiple' && config.logging.policy.capture.records && config.databaseTopology.placement.hot && config.databaseTopology.placement.hot.durability !== 'on-write') findings.push({ severity: 'warning', code: 'logging.durability.hot_source', path: 'databaseTopology.placement', message: 'Hot sources without on-write durability may lose an acknowledged business change and its source evidence together after a crash.', hint: 'Use file/FULL or hot on-write placement for required crash-durable source evidence. The logging sink cannot repair missing source commits.', docs });
  if (config.auth === false) findings.push({ severity: 'info', code: 'logging.api.no_auth', path: 'auth', message: 'Logging storage is enabled without Guardian; the authenticated browser/query API is not mounted.', hint: 'Use trusted server logging, or enable Guardian for the workspace and browser collector.', docs });
  if (config.logging.retention.auditDays === null) findings.push({ severity: 'info', code: 'logging.retention.indefinite', path: 'logging.retention.auditDays', message: 'Audit retention is indefinite; no automatic audit deletion is configured.', hint: 'Budget storage and set a reviewed retention period when appropriate. No universal legal period is inferred.', docs });
  findings.push({ severity: 'info', code: 'logging.coverage.declared', path: 'logging', message: 'Raw SQL, semantic record reads, and external/service outcomes require explicit instrumentation.', hint: 'Use zero.logging.run/read/record and the documented coverage matrix. Browser signals remain untrusted observations.', docs });
}
