/**
 * Durable workflow execution authority.
 *
 * Workflow rows are client-observable, so security provenance is deliberately
 * retained in private, underscore-prefixed tables. The persisted seal never
 * contains an access token, refresh token, cookie, signing key, or user
 * properties. A keyed MAC rejects corrupt/substituted JSON before it reaches
 * a handler.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Statement } from 'bun:sqlite';
import type {
  AuthorizationScopeSnapshot,
} from '../auth/authorization-kernel';
import type { AuthRequestAuthorityReference } from '../auth/auth-api-key-types';
import type { AuthContext, AuthContextAuthorityReference } from '../auth/types';
import {
  trustedSystemServiceDataScope,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import type { ReactiveDB } from '../sync/reactive-db';

const AUTHORITY_VERSION = 1 as const;
const AUTHORITY_MAC_KEY = 'workflow.execution_authority.mac_key.v1';
const MAX_AUTHORITY_JSON_BYTES = 32 * 1024;

export type WorkflowExecutionAuthorityKind = 'actor' | 'system';

/** Immutable, secret-free identity exposed to step handlers. */
export type WorkflowExecutionIdentity =
  | Readonly<{
      kind: 'actor';
      userId: string;
      platformRole: string;
      scopeKind: 'application' | 'tenant';
      scopeId: string;
      tenantId: string | null;
      membershipId: string | null;
      roles: readonly string[];
      permissions: readonly string[];
      allPermissions: boolean;
      authorizationRevision: string;
    } & (
      | {
          /** Omitted by v1 session seals for backwards-compatible persistence. */
          credentialKind?: 'session';
          credentialId?: null;
          sessionKind: 'web' | 'native';
          clientId: string | null;
        }
      | {
          credentialKind: 'api-key';
          credentialId: string;
          sessionKind: null;
          clientId: null;
        }
    )>
  | Readonly<{
      kind: 'system';
      principal: string;
      reason: string;
      scopeKind: 'application' | 'tenant';
      scopeId: string;
      tenantId: string | null;
      roles: readonly [];
      permissions: readonly [];
      allPermissions: true;
      legacyCompatibility: boolean;
    }>;

export interface WorkflowActorExecutionAuthority {
  readonly version: 1;
  readonly kind: 'actor';
  readonly reference: AuthContextAuthorityReference | AuthRequestAuthorityReference;
  readonly identity: Extract<WorkflowExecutionIdentity, { kind: 'actor' }>;
  /** Keyed digest only; raw server-owned user properties are never persisted. */
  readonly propertiesMac: string;
}

export interface WorkflowSystemExecutionAuthority {
  readonly version: 1;
  readonly kind: 'system';
  readonly identity: Extract<WorkflowExecutionIdentity, { kind: 'system' }>;
}

export type WorkflowPersistedExecutionAuthority =
  | WorkflowActorExecutionAuthority
  | WorkflowSystemExecutionAuthority;

/** Live result returned only after the persisted seal and authority are valid. */
export interface WorkflowResolvedExecutionAuthority {
  readonly persisted: WorkflowPersistedExecutionAuthority;
  readonly identity: WorkflowExecutionIdentity;
  readonly scope: ServiceDataScope;
  readonly authContext: AuthContext | null;
  readonly userProperties: Readonly<Record<string, string>>;
}

/** Auth adapter contract; the workflow core does not depend on HTTP/Elysia. */
export interface WorkflowExecutionAuthorityProvider {
  captureActor(context: AuthContext): WorkflowActorExecutionAuthority | null;
  revalidateActor(
    authority: WorkflowActorExecutionAuthority,
  ): WorkflowResolvedExecutionAuthority | null;
}

/**
 * Optional bridge used to construct the request-equivalent `ctx.zero` facade.
 * Implementations must close every service over `input.scope` and use
 * `input.assertCurrentAuthority()` before security-sensitive commits.
 */
export interface WorkflowExecutionServiceProvider<TServices = unknown> {
  createServices(input: {
    readonly authority: WorkflowResolvedExecutionAuthority;
    readonly assertCurrentAuthority: () => void;
  }): TServices;
}

export interface WorkflowSystemExecutionOptions {
  /** Stable component/plugin name used in the private audit seal. */
  principal: string;
  /** Human-readable bounded reason for privileged background execution. */
  reason: string;
  /** Required in multi-tenant mode; defaults to application scope in single mode. */
  scope?: ServiceDataScope;
}

export type WorkflowAuthorityFailureReason =
  | 'authority-missing'
  | 'authority-seal-invalid'
  | 'authority-revoked'
  | 'authority-scope-mismatch';

