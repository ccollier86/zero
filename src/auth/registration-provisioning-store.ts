/** Crash-safe persistence and compensation for provisional auth registrations. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';
import { OBS_CODES } from '../observability/codes';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { AuthError, type UserRecord } from './types';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

/** Internal receipt for one registration awaiting downstream provisioning. */
export interface RegistrationProvisioningReceipt {
  readonly registrationId: string;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly isBootstrap: boolean;
  /** Process-held capability. Only its SHA-256 digest is persisted. */
  readonly leaseToken: string;
}

export interface RegistrationProvisioningResources {
  readonly tenantId?: string;
}

/** Narrow bootstrap hook implemented by the app-local advanced RBAC service. */
export interface AuthAuthorizationBootstrapper {
  establishBootstrapOwner(userId: string, registrationId?: string): void;
  hasProvisionalRegistrationAuthority?(input: {
    registrationId: string;
    userId: string;
    tenantId: string | null;
    isBootstrap: boolean;
  }): boolean;
  rollbackProvisionalApplicationOwner?(input: {
    userId: string;
    registrationId: string;
  }): boolean;
}

interface RegistrationProvisioningRow {
  registration_id: string;
  user_id: string;
  tenant_id: string | null;
  is_bootstrap: number;
  lease_owner_hash: string | null;
  lease_expires_at: number | null;
  created_at: number;
}

interface RegistrationProvisioningDependencies {
  mutation: <T>(operation: () => T) => T;
  afterCommit: (callback: () => unknown) => void;
  assertCurrentProfile: () => void;
  getConfig: (key: string) => string | null;
  setConfig: (key: string, value: string) => void;
  countUsers: () => number;
  getUserById: (userId: string) => UserRecord | null;
  getAuthorizationBootstrapper: () => AuthAuthorizationBootstrapper | null;
  /** Publish the finalized user and any retained memberships atomically. */
  activateIdentityProjection: (userId: string) => void;
  auditService: AuthAuditService | null;
  emitCode?: AuthPlatformCodeEmitter;
}

export interface PreparedRegistrationProvisioning {
  readonly registrationId: string;
  readonly leaseToken: string;
  readonly leaseOwnerHash: string;
}

export const REGISTRATION_PROVISIONING_LEASE_MS = 5 * 60_000;
const LEASE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function prepareRegistrationProvisioning(): PreparedRegistrationProvisioning {
  const leaseToken = createOpaqueToken();
  return Object.freeze({
    registrationId: `areg_${crypto.randomUUID()}`,
    leaseToken,
    leaseOwnerHash: hashToken(leaseToken),
  });
}

/**
 * Owns durable provisional-registration markers, leases, finalization, and
 * exact compensation. UserStore remains the public identity facade.
 */
export class RegistrationProvisioningStore {
  private readonly stmts: {
    acquireWriteLock: Statement;
    insert: Statement;
    bindTenant: Statement;
    get: Statement;
    getByIdentity: Statement;
    getByUser: Statement;
    getPendingBootstrap: Statement;
    listRecoverable: Statement;
    renewLease: Statement;
    delete: Statement;
  };

