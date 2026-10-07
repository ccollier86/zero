/**
 * platform-doctor.ts
 *
 * Compatibility facade and thin orchestrator for app-level Zero
 * configuration checks. Focused checker modules own individual domains; this
 * file owns ordering, config resolution, pass/fail policy, and public exports.
 */

import { resolve } from 'node:path';

import type { AuthBehaviorConfig } from '../auth/types';
import {
  resolveConfig,
  type AppConfig,
  type ResolvedConfig,
} from '../frontend/server/types';
import { checkNativeAuthConfig } from './native-auth-checks';
import { checkAI, checkVector } from './platform-doctor-ai-vector';
import {
  checkAuthAndEmail,
  checkAuthPublicPaths,
  resolveDoctorAuthConfig,
} from './platform-doctor-auth-email';
import {
  createPlatformDoctorFindingSink,
  type PlatformDoctorFinding,
  type PlatformDoctorReport,
} from './platform-doctor-contracts';
import {
  checkDatabaseTopology,
  checkPreResolutionDatabaseDirectoryIsolation,
} from './platform-doctor-database';
import {
  checkConfiguredDatabaseAutomations,
  checkUnresolvedDatabaseAutomations,
} from './platform-doctor-database-automation-config';
import {
  checkPreResolutionSystemDatabase,
  checkSystemDatabase,
} from './platform-doctor-system-database';
import {
  checkMigrations,
  checkPreResolutionConfig,
  checkSyncPolicy,
  checkTableSchemas,
} from './platform-doctor-data';
import { checkObservability, checkStorage } from './platform-doctor-operations';
import type { PlatformDoctorOptions } from './platform-doctor-options';
import { checkPdf } from './platform-doctor-pdf';
import { checkResources } from './platform-doctor-resources';
import { runUsageAudit, usageAuditProjectRootMismatch } from './usage-audit';

export type {
  PlatformDoctorFinding,
  PlatformDoctorReport,
  PlatformDoctorSeverity,
} from './platform-doctor-contracts';
export type { PlatformDoctorOptions } from './platform-doctor-options';

/**
 * Run platform-level checks against a createApp config object.
 *
 * Warnings do not fail by default. Pass `strict: true` to make warnings fail
 * CI while preserving local developer velocity.
 */
export function runPlatformDoctor(
  config: AppConfig,
  options: PlatformDoctorOptions = {},
): PlatformDoctorReport {
  const findings: PlatformDoctorFinding[] = [];
  const sink = createPlatformDoctorFindingSink(findings);
  const env = options.env ?? process.env;

  checkPreResolutionConfig(config, sink);
  checkPreResolutionSystemDatabase(config, sink);
  checkPreResolutionDatabaseDirectoryIsolation(config, sink);
  checkNativeAuthConfig(config, findings);

  let resolved: ResolvedConfig | null = null;
  try {
    resolved = resolveConfig(config.projectRoot === undefined && options.projectRoot
      ? { ...config, projectRoot: resolve(options.projectRoot) }
      : config, env);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'createApp config could not be resolved.';
    const authFailure = message.startsWith('[auth]')
      || message.startsWith('[native-auth]');
    sink.push({
      severity: 'error',
      code: authFailure ? 'auth.config.invalid' : 'config.invalid',
      path: authFailure ? 'auth' : 'createApp',
      message,
      hint: authFailure
        ? 'Fix the auth configuration before starting the application.'
        : 'Fix the createApp config error first; follow-up doctor checks may be skipped until config resolves.',
      ...(authFailure ? { docs: './docs/auth/README.md' } : {}),
    });
  }

  checkTableSchemas(config.tables, sink);

  if (!resolved) {
    checkUnresolvedDatabaseAutomations(config, sink);
  }

  if (resolved) {
    const rootMismatch = options.projectRoot
      ? usageAuditProjectRootMismatch(options.projectRoot, resolved)
      : null;
    if (rootMismatch) sink.push(rootMismatch);
    const doctorAuthConfig = resolveDoctorAuthConfig(
      resolved.auth === false ? {} : resolved.auth as AuthBehaviorConfig,
      sink,
    );
    checkAuthAndEmail(resolved, sink, env, doctorAuthConfig);
    checkStorage(resolved, sink, env);
    checkMigrations(resolved, sink);
    checkSystemDatabase(resolved, sink, env,
      options.projectRoot && !rootMismatch ? resolved.projectRoot : undefined);
    checkDatabaseTopology(resolved, sink);
    checkConfiguredDatabaseAutomations(resolved, sink);
    checkSyncPolicy(resolved, sink);
    checkResources(resolved, sink, doctorAuthConfig);
    checkAuthPublicPaths(resolved, sink);
    checkObservability(resolved, sink, env);
    checkAI(resolved, sink, env);
    checkVector(resolved, sink);
    checkPdf(resolved, sink);
    if (!rootMismatch) checkUsageAudit(resolved, findings, options);
  }

  const hasError = findings.some((finding) => finding.severity === 'error');
  const hasWarning = findings.some((finding) => finding.severity === 'warning');
  return {
    findings,
    ok: options.strict ? !hasError && !hasWarning : !hasError,
  };
}

function checkUsageAudit(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFinding[],
  options: PlatformDoctorOptions,
): void {
  if (!options.projectRoot || options.usageAudit === false) return;

  findings.push(...runUsageAudit({
    projectRoot: options.projectRoot,
    resolvedConfig: resolved,
    options: options.usageAudit,
  }));
}
