import { hashToken } from '../tokens/token-utils';
import type { AuthorizationKernel } from './authorization-kernel';
import { isRoleAssignableToTenantKind } from './authorization-registry';
import {
  createAuthStateInvariantError,
  type AuthPlatformCodeEmitter,
} from './auth-observability';
import type { TenantKind } from './tenancy/tenancy-types';

const SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_PERMISSION_COUNT = 4_096;

interface InvitationGrantSnapshot {
  version: typeof SNAPSHOT_VERSION;
  tenantPermissions: readonly string[];
  applicationPermissions: readonly string[];
}

export interface PersistedInvitationGrantSnapshot {
  json: string;
  fingerprint: string;
}

/**
 * Freeze the effective authority approved by an invitation issuer.
 *
 * `allPermissions` is expanded to the concrete registry at issuance so a
 * later declaration cannot silently widen an unconsumed bearer grant.
 */
export function createInvitationGrantSnapshot(input: {
  kernel: AuthorizationKernel;
  tenantKind: TenantKind;
  roleKeys: readonly string[];
}, emitCode?: AuthPlatformCodeEmitter): PersistedInvitationGrantSnapshot {
  const snapshot = resolveEffectiveGrant(input);
  if (!snapshot) {
    throw createAuthStateInvariantError(emitCode, {
      component: 'tenant-invitation-service',
      invariant: 'normalized-invitation-grant-unassignable',
      message: '[auth] Normalized invitation roles are not assignable.',
    });
  }
  const json = JSON.stringify(snapshot);
  return Object.freeze({ json, fingerprint: hashToken(json) });
}

/**
 * Accept narrowing but reject missing, corrupt, retired, or widened grants.
 * Legacy pending invitations without a snapshot intentionally fail closed.
 */
export function invitationGrantRemainsWithinSnapshot(input: {
  kernel: AuthorizationKernel;
  tenantKind: TenantKind;
  roleKeys: readonly string[];
  snapshotJson: string | null;
  snapshotFingerprint: string | null;
}): boolean {
  const issued = parseSnapshot(input.snapshotJson, input.snapshotFingerprint);
  if (!issued) return false;
  const current = resolveEffectiveGrant(input);
  if (!current) return false;
  return isSubset(current.tenantPermissions, issued.tenantPermissions)
    && isSubset(current.applicationPermissions, issued.applicationPermissions);
}

function resolveEffectiveGrant(input: {
  kernel: AuthorizationKernel;
  tenantKind: TenantKind;
  roleKeys: readonly string[];
}): InvitationGrantSnapshot | null {
  if (!Array.isArray(input.roleKeys)
    || input.roleKeys.length < 1
    || input.roleKeys.length > 32) return null;
  const tenant = new Set<string>();
  const application = new Set<string>();
  for (const roleKey of input.roleKeys) {
    const role = input.kernel.authorization.roles[roleKey];
    if (!role || role.system || !isRoleAssignableToTenantKind(
      roleKey,
      input.tenantKind,
      input.kernel.authorization,
    )) return null;
    const permissions = role.allPermissions
      ? Object.keys(input.kernel.authorization.permissions)
      : role.permissions;
    for (const permissionKey of permissions) {
      const permission = input.kernel.authorization.permissions[permissionKey];
      if (!permission) return null;
      if (permission.scope === 'application') {
        // `allPermissions` is scope-relative. An ordinary organization can
        // never project application authority, so application declarations
        // are not part of that invitation's effective grant or drift fence.
        if (input.tenantKind === 'administration') application.add(permissionKey);
      } else {
        tenant.add(permissionKey);
      }
    }
  }
  if (tenant.size > MAX_PERMISSION_COUNT || application.size > MAX_PERMISSION_COUNT) {
    return null;
  }
  return Object.freeze({
    version: SNAPSHOT_VERSION,
    tenantPermissions: Object.freeze([...tenant].sort(compareKeys)),
    applicationPermissions: Object.freeze([...application].sort(compareKeys)),
  });
}

function parseSnapshot(
  json: string | null,
  fingerprint: string | null,
): InvitationGrantSnapshot | null {
  if (!json || !fingerprint || json.length > MAX_SNAPSHOT_BYTES
    || hashToken(json) !== fingerprint) return null;
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    if (!value || Array.isArray(value) || value.version !== SNAPSHOT_VERSION
      || Object.keys(value).sort(compareKeys).join(',')
        !== 'applicationPermissions,tenantPermissions,version') return null;
    const tenantPermissions = parsePermissionArray(value.tenantPermissions);
    const applicationPermissions = parsePermissionArray(value.applicationPermissions);
    if (!tenantPermissions || !applicationPermissions) return null;
    return Object.freeze({
      version: SNAPSHOT_VERSION,
      tenantPermissions,
      applicationPermissions,
    });
  } catch {
    return null;
  }
}

function parsePermissionArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PERMISSION_COUNT
    || value.some((entry) => typeof entry !== 'string' || entry.length < 1)) return null;
  const normalized = [...new Set(value)].sort(compareKeys);
  if (normalized.length !== value.length
    || normalized.some((entry, index) => entry !== value[index])) return null;
  return Object.freeze(normalized);
}

function isSubset(current: readonly string[], issued: readonly string[]): boolean {
  const ceiling = new Set(issued);
  return current.every((permission) => ceiling.has(permission));
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