  constructor(
    private readonly db: ReactiveDB,
    private readonly dependencies: RegistrationProvisioningDependencies,
  ) {
    this.stmts = {
      acquireWriteLock: db.prepare(`
        INSERT INTO _auth_config (key, value)
        VALUES ('auth.registration.write_lock', '1')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `),
      insert: db.prepare(`
        INSERT INTO _auth_registration_provisioning (
          registration_id, user_id, tenant_id, is_bootstrap,
          lease_owner_hash, lease_expires_at, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?)
      `),
      bindTenant: db.prepare(`
        UPDATE _auth_registration_provisioning SET tenant_id = ?
        WHERE registration_id = ? AND user_id = ? AND tenant_id IS NULL
      `),
      get: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE registration_id = ? AND user_id = ? AND lease_owner_hash = ?
      `),
      getByIdentity: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE registration_id = ? AND user_id = ?
      `),
      getByUser: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE user_id = ? LIMIT 1
      `),
      getPendingBootstrap: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE is_bootstrap = 1
        ORDER BY created_at ASC, registration_id ASC
        LIMIT 1
      `),
      listRecoverable: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE lease_owner_hash IS NULL
          OR lease_expires_at IS NULL
          OR lease_expires_at <= ?
        ORDER BY created_at ASC, registration_id ASC
      `),
      renewLease: db.prepare(`
        UPDATE _auth_registration_provisioning
        SET lease_expires_at = ?
        WHERE registration_id = ? AND user_id = ? AND lease_owner_hash = ?
          AND lease_expires_at IS NOT NULL AND lease_expires_at > ?
      `),
      delete: db.prepare(`
        DELETE FROM _auth_registration_provisioning
        WHERE registration_id = ? AND user_id = ? AND lease_owner_hash = ?
      `),
    };
  }

  lockWrites(): void {
    this.stmts.acquireWriteLock.run();
  }

  isBootstrapRequired(): boolean {
    this.dependencies.assertCurrentProfile();
    return this.dependencies.getConfig('auth.bootstrap.completed') !== '1';
  }

  hasPendingForUser(userId: string): boolean {
    this.dependencies.assertCurrentProfile();
    return Boolean(this.stmts.getByUser.get(userId));
  }

  reconcileBootstrapState(): void {
    this.dependencies.assertCurrentProfile();
    if (this.stmts.getPendingBootstrap.get()) return;
    if (this.dependencies.getConfig('auth.bootstrap.completed') !== '1'
      && this.dependencies.countUsers() > 0) {
      this.markBootstrapCompleted();
    }
  }

  assertNoPendingBootstrap(): void {
    if (!this.stmts.getPendingBootstrap.get()) return;
    throw new AuthError(
      'Administrator bootstrap provisioning is already in progress',
      'BOOTSTRAP_PROVISIONING_IN_PROGRESS',
      409,
    );
  }

  insert(input: PreparedRegistrationProvisioning & {
    userId: string;
    isBootstrap: boolean;
    createdAt: number;
  }): void {
    this.stmts.insert.run(
      input.registrationId,
      input.userId,
      input.isBootstrap ? 1 : 0,
      input.leaseOwnerHash,
      input.createdAt + REGISTRATION_PROVISIONING_LEASE_MS,
      input.createdAt,
    );
  }

  bindTenant(tenantId: string, registrationId: string, userId: string): void {
    if (this.stmts.bindTenant.run(tenantId, registrationId, userId).changes !== 1) {
      throw this.invariant(
        'tenant-binding',
        '[auth] Failed to bind registration provisioning to its tenant.',
      );
    }
  }

  markBootstrapCompleted(): void {
    this.dependencies.setConfig('auth.bootstrap.completed', '1');
  }

  recordAudit(
    userId: string,
    tenantId: string | null,
    bootstrap: boolean,
    request?: AuthAuditRequestContext,
  ): void {
    const audit = this.dependencies.auditService;
    audit?.append({
      action: bootstrap ? 'application.bootstrap-completed' : 'identity.registered',
      outcome: 'succeeded',
      scope: bootstrap || !tenantId
        ? { kind: 'application' }
        : { kind: 'tenant', tenantId },
      actor: { userId, provenance: bootstrap ? 'bootstrap' : 'registration' },
      request,
      target: { type: 'user', id: userId },
      metadata: { 'tenant-provisioned': tenantId !== null },
    });
    if (tenantId) {
      audit?.append({
        action: 'tenant.created',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: { userId, provenance: bootstrap ? 'bootstrap' : 'registration' },
        request,
        target: { type: 'tenant', id: tenantId },
        metadata: { bootstrap },
      });
    }
  }

  renewLease(receipt: RegistrationProvisioningReceipt): number {
    return this.dependencies.mutation(() => {
      this.lockWrites();
      const now = Date.now();
      const row = this.require(receipt, now);
      const leaseExpiresAt = now + REGISTRATION_PROVISIONING_LEASE_MS;
      if (this.stmts.renewLease.run(
        leaseExpiresAt,
        row.registration_id,
        row.user_id,
        row.lease_owner_hash,
        now,
      ).changes !== 1) throw registrationProvisioningLeaseLost();
      return leaseExpiresAt;
    });
  }

  finalize(
    receipt: RegistrationProvisioningReceipt,
    auditRequest?: AuthAuditRequestContext,
  ): void {
    this.dependencies.mutation(() => {
      this.lockWrites();
      const row = this.require(receipt, Date.now());
      if (!this.dependencies.getUserById(row.user_id)) {
        throw this.invariant(
          'user-missing',
          '[auth] Registration provisioning user is missing.',
        );
      }
      if (row.tenant_id) this.assertProvisionedTenant(row);
      const bootstrapper = this.dependencies.getAuthorizationBootstrapper();
      if (bootstrapper?.hasProvisionalRegistrationAuthority
        && !invokeSynchronousAuthCallback(
          () => bootstrapper.hasProvisionalRegistrationAuthority!({
            registrationId: row.registration_id,
            userId: row.user_id,
            tenantId: row.tenant_id,
            isBootstrap: row.is_bootstrap === 1,
          }),
          {
            component: 'registration-provisioning',
            invariant: 'authorization-provisional-check-async',
            message: '[auth] Provisional authorization check must be synchronous.',
            createError: () => this.invariant(
              'authorization-provisional-check-async',
              '[auth] Provisional authorization check must be synchronous.',
            ),
          },
        )) {
        throw this.invariant(
          'authority-missing',
          '[auth] Registration provisioning authority is missing.',
        );
      }
      if (row.is_bootstrap === 1) {
        if (this.dependencies.getConfig('auth.bootstrap.completed') === '1') {
          throw this.invariant(
            'bootstrap-already-completed',
            '[auth] Bootstrap was completed by a different registration.',
          );
        }
        this.markBootstrapCompleted();
      }
      if (this.stmts.delete.run(
        row.registration_id,
        row.user_id,
        row.lease_owner_hash,
      ).changes !== 1) {
        throw this.invariant(
          'marker-finalization-lost',
          '[auth] Registration provisioning finalization lost its marker.',
        );
      }
      this.dependencies.activateIdentityProjection(row.user_id);
      this.recordAudit(
        row.user_id,
        row.tenant_id,
        row.is_bootstrap === 1,
        auditRequest,
      );
    });
  }

  rollback(receipt: RegistrationProvisioningReceipt): boolean {
    return this.dependencies.mutation(() => {
      this.lockWrites();
      const row = this.get(receipt);
      if (!row) {
        if (!this.stmts.getByIdentity.get(receipt.registrationId, receipt.userId)
          && !this.dependencies.getUserById(receipt.userId)) return true;
        throw staleReceipt();
      }
      this.rollbackRow(row);
      return true;
    });
  }

  recoverPending(): number {
    this.dependencies.assertCurrentProfile();
    const rows = this.stmts.listRecoverable.all(
      Date.now(),
    ) as RegistrationProvisioningRow[];
    let recovered = 0;
    for (const candidate of rows) {
      const changed = this.dependencies.mutation(() => {
        this.lockWrites();
        const row = this.stmts.getByIdentity.get(
          candidate.registration_id,
          candidate.user_id,
        ) as RegistrationProvisioningRow | null;
        if (!row) return false;
        const leaseIsLive = row.lease_owner_hash !== null
          && row.lease_expires_at !== null
          && row.lease_expires_at > Date.now();
        if (leaseIsLive) return false;
        this.rollbackRow(row);
        this.dependencies.afterCommit(() => {
          this.dependencies.emitCode?.(
            OBS_CODES.AUTH_REGISTRATION_PROVISIONING_RECOVERED,
            { metadata: { bootstrap: row.is_bootstrap === 1 } },
          );
        });
        return true;
      });
      if (changed) {
        recovered++;
      }
    }
    return recovered;
  }

  private require(
    receipt: RegistrationProvisioningReceipt,
    activeAt?: number,
  ): RegistrationProvisioningRow {
    const row = this.get(receipt);
    if (!row) throw staleReceipt();
    if (activeAt !== undefined
      && (row.lease_expires_at === null || row.lease_expires_at <= activeAt)) {
      throw registrationProvisioningLeaseLost();
    }
    return row;
  }

  private get(
    receipt: RegistrationProvisioningReceipt,
  ): RegistrationProvisioningRow | null {
    const row = this.stmts.get.get(
      receipt.registrationId,
      receipt.userId,
      leaseOwnerHash(receipt.leaseToken),
    ) as RegistrationProvisioningRow | null;
    if (row && (row.tenant_id !== receipt.tenantId
      || Boolean(row.is_bootstrap) !== receipt.isBootstrap)) throw staleReceipt();
    return row;
  }

  private rollbackRow(row: RegistrationProvisioningRow): void {
    this.releaseProvisionalNativeBindings(row.user_id);
    this.deleteProvisionalPlatformActionTokens(row.user_id);
    if (row.tenant_id) this.deleteProvisionedTenant(row);
    const bootstrapper = this.dependencies.getAuthorizationBootstrapper();
    if (row.is_bootstrap === 1 && row.tenant_id === null
      && bootstrapper?.rollbackProvisionalApplicationOwner
      && !invokeSynchronousAuthCallback(
        () => bootstrapper.rollbackProvisionalApplicationOwner!({
          userId: row.user_id,
          registrationId: row.registration_id,
        }),
        {
          component: 'registration-provisioning',
          invariant: 'authorization-provisional-rollback-async',
          message: '[auth] Provisional authorization rollback must be synchronous.',
          createError: () => this.invariant(
            'authorization-provisional-rollback-async',
            '[auth] Provisional authorization rollback must be synchronous.',
          ),
        },
      )) {
      throw this.invariant(
        'application-owner-cleanup',
        '[auth] Provisional application owner cleanup failed.',
      );
    }
    if (!this.db.delete('users', row.user_id)) {
      throw this.invariant(
        'user-cleanup',
        '[auth] Registration provisioning user cleanup failed.',
      );
    }
    if (this.stmts.getByIdentity.get(row.registration_id, row.user_id)) {
      throw this.invariant(
        'marker-cleanup',
        '[auth] Registration provisioning marker cleanup failed.',
      );
    }
  }

  private assertProvisionedTenant(row: RegistrationProvisioningRow): void {
    const tenant = this.db.prepare(`
      SELECT tenant_id FROM _auth_tenants
      WHERE tenant_id = ? AND created_by = ?
    `).get(row.tenant_id, row.user_id) as { tenant_id: string } | null;
    const owner = this.db.prepare(`
      SELECT membership_id FROM _auth_tenant_memberships
      WHERE tenant_id = ? AND user_id = ? AND status = 'active' AND role_key = 'owner'
    `).get(row.tenant_id, row.user_id) as { membership_id: string } | null;
    if (!tenant || !owner) {
      throw this.invariant(
        'tenant-ownership',
        '[auth] Registration provisioning tenant ownership is invalid.',
      );
    }
  }

  private deleteProvisionedTenant(row: RegistrationProvisioningRow): void {
    this.assertProvisionedTenant(row);
    this.db.prepare(`
      DELETE FROM _auth_tenants WHERE tenant_id = ? AND created_by = ?
    `).run(row.tenant_id, row.user_id);
    if (this.db.prepare(`SELECT 1 FROM _auth_tenants WHERE tenant_id = ?`)
      .get(row.tenant_id)) {
      throw this.invariant(
        'tenant-cleanup',
        '[auth] Registration provisioning tenant cleanup failed.',
      );
    }
  }

  private releaseProvisionalNativeBindings(userId: string): void {
    const table = this.db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_native_requests'
    `).get();
    if (!table) return;
    this.db.prepare(`
      UPDATE _auth_native_requests
      SET bound_user_id = NULL, scope_kind = NULL, scope_id = NULL,
          tenant_id = NULL, membership_id = NULL,
          tenant_authorization_generation = NULL,
          membership_authorization_generation = NULL
      WHERE bound_user_id = ? AND consumed_at IS NULL
    `).run(userId);
  }

  private deleteProvisionalPlatformActionTokens(userId: string): void {
    const table = this.db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = '_zero_action_tokens'
    `).get();
    if (!table) return;
    this.db.prepare(`
      DELETE FROM _zero_action_tokens
      WHERE subject_type = 'user' AND subject_id = ?
    `).run(userId);
  }

  private invariant(invariant: string, message: string): AuthError {
    this.dependencies.emitCode?.(OBS_CODES.AUTH_STATE_INVARIANT_FAILED, {
      metadata: { component: 'registration-provisioning', invariant },
    });
    return new AuthError(message, 'AUTH_STATE_INVARIANT_FAILED', 500);
  }
}

function leaseOwnerHash(leaseToken: string): string {
  if (!LEASE_TOKEN_PATTERN.test(leaseToken)) throw staleReceipt();
  return hashToken(leaseToken);
}

function staleReceipt(): AuthError {
  return new AuthError(
    'Registration provisioning receipt is invalid or stale',
    'REGISTRATION_PROVISIONING_RECEIPT_INVALID',
    409,
  );
}

function registrationProvisioningLeaseLost(): AuthError {
  return new AuthError(
    'Registration provisioning lease is no longer active',
    'REGISTRATION_PROVISIONING_LEASE_LOST',
    409,
  );
}
