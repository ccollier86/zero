/** Strict parsers for untrusted platform-administration response bodies. */

import type {
  AuthPlatformAdministrationConfig,
  AuthPlatformTenant,
  AuthPlatformTenantCreateResult,
  AuthPlatformTenantOwnershipTransferResult,
  AuthPlatformTenantPage,
  AuthPlatformTenantUpdateResult,
} from './auth-platform-administration-types';
import type {
  AuthTenantInvitation,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationResult,
  AuthTenantMember,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
} from './auth-types';
import { isCanonicalAuthTenantSlug } from './auth-tenant-identifiers';

const ID = /^[A-Za-z0-9_-]+$/;
const ROLE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PERMISSION = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*(?::[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)+$/;
const EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const MEMBER_STATUSES = new Set(['active', 'suspended', 'removed']);
const INVITATION_STATUSES = new Set(['pending', 'accepted', 'revoked', 'expired']);
const TENANT_STATUSES = new Set(['active', 'suspended', 'archived']);
const MAX_PAGE = 100;

export function parsePlatformAdministrationConfig(
  value: unknown,
): AuthPlatformAdministrationConfig {
  const result = exact(value, [
    'authorization', 'administration', 'capabilities', 'roles', 'customerRoles',
  ]);
  if (result.authorization !== 'simple' && result.authorization !== 'advanced') throw invalid();
  const administration = exact(result.administration, [
    'tenantId', 'kind', 'slug', 'name', 'membershipId',
  ]);
  if (administration.kind !== 'administration') throw invalid();
  const capabilities = exact(result.capabilities, [
    'canReadMembers', 'canManageMembers', 'canManageRoles', 'canReadInvitations',
    'canManageInvitations', 'canReadTenants', 'canManageTenants',
    'canReadTenantMembers', 'canManageTenantMembers', 'canCreateTenants',
    'canTransferOwnership',
  ]);
  for (const value of Object.values(capabilities)) {
    if (typeof value !== 'boolean') throw invalid();
  }
  const roles = parseArray(result.roles, 128, parsePlatformRoleDescriptor);
  const customerRoles = parseArray(
    result.customerRoles,
    128,
    parsePlatformRoleDescriptor,
  );
  unique(roles.map((role) => role.key));
  unique(customerRoles.map((role) => role.key));
  return Object.freeze({
    authorization: result.authorization,
    administration: Object.freeze({
      tenantId: id(administration.tenantId),
      kind: 'administration',
      slug: slug(administration.slug),
      name: text(administration.name, 120),
      membershipId: id(administration.membershipId),
    }),
    capabilities: Object.freeze({
      canReadMembers: capabilities.canReadMembers,
      canManageMembers: capabilities.canManageMembers,
      canManageRoles: capabilities.canManageRoles,
      canReadInvitations: capabilities.canReadInvitations,
      canManageInvitations: capabilities.canManageInvitations,
      canReadTenants: capabilities.canReadTenants,
      canReadTenantMembers: capabilities.canReadTenantMembers,
      canManageTenantMembers: capabilities.canManageTenantMembers,
      canManageTenants: capabilities.canManageTenants,
      canCreateTenants: capabilities.canCreateTenants,
      canTransferOwnership: capabilities.canTransferOwnership,
    }) as AuthPlatformAdministrationConfig['capabilities'],
    roles,
    customerRoles,
  });
}

export function parsePlatformMemberPage(value: unknown): AuthTenantMemberPage {
  const result = exact(value, ['members', 'page']);
  const members = parseArray(result.members, MAX_PAGE, parseMember);
  return Object.freeze({ members, page: parsePage(result.page, members.length) });
}

export function parsePlatformMemberMutation(
  value: unknown,
): AuthTenantMemberMutationResult {
  const result = exact(value, ['member', 'actorSessionInvalidated']);
  if (typeof result.actorSessionInvalidated !== 'boolean') throw invalid();
  return Object.freeze({
    member: parseMember(result.member),
    actorSessionInvalidated: result.actorSessionInvalidated,
  });
}

export function parsePlatformTenantMemberMutation(
  value: unknown,
): AuthTenantMemberMutationResult & { actorSessionInvalidated: false } {
  const result = parsePlatformMemberMutation(value);
  if (result.actorSessionInvalidated !== false) throw invalid();
  return Object.freeze({ ...result, actorSessionInvalidated: false });
}

export function parsePlatformOwnershipTransfer(
  value: unknown,
): AuthTenantOwnershipTransferResult {
  const result = exact(value, ['owner', 'previousOwner', 'actorSessionInvalidated']);
  if (result.actorSessionInvalidated !== true) throw invalid();
  return Object.freeze({
    owner: parseMember(result.owner),
    previousOwner: parseMember(result.previousOwner),
    actorSessionInvalidated: true,
  });
}

export function parsePlatformTenantOwnershipTransfer(
  value: unknown,
): AuthPlatformTenantOwnershipTransferResult {
  const result = exact(value, ['owner', 'previousOwner', 'actorSessionInvalidated']);
  if (result.actorSessionInvalidated !== false) throw invalid();
  return Object.freeze({
    owner: parseMember(result.owner),
    previousOwner: parseMember(result.previousOwner),
    actorSessionInvalidated: false,
  });
}

export function parsePlatformInvitationPage(value: unknown): AuthTenantInvitationPage {
  const result = exact(value, ['invitations', 'page']);
  const invitations = parseArray(result.invitations, MAX_PAGE, parseInvitation);
  return Object.freeze({
    invitations,
    page: parsePage(result.page, invitations.length),
  });
}

export function parsePlatformInvitationIssue(
  value: unknown,
): AuthTenantIssueInvitationResult {
  const result = record(value);
  if (!('invitation' in result) || !('delivery' in result)) throw invalid();
  const invitation = parseInvitation(result.invitation);
  const delivery = record(result.delivery);
  if (delivery.mode === 'manual') {
    assertKeys(result, ['invitation', 'delivery', 'token']);
    assertKeys(delivery, ['mode']);
    return Object.freeze({
      invitation,
      delivery: Object.freeze({ mode: 'manual' as const }),
      token: text(result.token, 4096),
    });
  }
  assertKeys(result, ['invitation', 'delivery']);
  assertKeys(delivery, ['mode', 'status']);
  if (delivery.mode !== 'email' || delivery.status !== 'queued') throw invalid();
  return Object.freeze({
    invitation,
    delivery: Object.freeze({ mode: 'email' as const, status: 'queued' as const }),
  });
}

export function parsePlatformInvitationReceipt(
  value: unknown,
): { invitation: AuthTenantInvitation } {
  const result = exact(value, ['invitation']);
  return Object.freeze({ invitation: parseInvitation(result.invitation) });
}

export function parsePlatformTenantPage(value: unknown): AuthPlatformTenantPage {
  const result = exact(value, ['tenants', 'page']);
  const tenants = parseArray(result.tenants, MAX_PAGE, parseTenant);
  unique(tenants.map((tenant) => tenant.tenantId));
  return Object.freeze({ tenants, page: parsePage(result.page, tenants.length) });
}

export function parsePlatformTenantCreate(
  value: unknown,
): AuthPlatformTenantCreateResult {
  const result = exact(value, ['tenant', 'owner']);
  return Object.freeze({
    tenant: parseTenant(result.tenant),
    owner: parseMember(result.owner),
  });
}

export function parsePlatformTenantUpdate(
  value: unknown,
): AuthPlatformTenantUpdateResult {
  const result = exact(value, ['tenant']);
  return Object.freeze({ tenant: parseTenant(result.tenant) });
}

/** @internal Strict role parser shared by tenant-scoped response boundaries. */
export function parsePlatformRoleDescriptor(value: unknown): AuthTenantRoleDescriptor {
  const role = allowed(value, [
    'key', 'label', 'description', 'administrationOnly', 'permissions',
    'allPermissions', 'system', 'assignable', 'grantable',
  ], ['key', 'label', 'administrationOnly', 'permissions', 'allPermissions',
    'system', 'assignable', 'grantable']);
  const permissions = parseArray(role.permissions, 512, permissionKey);
  unique(permissions);
  if (typeof role.administrationOnly !== 'boolean'
    || typeof role.allPermissions !== 'boolean'
    || typeof role.system !== 'boolean'
    || typeof role.assignable !== 'boolean'
    || typeof role.grantable !== 'boolean'
    || !(role.description === undefined || typeof role.description === 'string')) throw invalid();
  return Object.freeze({
    key: roleKey(role.key),
    label: text(role.label, 200),
    ...(role.description === undefined ? {} : { description: text(role.description, 500) }),
    administrationOnly: role.administrationOnly,
    permissions,
    allPermissions: role.allPermissions,
    system: role.system,
    assignable: role.assignable,
    grantable: role.grantable,
  });
}

function parseMember(value: unknown): AuthTenantMember {
  const member = exact(value, [
    'membershipId', 'identity', 'status', 'roles', 'roleRevision',
    'joinedAt', 'updatedAt',
  ]);
  const identity = exact(member.identity, [
    'userId', 'username', 'email', 'firstName', 'lastName',
  ]);
  if (!MEMBER_STATUSES.has(String(member.status))) throw invalid();
  const roles = parseArray(member.roles, 32, roleKey);
  unique(roles);
  return Object.freeze({
    membershipId: id(member.membershipId),
    identity: Object.freeze({
      userId: id(identity.userId),
      username: text(identity.username, 200),
      email: email(identity.email),
      firstName: nullableText(identity.firstName, 200),
      lastName: nullableText(identity.lastName, 200),
    }),
    status: member.status as AuthTenantMember['status'],
    roles,
    roleRevision: text(member.roleRevision, 512),
    joinedAt: timestamp(member.joinedAt),
    updatedAt: timestamp(member.updatedAt),
  });
}

function parseInvitation(value: unknown): AuthTenantInvitation {
  const invitation = exact(value, [
    'invitationId', 'email', 'roles', 'status', 'expiresAt', 'createdAt',
    'updatedAt', 'acceptedAt', 'revokedAt',
  ]);
  if (!INVITATION_STATUSES.has(String(invitation.status))) throw invalid();
  const roles = parseArray(invitation.roles, 32, roleKey);
  unique(roles);
  return Object.freeze({
    invitationId: id(invitation.invitationId),
    email: email(invitation.email),
    roles,
    status: invitation.status as AuthTenantInvitation['status'],
    expiresAt: timestamp(invitation.expiresAt),
    createdAt: timestamp(invitation.createdAt),
    updatedAt: timestamp(invitation.updatedAt),
    acceptedAt: nullableTimestamp(invitation.acceptedAt),
    revokedAt: nullableTimestamp(invitation.revokedAt),
  });
}

function parseTenant(value: unknown): AuthPlatformTenant {
  const tenant = exact(value, [
    'tenantId', 'kind', 'slug', 'name', 'status', 'authorizationGeneration',
    'createdAt', 'updatedAt', 'suspendedAt', 'memberCount', 'activeMemberCount',
  ]);
  if (tenant.kind !== 'organization' || !TENANT_STATUSES.has(String(tenant.status))) {
    throw invalid();
  }
  const memberCount = integer(tenant.memberCount, 0);
  const activeMemberCount = integer(tenant.activeMemberCount, 0);
  if (activeMemberCount > memberCount) throw invalid();
  return Object.freeze({
    tenantId: id(tenant.tenantId),
    kind: 'organization',
    slug: slug(tenant.slug),
    name: text(tenant.name, 120),
    status: tenant.status as AuthPlatformTenant['status'],
    authorizationGeneration: integer(tenant.authorizationGeneration, 0),
    createdAt: timestamp(tenant.createdAt),
    updatedAt: timestamp(tenant.updatedAt),
    suspendedAt: nullableTimestamp(tenant.suspendedAt),
    memberCount,
    activeMemberCount,
  });
}

function parsePage(value: unknown, itemCount: number): AuthTenantMemberPage['page'] {
  const page = exact(value, ['limit', 'count', 'hasMore', 'nextCursor']);
  const limit = integer(page.limit, 1, MAX_PAGE);
  const count = integer(page.count, 0, limit);
  const hasMore = page.hasMore;
  const nextCursor = page.nextCursor === null ? null : text(page.nextCursor, 512);
  if (count !== itemCount || typeof hasMore !== 'boolean'
    || hasMore !== (nextCursor !== null)) throw invalid();
  return Object.freeze({ limit, count, hasMore, nextCursor });
}

function parseArray<T>(value: unknown, max: number, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return Object.freeze(value.map(parse)) as unknown as T[];
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value);
  assertKeys(result, keys);
  return result;
}