interface AuthorityRow {
  instance_id: string;
  authority_kind: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  authority_json: string;
  authority_mac: string;
  status: string;
  validation_count: number;
  created_at: number;
  last_validated_at: number | null;
  invalidated_at: number | null;
  invalidation_reason: string | null;
}

interface ConfigRow { value: string }

export type WorkflowAuthorityReadResult =
  | { ok: true; authority: WorkflowPersistedExecutionAuthority }
  | { ok: false; reason: 'authority-missing' | 'authority-seal-invalid' };

/** Define private execution authority and in-flight lease tables. */
export function defineWorkflowExecutionAuthorityTables(
  db: Pick<ReactiveDB, 'exec'>,
): void {
  // Standalone WorkflowService tests/embedders may not mount AuthRuntime, but
  // use the same canonical private config table shape when they do.
  db.exec(`CREATE TABLE IF NOT EXISTS _auth_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _workflow_execution_authorities (
      instance_id         TEXT PRIMARY KEY,
      authority_kind      TEXT NOT NULL,
      tenant_id           TEXT,
      actor_user_id       TEXT,
      authority_json      TEXT NOT NULL,
      authority_mac       TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'active',
      validation_count    INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL,
      last_validated_at   INTEGER,
      invalidated_at      INTEGER,
      invalidation_reason TEXT,
      CHECK (authority_kind IN ('actor', 'system')),
      CHECK (status IN ('active', 'invalid'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_authority_tenant_actor
    ON _workflow_execution_authorities(tenant_id, actor_user_id)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _workflow_step_executions (
      step_id      TEXT PRIMARY KEY,
      instance_id  TEXT NOT NULL,
      execution_id TEXT NOT NULL UNIQUE,
      created_at   INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_instance
    ON _workflow_step_executions(instance_id)`);
}

/** Private persistence owner for authenticated seals and execution leases. */
export class WorkflowExecutionAuthorityStore {
  private readonly insertAuthority: Statement;
  private readonly getAuthority: Statement;
  private readonly touchAuthority: Statement;
  private readonly invalidateAuthority: Statement;
  private readonly insertLease: Statement;
  private readonly getLease: Statement;
  private readonly deleteLease: Statement;
  private readonly deleteInstanceLeases: Statement;
  private readonly macKey: Buffer;

  constructor(
    private readonly db: ReactiveDB,
    private readonly now: () => number = Date.now,
  ) {
    defineWorkflowExecutionAuthorityTables(db);
    this.macKey = loadOrCreateAuthorityMacKey(db);
    this.insertAuthority = db.prepare(`
      INSERT INTO _workflow_execution_authorities (
        instance_id, authority_kind, tenant_id, actor_user_id,
        authority_json, authority_mac, status, validation_count,
        created_at, last_validated_at, invalidated_at, invalidation_reason
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, NULL, NULL, NULL)
    `);
    this.getAuthority = db.prepare(
      'SELECT * FROM _workflow_execution_authorities WHERE instance_id = ?',
    );
    // The write is intentionally first in every validation transaction. It
    // obtains SQLite's writer lock before auth/tenant/session rows are read.
    this.touchAuthority = db.prepare(`
      UPDATE _workflow_execution_authorities
      SET validation_count = validation_count + 1, last_validated_at = ?
      WHERE instance_id = ? AND status = 'active'
    `);
    this.invalidateAuthority = db.prepare(`
      UPDATE _workflow_execution_authorities
      SET status = 'invalid', invalidated_at = ?, invalidation_reason = ?
      WHERE instance_id = ? AND status = 'active'
    `);
    this.insertLease = db.prepare(`
      INSERT INTO _workflow_step_executions (
        step_id, instance_id, execution_id, created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(step_id) DO UPDATE SET
        instance_id = excluded.instance_id,
        execution_id = excluded.execution_id,
        created_at = excluded.created_at
    `);
    this.getLease = db.prepare(
      'SELECT execution_id FROM _workflow_step_executions WHERE step_id = ?',
    );
    this.deleteLease = db.prepare(
      'DELETE FROM _workflow_step_executions WHERE step_id = ? AND execution_id = ?',
    );
    this.deleteInstanceLeases = db.prepare(
      'DELETE FROM _workflow_step_executions WHERE instance_id = ?',
    );
  }

  insert(instanceId: string, authority: WorkflowPersistedExecutionAuthority): void {
    const json = serializeAuthority(authority);
    this.insertAuthority.run(
      instanceId,
      authority.kind,
      authority.identity.tenantId,
      authority.kind === 'actor' ? authority.identity.userId : null,
      json,
      this.mac(json),
      this.now(),
    );
  }

