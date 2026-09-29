/** Durable identity for the resolved authorization registry. */

import { createHash } from 'node:crypto';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthAuditService } from './auth-audit-service';
import type {
  AuthTenancyMode,
  ResolvedAuthAuthorizationConfig,
} from './types';
import { AuthError } from './types';

export const AUTH_AUTHORIZATION_MANIFEST_TABLE =
  '_auth_authorization_manifest';

/** Bump whenever framework code changes how an unchanged registry grants authority. */
export const AUTHORIZATION_EVALUATOR_VERSION = 1;

/** Private singleton schema shared by runtime creation and migration 027. */
export function defineAuthAuthorizationManifestTable(
  db: Pick<ReactiveDB, 'exec'>,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${AUTH_AUTHORIZATION_MANIFEST_TABLE} (
      singleton        INTEGER PRIMARY KEY CHECK (singleton = 1),
      version          INTEGER NOT NULL CHECK (version = 1),
      registry_version INTEGER NOT NULL CHECK (registry_version >= 1),
      fingerprint      TEXT NOT NULL CHECK (length(fingerprint) = 64),
      manifest_json    TEXT NOT NULL,
      updated_at       INTEGER NOT NULL CHECK (updated_at >= 0)
    )
  `);
}

export interface InstalledAuthorizationManifest {
  readonly version: 1;
  readonly registryVersion: number;
  readonly fingerprint: string;
  /** Canonical, secret-free authorization semantics used for diagnostics. */
  readonly manifestJson: string;
}

export type AuthorizationManifestTransitionKind =
  | 'initialized'
  | 'unchanged'
  | 'updated';

export interface AuthorizationManifestTransition {
  readonly kind: AuthorizationManifestTransitionKind;
  readonly previous: InstalledAuthorizationManifest | null;
  readonly committed: InstalledAuthorizationManifest;
}

/**
 * Reconcile one explicitly versioned registry inside the caller's startup
 * transaction. Reusing a version for different authority semantics fails
 * closed; a deliberate semantic change must monotonically bump
 * `authorization.registryVersion`.
 */
export function reconcileAuthorizationManifest(input: {
  db: ReactiveDB;
  authorization: ResolvedAuthAuthorizationConfig;
  tenancy: AuthTenancyMode;
  audit?: AuthAuditService;
  /**
   * The surrounding installed-profile transition acknowledges only a change to
   * the manifest's tenancy/mode axes. Registry semantics still require their
   * own monotonically incremented `authorization.registryVersion`.
   */
  allowProfileAxisChange?: boolean;
}): AuthorizationManifestTransition {
  defineAuthAuthorizationManifestTable(input.db);
  const previous = readInstalledAuthorizationManifest(input.db);
  const requested = createAuthorizationManifest(
    input.authorization,
    input.tenancy,
  );

  if (previous) {
    if (requested.registryVersion < previous.registryVersion) {
      throw registryVersionError(
        `Runtime authorization registry version ${requested.registryVersion} is older than `
          + `installed version ${previous.registryVersion}. Restore the installed configuration `
          + 'or deploy a newer explicitly versioned registry.',
      );
    }
    if (requested.registryVersion === previous.registryVersion
      && requested.fingerprint !== previous.fingerprint
      && !(input.allowProfileAxisChange === true
        && isProfileAxisOnlyChange(previous, requested))) {
      throw registryVersionError(
        `Authorization registry version ${requested.registryVersion} was reused with different `
          + 'role or permission semantics. Increment auth.authorization.registryVersion to '
          + 'acknowledge this authority change explicitly.',
      );
    }
    if (requested.registryVersion === previous.registryVersion
      && requested.fingerprint === previous.fingerprint) {
      return Object.freeze({
        kind: 'unchanged' as const,
        previous,
        committed: previous,
      });
    }
  }

  if (previous) {
    assertNoImplicitRoleReactivation(input.db, previous, requested);
  }

  persistAuthorizationManifest(input.db, previous, requested);
  appendManifestAudit(input.audit, previous, requested);
  return Object.freeze({
    kind: previous ? 'updated' as const : 'initialized' as const,
    previous,
    committed: requested,
  });
}

/** Build the canonical semantic identity for a resolved registry. */
export function createAuthorizationManifest(
  authorization: ResolvedAuthAuthorizationConfig,
  tenancy: AuthTenancyMode,
): InstalledAuthorizationManifest {
  const manifestJson = stableStringify({
    version: 1,
    evaluatorVersion: AUTHORIZATION_EVALUATOR_VERSION,
    tenancy,
    mode: authorization.mode,
    permissions: Object.values(authorization.permissions)
      .sort((left, right) => compareKeys(left.key, right.key))
      .map((permission) => ({
        key: permission.key,
        scope: permission.scope,
      })),
    roles: Object.values(authorization.roles)
      .sort((left, right) => compareKeys(left.key, right.key))
      .map((role) => ({
        key: role.key,
        permissions: [...role.permissions].sort(compareKeys),
        allPermissions: role.allPermissions,
        system: role.system,
      })),
  });
  return freezeManifest({
    version: 1,
    registryVersion: authorization.registryVersion,
    fingerprint: sha256(manifestJson),
    manifestJson,
  });
}

function assertNoImplicitRoleReactivation(
  db: ReactiveDB,
  previous: InstalledAuthorizationManifest,
  requested: InstalledAuthorizationManifest,
): void {
  if (previous.fingerprint === requested.fingerprint) return;
  const oldManifest = parseManifest(previous.manifestJson);
  const nextManifest = parseManifest(requested.manifestJson);
  const previousRoles = new Set(oldManifest.roles.map((role) => role.key));
  const introduced = nextManifest.roles
    .map((role) => role.key)
    .filter((role) => !previousRoles.has(role));
  if (introduced.length === 0) return;

  const retained = retainedRoleCountsAcrossProfiles(
    db,
    oldManifest,
    nextManifest,
    introduced,
  );
  if (retained.length === 0) return;
  const summary = retained
    .map(({ role, count }) => `${role} (${count})`)
    .join(', ');
  throw new AuthError(
    `Authorization registry roles would reactivate retained assignments: ${summary}. `
      + 'While those role keys are retired, remove or replace every retained assignment; '
      + 'then deploy the new explicitly versioned registry and grant roles deliberately.',
    'AUTHORIZATION_ROLE_REACTIVATION_BLOCKED',
    503,
  );
}

interface ParsedManifest {
  version: 1;
  evaluatorVersion: number;
  tenancy: AuthTenancyMode;
  mode: 'simple' | 'advanced';
  permissions: PermissionManifestEntry[];
  roles: RoleManifestEntry[];
}

interface PermissionManifestEntry {
  key: string;
  scope: 'application' | 'tenant';
}

interface RoleManifestEntry {
  key: string;
  permissions: string[];
  allPermissions: boolean;
  system: boolean;
}

function isProfileAxisOnlyChange(
  previous: InstalledAuthorizationManifest,
  requested: InstalledAuthorizationManifest,
): boolean {
  const oldManifest = parseManifest(previous.manifestJson);
  const nextManifest = parseManifest(requested.manifestJson);
  return stableStringify(registrySemantics(oldManifest))
    === stableStringify(registrySemantics(nextManifest));
}

function registrySemantics(manifest: ParsedManifest): object {
  return {
    version: manifest.version,
    evaluatorVersion: manifest.evaluatorVersion,
    permissions: manifest.permissions,
    roles: manifest.roles,
  };
}

function parseManifest(manifestJson: string): ParsedManifest {
  let value: unknown;
  try {
    value = JSON.parse(manifestJson);
  } catch {
    throw invalidManifestMarker();
  }
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'evaluatorVersion',
      'mode',
      'permissions',
      'roles',
      'tenancy',
      'version',
    ])
    || stableStringify(value) !== manifestJson
    || value.version !== 1
    || !Number.isSafeInteger(value.evaluatorVersion)
    || Number(value.evaluatorVersion) < 1
    || (value.tenancy !== 'single' && value.tenancy !== 'multi')
    || (value.mode !== 'simple' && value.mode !== 'advanced')
    || !Array.isArray(value.permissions)
    || !Array.isArray(value.roles)
    || !isSortedUniqueEntries(value.permissions, isPermissionManifestEntry)
    || !isSortedUniqueEntries(value.roles, isRoleManifestEntry)) {
    throw invalidManifestMarker();
  }
  return value as unknown as ParsedManifest;
}

function isPermissionManifestEntry(
  value: unknown,
): value is PermissionManifestEntry {
  return isRecord(value)
    && hasExactKeys(value, ['key', 'scope'])
    && typeof value.key === 'string'
    && value.key.length > 0
    && (value.scope === 'application' || value.scope === 'tenant');
}

function isRoleManifestEntry(value: unknown): value is RoleManifestEntry {
  return isRecord(value)
    && hasExactKeys(value, ['allPermissions', 'key', 'permissions', 'system'])
    && typeof value.key === 'string'
    && value.key.length > 0
    && Array.isArray(value.permissions)
    && value.permissions.every((permission) => (
      typeof permission === 'string' && permission.length > 0
    ))
    && isSortedUniqueStrings(value.permissions)
    && typeof value.allPermissions === 'boolean'
    && typeof value.system === 'boolean';
}

function isSortedUniqueEntries(
  entries: unknown[],
  validate: (entry: unknown) => entry is { key: string },
): boolean {
  if (!entries.every(validate)) return false;
  return isSortedUniqueStrings(entries.map((entry) => entry.key));
}

function isSortedUniqueStrings(values: readonly string[]): boolean {
  return values.every((value, index) => (
    index === 0 || compareKeys(values[index - 1]!, value) < 0
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort(compareKeys);
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

function retainedRoleCounts(
  db: ReactiveDB,
  tenancy: AuthTenancyMode,
  mode: 'simple' | 'advanced',
  roleKeys: readonly string[],
): Array<{ role: string; count: number }> {
  if (roleKeys.length === 0) return [];
  const placeholders = roleKeys.map(() => '?').join(', ');
  let table: string;
  let roleColumn: string;
  let livePredicate: string;
  if (mode === 'simple' && tenancy === 'single') {
    table = 'users';
    roleColumn = 'role';
    livePredicate = "status <> 'deleted'";
  } else if (mode === 'simple') {
    table = '_auth_tenant_memberships';
    roleColumn = 'role_key';
    livePredicate = "status <> 'removed'";
  } else if (tenancy === 'single') {
    table = '_auth_application_role_assignments';
    roleColumn = 'role_key';
    livePredicate = 'revoked_at IS NULL';
  } else {
    table = '_auth_tenant_membership_roles';
    roleColumn = 'role_key';
    livePredicate = 'revoked_at IS NULL';
  }
  if (!tableExists(db, table)) return [];
  return (db.prepare(`
    SELECT ${roleColumn} AS role, COUNT(*) AS count
    FROM ${table}
    WHERE ${livePredicate} AND ${roleColumn} IN (${placeholders})
    GROUP BY ${roleColumn}
    ORDER BY ${roleColumn}
  `).all(...roleKeys) as Array<{ role: string; count: number }>)
    .map((row) => ({ role: row.role, count: Number(row.count) }));
}

function retainedRoleCountsAcrossProfiles(
  db: ReactiveDB,
  previous: Pick<ParsedManifest, 'tenancy' | 'mode'>,
  requested: Pick<ParsedManifest, 'tenancy' | 'mode'>,
  roleKeys: readonly string[],
): Array<{ role: string; count: number }> {
  const profiles = previous.tenancy === requested.tenancy
      && previous.mode === requested.mode
    ? [requested]
    : [previous, requested];
  const totals = new Map<string, number>();
  for (const profile of profiles) {
    for (const row of retainedRoleCounts(
      db,
      profile.tenancy,
      profile.mode,
      roleKeys,
    )) {
      totals.set(row.role, (totals.get(row.role) ?? 0) + row.count);
    }
  }
  return [...totals.entries()]
    .sort(([left], [right]) => compareKeys(left, right))
    .map(([role, count]) => ({ role, count }));
}

function tableExists(db: Pick<ReactiveDB, 'prepare'>, table: string): boolean {
  return db.prepare(`
    SELECT 1 AS present FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table) !== null;
}

