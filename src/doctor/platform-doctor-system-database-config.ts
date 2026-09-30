/** Configuration and ownership diagnostics for Zero's pinned system database. */

import { resolveControlDatabasePaths } from '../databases/database-directory-isolation';
import { readDatabaseCaughtErrorDataProperty } from '../databases/database-error-inspection';
import { canonicalDatabaseOwnershipPathKey } from '../databases/database-path-ownership';
import type { AppConfig, ResolvedConfig } from '../frontend/server/types';
import {
  resolveSystemDatabaseConfig,
  resolveSystemDatabaseOwnedPaths,
} from '../frontend/server/system-database-config';
import { resolveSQLiteStorageConfig } from '../persistence/storage-config';
import type { ReactiveDBConfig } from '../sync/types';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

export const SYSTEM_DATABASE_DOCS = './docs/framework/system-database.md';

/** Emit a stable targeted finding before general config resolution fails. */
export function checkPreResolutionSystemDatabase(
  config: AppConfig,
  findings: PlatformDoctorFindingSink,
): void {
  try {
    resolveSystemDatabaseConfig(config.db, config.systemDb);
  } catch (error) {
    const caughtMessage = readDatabaseCaughtErrorDataProperty(error, 'message');
    const message = typeof caughtMessage === 'string' ? caughtMessage : '';
    if (!message.includes('db and systemDb')) return;
    addFinding(findings, {
      severity: 'error',
      code: 'database.system.overlaps_application',
      path: 'systemDb',
      message: 'The system and application database planes resolve to the same handle or owned SQLite path.',
      hint: 'Give systemDb its own SQLite service and durable path. Keep its main, snapshot, WAL, SHM, journal, and derived authority-fence files separate from db.',
      docs: `${SYSTEM_DATABASE_DOCS}#configuration-and-server-surface`,
    });
  }
}

/** Check durability and canonical filesystem isolation for the two pinned planes. */
export function checkSystemDatabaseConfiguration(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  env: Record<string, string | undefined>,
  projectRoot?: string,
): void {
  checkSystemDurability(resolved, findings, env);
  if (projectRoot) checkCanonicalPlaneIsolation(resolved, findings, projectRoot);
}

function checkSystemDurability(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  env: Record<string, string | undefined>,
): void {
  const mode = effectiveStorageMode(resolved.systemDb);
  const authoritative = resolved.auth !== false || resolved.stateSync;
  const production = env.NODE_ENV === 'production';

  if (mode === 'ephemeral') {
    addFinding(findings, {
      severity: authoritative && production ? 'error' : authoritative ? 'warning' : 'info',
      code: authoritative && production
        ? 'database.system.ephemeral_authority_production'
        : authoritative
          ? 'database.system.ephemeral_authority'
          : 'database.system.ephemeral',
      path: 'systemDb.mode',
      message: authoritative
        ? 'Guardian or State Sync authority is configured on an ephemeral system database.'
        : 'The system database is ephemeral; platform state is discarded when this process stops.',
      hint: authoritative
        ? 'Use systemDb mode "file" on a persistent volume before serving durable accounts or user state.'
        : 'Use file mode when Zero-owned state must survive restart.',
      docs: `${SYSTEM_DATABASE_DOCS}#configuration-and-server-surface`,
    });
    return;
  }

  if (mode === 'hot' && authoritative) {
    addFinding(findings, {
      severity: production ? 'error' : 'warning',
      code: production
        ? 'database.system.hot_authority_production'
        : 'database.system.hot_authority',
      path: 'systemDb.mode',
      message: 'The authoritative system database uses interval-snapshot hot storage, so acknowledged authority changes can precede their durable snapshot.',
      hint: 'Use systemDb mode "file" for Guardian and other authoritative Zero state.',
      docs: `${SYSTEM_DATABASE_DOCS}#configuration-and-server-surface`,
    });
    return;
  }

  addFinding(findings, {
    severity: 'info',
    code: 'database.system.separate_plane',
    path: 'systemDb',
    message: `Zero-owned state uses a separate ${mode} system database; db remains the application plane.`,
    docs: SYSTEM_DATABASE_DOCS,
  });
}

function checkCanonicalPlaneIsolation(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  projectRoot: string,
): void {
  try {
    const appPaths = new Set(resolveControlDatabasePaths(resolved.db)
      .map((path) => canonicalDatabaseOwnershipPathKey(path, projectRoot)));
    const collision = resolveSystemDatabaseOwnedPaths(resolved.systemDb)
      .map((path) => canonicalDatabaseOwnershipPathKey(path, projectRoot))
      .some((path) => appPaths.has(path));
    if (!collision) return;
    addFinding(findings, {
      severity: 'error',
      code: 'database.system.filesystem_alias_collision',
      path: 'systemDb',
      message: 'The system and application database paths resolve through the filesystem to the same owned SQLite or authority-fence file.',
      hint: 'Move one plane to a separate path and do not separate database ownership with symlink aliases.',
      docs: `${SYSTEM_DATABASE_DOCS}#configuration-and-server-surface`,
    });
  } catch {
    addFinding(findings, {
      severity: 'warning',
      code: 'database.system.path_inspection_unavailable',
      path: 'systemDb',
      message: 'Doctor could not verify system/application filesystem aliases.',
      hint: 'Verify both paths and their existing ancestors are readable, then rerun Doctor before deployment.',
      docs: `${SYSTEM_DATABASE_DOCS}#operations-and-diagnostics`,
    });
  }
}

function effectiveStorageMode(config: ReactiveDBConfig): 'ephemeral' | 'file' | 'hot' {
  return config.sqlite?.mode ?? resolveSQLiteStorageConfig(config).mode;
}