  /** Obtain the write lock and return a verified active seal. */
  lockAndRead(instanceId: string): WorkflowAuthorityReadResult {
    const touched = this.touchAuthority.run(this.now(), instanceId);
    if (touched.changes !== 1) return { ok: false, reason: 'authority-missing' };
    const row = this.getAuthority.get(instanceId) as AuthorityRow | null;
    if (!row || row.status !== 'active') {
      return { ok: false, reason: 'authority-missing' };
    }
    if (!this.validMac(row.authority_json, row.authority_mac)) {
      return { ok: false, reason: 'authority-seal-invalid' };
    }
    const authority = parseAuthority(row.authority_json);
    if (!authority
      || authority.kind !== row.authority_kind
      || authority.identity.tenantId !== row.tenant_id
      || (authority.kind === 'actor' ? authority.identity.userId : null)
        !== row.actor_user_id) {
      return { ok: false, reason: 'authority-seal-invalid' };
    }
    return { ok: true, authority };
  }

  invalidate(instanceId: string, reason: WorkflowAuthorityFailureReason): void {
    this.invalidateAuthority.run(this.now(), reason, instanceId);
    this.deleteInstanceLeases.run(instanceId);
  }

  putLease(stepId: string, instanceId: string, executionId: string): void {
    this.insertLease.run(stepId, instanceId, executionId, this.now());
  }

  hasLease(stepId: string, executionId: string): boolean {
    const row = this.getLease.get(stepId) as { execution_id: string } | null;
    return row?.execution_id === executionId;
  }

  releaseLease(stepId: string, executionId: string): boolean {
    return this.deleteLease.run(stepId, executionId).changes === 1;
  }

  releaseInstanceLeases(instanceId: string): void {
    this.deleteInstanceLeases.run(instanceId);
  }

  propertyMac(properties: Readonly<Record<string, string>>): string {
    return this.mac(canonicalProperties(properties));
  }

  private mac(value: string): string {
    return createHmac('sha256', this.macKey).update(value).digest('hex');
  }