export function readInstalledAuthorizationManifest(
  db: Pick<ReactiveDB, 'prepare'>,
): InstalledAuthorizationManifest | null {
  const row = db.prepare(`
    SELECT version, registry_version, fingerprint, manifest_json
    FROM ${AUTH_AUTHORIZATION_MANIFEST_TABLE}
    WHERE singleton = 1
  `).get() as {
    version: number;
    registry_version: number;
    fingerprint: string;
    manifest_json: string;
  } | null;
  if (!row) return null;
  if (row.version !== 1
    || !Number.isSafeInteger(row.registry_version)
    || row.registry_version < 1
    || !/^[a-f0-9]{64}$/.test(row.fingerprint)
    || typeof row.manifest_json !== 'string'
    || sha256(row.manifest_json) !== row.fingerprint) {
    throw invalidManifestMarker();
  }
  parseManifest(row.manifest_json);
  return freezeManifest({
    version: 1,
    registryVersion: row.registry_version,
    fingerprint: row.fingerprint,
    manifestJson: row.manifest_json,
  });
}

/** Cheap request/runtime fence paired with the installed auth-profile guard. */
export class InstalledAuthorizationManifestGuard {
  private readonly read;

  constructor(
    db: ReactiveDB,
    private readonly expected: InstalledAuthorizationManifest,
  ) {
    this.read = db.prepare(`
      SELECT version, registry_version, fingerprint
      FROM ${AUTH_AUTHORIZATION_MANIFEST_TABLE}
      WHERE singleton = 1
    `);
  }

