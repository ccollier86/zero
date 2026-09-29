import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import type {
  AuthAuthorizationMode,
  AuthTenancyMode,
} from './types';
import { AuthError } from './types';
import {
  InstalledAuthorizationManifestGuard,
  type InstalledAuthorizationManifest,
} from './auth-authorization-manifest';

export const AUTH_INSTALLED_PROFILE_TABLE = '_auth_installed_profile';

/** Private singleton schema shared by runtime creation and migration 023. */
export function defineAuthInstalledProfileTable(
  db: Pick<ReactiveDB, 'exec'>,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${AUTH_INSTALLED_PROFILE_TABLE} (
      singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
      version        INTEGER NOT NULL CHECK (version = 1),
      generation     INTEGER NOT NULL CHECK (generation >= 1),
      tenancy        TEXT NOT NULL CHECK (tenancy IN ('single', 'multi')),
      authorization  TEXT NOT NULL CHECK (authorization IN ('simple', 'advanced')),
      updated_at     INTEGER NOT NULL CHECK (updated_at >= 0)
    )
  `);
}

export interface InstalledAuthProfile {
  readonly version: 1;
  readonly generation: number;
  readonly tenancy: AuthTenancyMode;
  readonly authorization: AuthAuthorizationMode;
}

interface AuthProfileIdentity {
  readonly version: 1;
  readonly tenancy: AuthTenancyMode;
  readonly authorization: AuthAuthorizationMode;
}

export type AuthProfileTransitionKind =
  | 'initialized'
  | 'unchanged'
  | 'simple-to-advanced'
  | 'pristine-correction';

export interface AuthProfileTransitionPlan {
  readonly installed: InstalledAuthProfile;
  readonly requested: AuthProfileIdentity;
  readonly committed: InstalledAuthProfile;
  readonly kind: AuthProfileTransitionKind;
  readonly legacySimpleRoleAdoption: boolean;
  readonly markerExisted: boolean;
}

export interface AuthProfileTransitionEvidence {
  readonly memberships?: number;
  readonly assignments?: number;
}

/**
 * Validate and persist the installed auth profile under one SQLite writer
 * transaction. The callback owns profile-specific adoption and readiness
 * checks; its writes, the marker, and the system audit event commit together.
 */
export function reconcileInstalledAuthProfile(input: {
  db: ReactiveDB;
  requested: {
    tenancy: AuthTenancyMode;
    authorization: AuthAuthorizationMode;
  };
  legacySimpleRoleAdoption?: boolean;
  audit?: AuthAuditService;
  emitCode?: AuthPlatformCodeEmitter;
  beforeCommit: (plan: AuthProfileTransitionPlan) =>
    AuthProfileTransitionEvidence | void;
}): AuthProfileTransitionPlan {
  return input.db.transaction(() => {
    const persisted = readInstalledProfile(input.db);
    const requested = freezeProfileIdentity(input.requested);
    const legacySimpleRoleAdoption = input.legacySimpleRoleAdoption === true;
    const installed = persisted ?? inferLegacyProfile(
      input.db,
      requested,
      legacySimpleRoleAdoption,
    );
    const kind = classifyTransition(input.db, installed, requested, persisted !== null);
    const plan: AuthProfileTransitionPlan = Object.freeze({
      installed,
      requested,
      committed: freezeInstalledProfile(requested, committedGeneration(
        installed,
        kind,
        persisted !== null,
      )),
      kind,
      legacySimpleRoleAdoption: !persisted
        && legacySimpleRoleAdoption
        && installed.tenancy === 'multi'
        && installed.authorization === 'simple'
        && requested.tenancy === 'multi'
        && requested.authorization === 'advanced',
      markerExisted: persisted !== null,
    });

    const pendingRegistrationProvisioning = countRows(
      input.db,
      '_auth_registration_provisioning',
    ) > 0;
    const pendingAdminUserProvisioning = countRows(
      input.db,
      '_auth_admin_user_provisioning',
    ) > 0;
    if (plan.kind !== 'unchanged' && plan.kind !== 'initialized'
      && (pendingRegistrationProvisioning || pendingAdminUserProvisioning)) {
      throw new Error(
        '[auth] Cannot change the installed authorization profile while an '
          + 'auth registration provisioning receipt is pending, or while an '
          + 'administrator-user provisioning receipt is pending. Restart with '
          + 'the installed simple profile so Zero can finish or recover the '
          + 'provisioning operation, then retry the advanced upgrade.',
      );
    }

    const evidence = invokeSynchronousAuthCallback(
      () => input.beforeCommit(plan),
      {
        component: 'auth-profile-state',
        invariant: 'profile-before-commit-async',
        message: '[auth] Profile transition beforeCommit must be synchronous.',
        emitCode: input.emitCode,
      },
    ) ?? {};
    appendTransitionAudit(input.audit, plan, evidence);
    // Marker CAS is deliberately last. Any adoption/readiness/audit failure
    // leaves both the marker and all authority rows unchanged.
    persistInstalledProfile(input.db, persisted, plan.committed);
    return plan;
  });
}

export function readInstalledAuthProfile(
  db: Pick<ReactiveDB, 'prepare'>,
): InstalledAuthProfile | null {
  return readInstalledProfile(db);
}

/** Cheap durable fence used by request/token boundaries after startup. */
export class InstalledAuthProfileGuard {
  private readonly read;
  private readonly authorizationManifest: InstalledAuthorizationManifestGuard | null;

  constructor(
    db: ReactiveDB,
    private readonly expected: InstalledAuthProfile,
    expectedAuthorizationManifest?: InstalledAuthorizationManifest,
  ) {
    this.read = db.prepare(`
      SELECT version, generation, tenancy, authorization
      FROM ${AUTH_INSTALLED_PROFILE_TABLE}
      WHERE singleton = 1
    `);
    this.authorizationManifest = expectedAuthorizationManifest
      ? new InstalledAuthorizationManifestGuard(db, expectedAuthorizationManifest)
      : null;
  }

  isCurrent(): boolean {
    const row = this.read.get() as {
      version: number;
      generation: number;
      tenancy: string;
      authorization: string;
    } | null;
    return row?.version === 1
      && Number(row.generation) === this.expected.generation
      && row.tenancy === this.expected.tenancy
      && row.authorization === this.expected.authorization
      && (this.authorizationManifest?.isCurrent() ?? true);
  }

  assertCurrent(): void {
    if (this.isCurrent()) return;
    throw new AuthError(
      'This runtime auth profile is stale; restart every app process with one consistent configuration',
      'AUTH_PROFILE_CHANGED',
      503,
    );
  }
}

function classifyTransition(
  db: ReactiveDB,
  installed: InstalledAuthProfile,
  requested: AuthProfileIdentity,
  markerExisted: boolean,
): AuthProfileTransitionKind {
  if (sameProfile(installed, requested)) {
    return markerExisted ? 'unchanged' : 'initialized';
  }

  if (isPristine(db)) return 'pristine-correction';

  if (installed.tenancy !== requested.tenancy) {
    throw profileTransitionError(
      installed,
      requested,
      'Changing between single-tenant and multi-tenant authority requires an '
        + 'explicit data, ownership, and session adoption workflow.',
    );
  }
  if (installed.authorization === 'advanced'
    && requested.authorization === 'simple') {
    throw profileTransitionError(
      installed,
      requested,
      'Advanced assignments cannot be reinterpreted through membership.role_key. '
        + 'Restore authorization.mode="advanced".',
    );
  }
  if (installed.authorization === 'simple'
    && requested.authorization === 'advanced') {
    return 'simple-to-advanced';
  }
  throw profileTransitionError(
    installed,
    requested,
    'This auth profile transition is not supported.',
  );
}

function inferLegacyProfile(
  db: ReactiveDB,
  requested: AuthProfileIdentity,
  legacySimpleRoleAdoption: boolean,
): InstalledAuthProfile {
  const users = countRows(db, 'users');
  const tenants = countRows(db, '_auth_tenants');
  const memberships = countRows(db, '_auth_tenant_memberships');
  const applicationAssignments = countRows(
    db,
    '_auth_application_role_assignments',
  );
  const tenantAssignments = countRows(db, '_auth_tenant_membership_roles');

  if (applicationAssignments > 0 && (tenants > 0 || memberships > 0
    || tenantAssignments > 0)) {
    throw new Error(
      '[auth] Cannot infer the installed auth profile: both application-role '
        + 'history and tenant authority data exist. Restore the last known '
        + 'profile and inspect the database before startup.',
    );
  }
  if (tenantAssignments > 0 && tenants === 0) {
    throw new Error(
      '[auth] Cannot infer the installed auth profile: tenant role-assignment '
        + 'history exists without a retained tenant. Repair the authority graph '
        + 'before startup.',
    );
  }
  if (applicationAssignments > 0) {
    return freezeInstalledProfile(
      { version: 1, tenancy: 'single', authorization: 'advanced' },
      0,
    );
  }
  if (tenantAssignments > 0) {
    return freezeInstalledProfile(
      { version: 1, tenancy: 'multi', authorization: 'advanced' },
      0,
    );
  }
  if (tenants > 0 || memberships > 0) {
    if (requested.tenancy === 'multi'
      && requested.authorization === 'simple') {
      // A usable advanced tenant always has protected owner assignment
      // history. Zero-assignment legacy data may continue in its explicitly
      // requested simple profile, which records the marker for later upgrades.
      return freezeInstalledProfile(
        { version: 1, tenancy: 'multi', authorization: 'simple' },
        0,
      );
    }
    if (legacySimpleRoleAdoption
      && requested.tenancy === 'multi'
      && requested.authorization === 'advanced') {
      return freezeInstalledProfile(
        { version: 1, tenancy: 'multi', authorization: 'simple' },
        0,
      );
    }
    throw new Error(
      '[auth] Cannot infer the installed auth profile: this unmarked database '
        + 'contains tenant data but no advanced assignment history. That is '
        + 'ambiguous between multi/simple and a damaged multi/advanced install. '
        + 'Inspect or restore the prior profile. Only when the database truly '
        + 'came from multi/simple, start multi/advanced once with '
        + 'auth.authorization.legacySimpleRoleAdoption=true; remove the '
        + 'idempotent assertion after startup persists the profile marker.',
    );
  }
  if (users > 0) {
    // This is the historical Zero compatibility shape. Keeping it inferable is
    // required for existing single/simple applications; single/advanced still
    // requires its explicit protected-owner adoption below the profile gate.
    return freezeInstalledProfile(
      { version: 1, tenancy: 'single', authorization: 'simple' },
      0,
    );
  }
  return freezeInstalledProfile(requested, 0);
}

function readInstalledProfile(
  db: Pick<ReactiveDB, 'prepare'>,
): InstalledAuthProfile | null {
  const row = db.prepare(`
    SELECT version, generation, tenancy, authorization
    FROM ${AUTH_INSTALLED_PROFILE_TABLE}
    WHERE singleton = 1
  `).get() as {
    version: number;
    generation: number;
    tenancy: string;
    authorization: string;
  } | null;
  if (!row) return null;
  if (row.version !== 1
    || !Number.isSafeInteger(row.generation)
    || row.generation < 1
    || (row.tenancy !== 'single' && row.tenancy !== 'multi')
    || (row.authorization !== 'simple' && row.authorization !== 'advanced')) {
    throw invalidProfileMarker();
  }
  return freezeInstalledProfile({
    version: 1,
    tenancy: row.tenancy,
    authorization: row.authorization,
  }, row.generation);
}

function persistInstalledProfile(
  db: ReactiveDB,
  previous: InstalledAuthProfile | null,
  requested: InstalledAuthProfile,
): void {
  if (!previous) {
    const inserted = db.prepare(`
      INSERT INTO ${AUTH_INSTALLED_PROFILE_TABLE} (
        singleton, version, generation, tenancy, authorization, updated_at
      ) VALUES (1, 1, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO NOTHING
      RETURNING singleton
    `).get(
      requested.generation,
      requested.tenancy,
      requested.authorization,
      Date.now(),
    ) as { singleton: number } | null;
    if (inserted?.singleton !== 1) throw profileChangedConcurrently();
    return;
  }
  if (sameProfile(previous, requested)) return;
  const updated = db.prepare(`
    UPDATE ${AUTH_INSTALLED_PROFILE_TABLE}
    SET generation = ?, tenancy = ?, authorization = ?, updated_at = ?
    WHERE singleton = 1 AND version = 1 AND generation = ?
      AND tenancy = ? AND authorization = ?
    RETURNING singleton
  `).get(
    requested.generation,
    requested.tenancy,
    requested.authorization,
    Date.now(),
    previous.generation,
    previous.tenancy,
    previous.authorization,
  ) as { singleton: number } | null;
  if (updated?.singleton !== 1) throw profileChangedConcurrently();
}

function appendTransitionAudit(
  audit: AuthAuditService | undefined,
  plan: AuthProfileTransitionPlan,
  evidence: AuthProfileTransitionEvidence,
): void {
  if (!audit || (plan.kind !== 'simple-to-advanced'
    && plan.kind !== 'pristine-correction')) return;
  audit.append({
    action: plan.kind === 'pristine-correction'
      ? 'application.auth-profile-corrected'
      : 'application.auth-profile-adopted',
    outcome: 'succeeded',
    scope: { kind: 'application' },
    actor: { provenance: 'system' },
    target: { type: 'auth-profile' },
    metadata: {
      'from-profile': profileName(plan.installed),
      'to-profile': profileName(plan.requested),
      memberships: evidence.memberships ?? 0,
      assignments: evidence.assignments ?? 0,
      'legacy-assertion': plan.legacySimpleRoleAdoption,
    },
  });
}

function isPristine(db: ReactiveDB): boolean {
  return countRows(db, 'users') === 0
    && countRows(db, '_auth_tenants') === 0
    && countRows(db, '_auth_tenant_memberships') === 0
    && countRows(db, '_auth_application_role_assignments') === 0
    && countRows(db, '_auth_tenant_membership_roles') === 0;
}

function countRows(db: ReactiveDB, table: string): number {
  if (!tableExists(db, table)) return 0;
  const identifier = `"${table.replaceAll('"', '""')}"`;
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${identifier}`)
    .get() as { count: number };
  return Number(row.count);
}

function tableExists(db: Pick<ReactiveDB, 'prepare'>, table: string): boolean {
  return db.prepare(`
    SELECT 1 AS present FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table) !== null;
}