  private validMac(value: string, expectedHex: string): boolean {
    if (!/^[a-f0-9]{64}$/u.test(expectedHex)) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(this.mac(value), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

export function createActorIdentity(
  context: AuthContext,
  authorization: AuthorizationScopeSnapshot,
): Extract<WorkflowExecutionIdentity, { kind: 'actor' }> {
  const common = {
    kind: 'actor',
    userId: context.userId,
    platformRole: context.role,
    scopeKind: authorization.scopeKind,
    scopeId: authorization.scopeId,
    tenantId: authorization.tenantId ?? null,
    membershipId: authorization.membershipId ?? null,
    roles: [...authorization.roles].sort(compareText),
    permissions: [...authorization.permissions].sort(compareText),
    allPermissions: authorization.allPermissions === true,
    authorizationRevision: authorization.revision,
  } as const;
  return context.credentialKind === 'api-key'
    ? deepFreezeIdentity({
        ...common,
        credentialKind: 'api-key',
        credentialId: context.credentialId!,
        sessionKind: null,
        clientId: null,
      })
    : deepFreezeIdentity({
        ...common,
        sessionKind: context.sessionKind!,
        clientId: context.clientId ?? null,
      });
}

export function createSystemAuthority(input: {
  principal: string;
  reason: string;
  scope: ServiceDataScope;
  legacyCompatibility?: boolean;
}): WorkflowSystemExecutionAuthority {
  const principal = boundedText(input.principal, 'system principal', 120);
  const reason = boundedText(input.reason, 'system execution reason', 500);
  return Object.freeze({
    version: AUTHORITY_VERSION,
    kind: 'system',
    identity: deepFreezeIdentity({
      kind: 'system',
      principal,
      reason,
      scopeKind: input.scope.scopeKind,
      scopeId: input.scope.scopeId,
      tenantId: input.scope.tenantId,
      roles: [] as const,
      permissions: [] as const,
      allPermissions: true,
      legacyCompatibility: input.legacyCompatibility === true,
    }),
  });
}

export function scopeFromIdentity(identity: WorkflowExecutionIdentity): ServiceDataScope {
  return identity.scopeKind === 'application'
    ? trustedSystemServiceDataScope({ scopeKind: 'application' })
    : trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: identity.tenantId!,
      });
}

/** Compare only stable, server-derived fields; arrays are canonicalized. */
export function sameExecutionIdentity(
  left: WorkflowExecutionIdentity,
  right: WorkflowExecutionIdentity,
): boolean {
  return serializeIdentity(left) === serializeIdentity(right);
}

function loadOrCreateAuthorityMacKey(db: ReactiveDB): Buffer {
  const select = db.prepare('SELECT value FROM _auth_config WHERE key = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO _auth_config (key, value) VALUES (?, ?)',
  );
  const generated = randomBytes(32).toString('base64url');
  insert.run(AUTHORITY_MAC_KEY, generated);
  const row = select.get(AUTHORITY_MAC_KEY) as ConfigRow | null;
  if (!row) throw new Error('[workflows] Failed to initialize execution authority MAC key.');
  const key = Buffer.from(row.value, 'base64url');
  if (key.length !== 32) {
    throw new Error('[workflows] Execution authority MAC key is invalid.');
  }
  return key;
}

function serializeAuthority(authority: WorkflowPersistedExecutionAuthority): string {
  const json = JSON.stringify(authority);
  if (Buffer.byteLength(json, 'utf8') > MAX_AUTHORITY_JSON_BYTES) {
    throw new Error('[workflows] Execution authority seal exceeds its storage limit.');
  }
  return json;
}

function parseAuthority(json: string): WorkflowPersistedExecutionAuthority | null {
  if (Buffer.byteLength(json, 'utf8') > MAX_AUTHORITY_JSON_BYTES) return null;
  try {
    const value = JSON.parse(json) as unknown;
    return isPersistedAuthority(value) ? freezePersistedAuthority(value) : null;
  } catch {
    return null;
  }
}

function isPersistedAuthority(value: unknown): value is WorkflowPersistedExecutionAuthority {
  if (!isRecord(value) || value.version !== 1) return false;
  if (value.kind === 'system') return isSystemIdentity(value.identity);
  if (value.kind !== 'actor'
    || !isActorIdentity(value.identity)
    || !isAuthorityReference(value.reference)
    || !isHexDigest(value.propertiesMac)) return false;
  return actorIdentityMatchesReference(value.identity, value.reference);
}

function isActorIdentity(
  value: unknown,
): value is Extract<WorkflowExecutionIdentity, { kind: 'actor' }> {
  return isRecord(value)
    && value.kind === 'actor'
    && boundedString(value.userId, 256)
    && boundedString(value.platformRole, 128)
    && isActorCredentialShape(value)
    && isScopeShape(value)
    && nullableBoundedString(value.membershipId, 256)
    && stringArray(value.roles, 128, 128)
    && stringArray(value.permissions, 1024, 256)
    && typeof value.allPermissions === 'boolean'
    && boundedString(value.authorizationRevision, 1024);
}

function isActorCredentialShape(value: Record<string, unknown>): boolean {
  if (value.credentialKind === 'api-key') {
    return boundedString(value.credentialId, 256)
      && value.sessionKind === null
      && value.clientId === null;
  }
  return (value.credentialKind === undefined || value.credentialKind === 'session')
    && (value.credentialId === undefined || value.credentialId === null)
    && (value.sessionKind === 'web' || value.sessionKind === 'native')
    && nullableBoundedString(value.clientId, 256);
}

function isSystemIdentity(
  value: unknown,
): value is Extract<WorkflowExecutionIdentity, { kind: 'system' }> {
  return isRecord(value)
    && value.kind === 'system'
    && boundedString(value.principal, 120)
    && boundedString(value.reason, 500)
    && isScopeShape(value)
    && Array.isArray(value.roles) && value.roles.length === 0
    && Array.isArray(value.permissions) && value.permissions.length === 0
    && value.allPermissions === true
    && typeof value.legacyCompatibility === 'boolean';
}

function isScopeShape(value: Record<string, unknown>): boolean {
  if (value.scopeKind === 'application') {
    return value.scopeId === 'application' && value.tenantId === null;
  }
  return value.scopeKind === 'tenant'
    && boundedString(value.scopeId, 256)
    && value.tenantId === value.scopeId;
}

function isAuthorityReference(
  value: unknown,
): value is AuthContextAuthorityReference | AuthRequestAuthorityReference {
  if (!isRecord(value)) return false;
  if (value.kind === 'session') return isSessionAuthorityReference(value.reference);
  if (value.kind === 'api-key') {
    return value.version === 1
      && boundedString(value.keyId, 256)
      && generation(value.keyGeneration)
      && boundedString(value.userId, 256)
      && (value.scopeKind === 'application' || value.scopeKind === 'tenant')
      && boundedString(value.scopeId, 256)
      && (value.scopeKind === 'tenant' || value.scopeId === 'application');
  }
  return isSessionAuthorityReference(value);
}

function isSessionAuthorityReference(value: unknown): value is AuthContextAuthorityReference {
  if (!isRecord(value)
    || value.version !== 1
    || !boundedString(value.userId, 256)
    || !boundedString(value.platformRole, 128)
    || !generation(value.authGeneration)
    || (value.sessionKind !== 'web' && value.sessionKind !== 'native')
    || !boundedString(value.sessionId, 512)
    || !nullableGeneration(value.sessionGeneration)
    || !nullableBoundedString(value.clientId, 256)
    || !stringArray(value.identityScopes, 64, 128)
    || (value.sessionScopeKind !== 'application' && value.sessionScopeKind !== 'tenant')
    || !boundedString(value.sessionScopeId, 256)
    || !nullableBoundedString(value.tenantId, 256)
    || !nullableBoundedString(value.membershipId, 256)
    || !nullableBoundedString(value.tenantRole, 128)
    || !nullableGeneration(value.tenantAuthorizationGeneration)
    || !nullableGeneration(value.membershipAuthorizationGeneration)
    || !nullableBoundedString(value.authorizationAssignmentRevision, 1024)) return false;
  if (value.sessionKind === 'web') {
    if (value.sessionGeneration === null || value.clientId !== null) return false;
  } else if (value.sessionGeneration !== null || value.clientId === null) return false;
  return value.sessionScopeKind === 'application'
    ? value.sessionScopeId === 'application'
      && value.tenantId === null
      && value.membershipId === null
      && value.tenantAuthorizationGeneration === null
      && value.membershipAuthorizationGeneration === null
    : value.tenantId === value.sessionScopeId
      && value.membershipId !== null
      && value.tenantAuthorizationGeneration !== null
      && value.membershipAuthorizationGeneration !== null;
}

function actorIdentityMatchesReference(
  identity: Extract<WorkflowExecutionIdentity, { kind: 'actor' }>,
  reference: AuthContextAuthorityReference | AuthRequestAuthorityReference,
): boolean {
  if ('kind' in reference && reference.kind === 'api-key') {
    return identity.credentialKind === 'api-key'
      && identity.credentialId === reference.keyId
      && identity.userId === reference.userId
      && identity.scopeKind === reference.scopeKind
      && identity.scopeId === reference.scopeId;
  }
  const session = 'kind' in reference ? reference.reference : reference;
  return identity.credentialKind !== 'api-key'
    && identity.userId === session.userId
    && identity.platformRole === session.platformRole
    && identity.sessionKind === session.sessionKind
    && identity.clientId === session.clientId
    && identity.scopeKind === session.sessionScopeKind
    && identity.scopeId === session.sessionScopeId
    && identity.tenantId === session.tenantId
    && identity.membershipId === session.membershipId;
}

function freezePersistedAuthority(
  authority: WorkflowPersistedExecutionAuthority,
): WorkflowPersistedExecutionAuthority {
  if (authority.kind === 'system') {
    return Object.freeze({
      ...authority,
      identity: deepFreezeIdentity(authority.identity),
    });
  }
  return Object.freeze({
    ...authority,
    reference: freezeAuthorityReference(authority.reference),
    identity: deepFreezeIdentity(authority.identity),
  });
}

function freezeAuthorityReference(
  reference: AuthContextAuthorityReference | AuthRequestAuthorityReference,
): AuthContextAuthorityReference | AuthRequestAuthorityReference {
  if ('kind' in reference) {
    if (reference.kind === 'api-key') return Object.freeze({ ...reference });
    return Object.freeze({
      kind: 'session' as const,
      reference: Object.freeze({
        ...reference.reference,
        identityScopes: Object.freeze([...reference.reference.identityScopes]),
      }),
    });
  }
  return Object.freeze({
    ...reference,
    identityScopes: Object.freeze([...reference.identityScopes]),
  });
}

function deepFreezeIdentity<T extends WorkflowExecutionIdentity>(identity: T): T {
  return Object.freeze({
    ...identity,
    roles: Object.freeze([...identity.roles]),
    permissions: Object.freeze([...identity.permissions]),
  }) as T;
}

function serializeIdentity(identity: WorkflowExecutionIdentity): string {
  return JSON.stringify(identity);
}

function canonicalProperties(properties: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(properties).sort(([left], [right]) =>
    compareText(left, right)));
}

function boundedText(value: string, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`[workflows] ${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`[workflows] ${label} must contain 1-${max} characters.`);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function nullableBoundedString(value: unknown, max: number): value is string | null {
  return value === null || boundedString(value, max);
}

function generation(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nullableGeneration(value: unknown): value is number | null {
  return value === null || generation(value);
}

function stringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((entry) => typeof entry === 'string'
      && entry.length > 0
      && entry.length <= maxLength);
}

function isHexDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