  isCurrent(): boolean {
    const row = this.read.get() as {
      version: number;
      registry_version: number;
      fingerprint: string;
    } | null;
    return row?.version === 1
      && Number(row.registry_version) === this.expected.registryVersion
      && row.fingerprint === this.expected.fingerprint;
  }

  assertCurrent(): void {
    if (this.isCurrent()) return;
    throw new AuthError(
      'This runtime authorization registry is stale; restart every app process with one consistent, explicitly versioned configuration',
      'AUTH_PROFILE_CHANGED',
      503,
    );
  }
}

function persistAuthorizationManifest(
  db: ReactiveDB,
  previous: InstalledAuthorizationManifest | null,
  requested: InstalledAuthorizationManifest,
): void {
  const now = Date.now();
  if (!previous) {
    const inserted = db.prepare(`
      INSERT INTO ${AUTH_AUTHORIZATION_MANIFEST_TABLE} (
        singleton, version, registry_version, fingerprint, manifest_json, updated_at
      ) VALUES (1, 1, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO NOTHING
      RETURNING singleton
    `).get(
      requested.registryVersion,
      requested.fingerprint,
      requested.manifestJson,
      now,
    ) as { singleton: number } | null;
    if (inserted?.singleton !== 1) throw manifestChangedConcurrently();
    return;
  }

  const updated = db.prepare(`
    UPDATE ${AUTH_AUTHORIZATION_MANIFEST_TABLE}
    SET registry_version = ?, fingerprint = ?, manifest_json = ?, updated_at = ?
    WHERE singleton = 1 AND version = 1
      AND registry_version = ? AND fingerprint = ?
    RETURNING singleton
  `).get(
    requested.registryVersion,
    requested.fingerprint,
    requested.manifestJson,
    now,
    previous.registryVersion,
    previous.fingerprint,
  ) as { singleton: number } | null;
  if (updated?.singleton !== 1) throw manifestChangedConcurrently();
}

