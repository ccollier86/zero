/** Orchestrates Zero system-database and Guardian/Fabric projection diagnostics. */

import type { AppConfig, ResolvedConfig } from '../frontend/server/types';
import {
  checkIdentityProjectionConfiguration,
} from './platform-doctor-identity-projection';
import type { PlatformDoctorFindingSink } from './platform-doctor-contracts';
import {
  checkPreResolutionSystemDatabase as checkPreResolutionSystemDatabaseConfig,
  checkSystemDatabaseConfiguration,
} from './platform-doctor-system-database-config';
import { inspectSystemDatabaseState } from './platform-doctor-system-database-state';

/** Emit a stable targeted finding before general config resolution fails. */
export function checkPreResolutionSystemDatabase(
  config: AppConfig,
  findings: PlatformDoctorFindingSink,
): void {
  checkPreResolutionSystemDatabaseConfig(config, findings);
}

/** Check system-plane durability, ownership, and identity-projection health. */
export function checkSystemDatabase(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  env: Record<string, string | undefined>,
  projectRoot?: string,
): void {
  checkSystemDatabaseConfiguration(resolved, findings, env, projectRoot);
  const projection = checkIdentityProjectionConfiguration(resolved, findings);
  if (!projectRoot) return;
  inspectSystemDatabaseState(resolved, findings, projectRoot, projection);
}