function allowed(
  value: unknown,
  keys: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  const result = record(value);
  const permitted = new Set(keys);
  if (Object.keys(result).some((key) => !permitted.has(key))
    || required.some((key) => !Object.hasOwn(result, key))) throw invalid();
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) throw invalid();
}

function id(value: unknown): string {
  const result = text(value, 200);
  if (!ID.test(result)) throw invalid();
  return result;
}

function roleKey(value: unknown): string {
  const result = text(value, 64);
  if (!ROLE.test(result)) throw invalid();
  return result;
}

function slug(value: unknown): string {
  if (!isCanonicalAuthTenantSlug(value)) throw invalid();
  return value;
}

function permissionKey(value: unknown): string {
  const result = text(value, 128);
  if (!PERMISSION.test(result)) throw invalid();
  return result;
}

function email(value: unknown): string {
  const result = text(value, 254);
  if (result !== result.trim().toLowerCase() || !EMAIL.test(result)) throw invalid();
  return result;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw invalid();
  return value;
}

function nullableText(value: unknown, max: number): string | null {
  return value === null ? null : text(value, max);
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw invalid();
  }
  return value as number;
}

function timestamp(value: unknown): number {
  return integer(value, 0);
}

function nullableTimestamp(value: unknown): number | null {
  return value === null ? null : timestamp(value);
}

function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw invalid();
}

function invalid(): Error {
  return new Error('[client] Zero returned an invalid platform-administration response.');
}