function appendManifestAudit(
  audit: AuthAuditService | undefined,
  previous: InstalledAuthorizationManifest | null,
  requested: InstalledAuthorizationManifest,
): void {
  if (!audit) return;
  audit.append({
    action: previous
      ? 'application.authorization-registry-updated'
      : 'application.authorization-registry-initialized',
    outcome: 'succeeded',
    scope: { kind: 'application' },
    actor: { provenance: 'system' },
    target: { type: 'authorization-registry' },
    metadata: {
      'from-version': previous?.registryVersion ?? 0,
      'to-version': requested.registryVersion,
      'from-fingerprint': previous?.fingerprint ?? 'none',
      'to-fingerprint': requested.fingerprint,
    },
  });
}

function freezeManifest(
  input: InstalledAuthorizationManifest,
): InstalledAuthorizationManifest {
  return Object.freeze({ ...input });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort(compareKeys).map((key) => (
    `${JSON.stringify(key)}:${stableStringify(object[key])}`
  )).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function registryVersionError(message: string): AuthError {
  return new AuthError(message, 'AUTHORIZATION_REGISTRY_VERSION_REQUIRED', 503);
}

function invalidManifestMarker(): AuthError {
  return new AuthError(
    `Installed authorization registry marker in "${AUTH_AUTHORIZATION_MANIFEST_TABLE}" is invalid. Restore it from a trusted backup before startup.`,
    'AUTHORIZATION_REGISTRY_INVALID',
    503,
  );
}

function manifestChangedConcurrently(): AuthError {
  return new AuthError(
    'Installed authorization registry changed during startup. Stop conflicting runtimes and restart with one consistent configuration.',
    'AUTH_PROFILE_CHANGED',
    503,
  );
}
