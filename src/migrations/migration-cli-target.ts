/**
 * Resolves the database target for the standalone migration CLI.
 * Framework migrations own the separated system plane; schema inspection is
 * an explicit application-database operation and never inherits that target.
 */

export const DEFAULT_SYSTEM_MIGRATION_DATABASE_PATH = './data/zero.system.db';

export type MigrationCliTarget = Readonly<{
  path: string;
  plane: 'system' | 'application-schema';
  source: '--db' | 'SYSTEM_DB_PATH' | 'default';
}>;

/** Resolve a fail-closed database target for one migration CLI operation. */
export function resolveMigrationCliTarget(params: {
  explicitDbPath?: string;
  systemDbPath?: string;
  schemaInspection: boolean;
}): MigrationCliTarget {
  const explicitDbPath = normalizePath(params.explicitDbPath);

  if (params.schemaInspection) {
    if (!explicitDbPath) {
      throw new Error(
        '[migrator] App schema inspection requires --db <application-db>. ' +
        'It never falls back to the managed system database.',
      );
    }
    return Object.freeze({
      path: explicitDbPath,
      plane: 'application-schema',
      source: '--db',
    });
  }

  if (explicitDbPath) {
    return Object.freeze({
      path: explicitDbPath,
      plane: 'system',
      source: '--db',
    });
  }

  const systemDbPath = normalizePath(params.systemDbPath);
  if (systemDbPath) {
    return Object.freeze({
      path: systemDbPath,
      plane: 'system',
      source: 'SYSTEM_DB_PATH',
    });
  }

  return Object.freeze({
    path: DEFAULT_SYSTEM_MIGRATION_DATABASE_PATH,
    plane: 'system',
    source: 'default',
  });
}

function normalizePath(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