function freezeProfileIdentity(input: {
  tenancy: AuthTenancyMode;
  authorization: AuthAuthorizationMode;
}): AuthProfileIdentity {
  return Object.freeze({
    version: 1 as const,
    tenancy: input.tenancy,
    authorization: input.authorization,
  });
}

function freezeInstalledProfile(
  input: AuthProfileIdentity,
  generation: number,
): InstalledAuthProfile {
  return Object.freeze({ ...input, generation });
}

function committedGeneration(
  installed: InstalledAuthProfile,
  kind: AuthProfileTransitionKind,
  markerExisted: boolean,
): number {
  if (!markerExisted) return 1;
  return kind === 'unchanged' ? installed.generation : installed.generation + 1;
}

function sameProfile(
  left: AuthProfileIdentity,
  right: AuthProfileIdentity,
): boolean {
  return left.tenancy === right.tenancy
    && left.authorization === right.authorization;
}

function profileName(profile: AuthProfileIdentity): string {
  return `${profile.tenancy}/${profile.authorization}`;
}

function profileTransitionError(
  installed: InstalledAuthProfile,
  requested: AuthProfileIdentity,
  detail: string,
): Error {
  return new Error(
    `[auth] Installed auth profile is ${profileName(installed)}, but runtime `
      + `configuration requests ${profileName(requested)}. ${detail}`,
  );
}

function invalidProfileMarker(): Error {
  return new Error(
    `[auth] Installed auth profile marker in "${AUTH_INSTALLED_PROFILE_TABLE}" is invalid. `
      + 'Restore it from a trusted backup instead of guessing the authorization mode.',
  );
}

function profileChangedConcurrently(): Error {
  return new Error(
    '[auth] Installed auth profile changed during startup. Stop conflicting '
      + 'runtimes and restart with one consistent auth configuration.',
  );
}
