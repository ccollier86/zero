/** Strict response parsers for the active-tenant administration control plane. */

import {
  parsePlatformInvitationIssue,
  parsePlatformInvitationPage,
  parsePlatformInvitationReceipt,
  parsePlatformMemberMutation,
  parsePlatformMemberPage,
  parsePlatformOwnershipTransfer,
  parsePlatformRoleDescriptor,
} from './auth-platform-administration-parser';
import type {
  AuthTenantAdministrationConfig,
  AuthTenantInvitation,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationResult,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
} from './auth-types';
import { isCanonicalAuthTenantSlug } from './auth-tenant-identifiers';

const ID = /^[A-Za-z0-9_-]+$/;
const ROLE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PERMISSION = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*(?::[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)+$/;
const CAPABILITIES = [
  'canReadMembers',
  'canManageMembers',
  'canReadRoles',
  'canManageRoles',
  'canTransferOwnership',
  'canReadInvitations',
  'canManageInvitations',
  'canReviewJoinRequests',
] as const;

export function parseTenantAdministrationConfig(
  value: unknown,
): AuthTenantAdministrationConfig {
  return translate(() => {
    const result = exact(value, [
      'tenancy', 'authorization', 'terminology', 'tenant', 'actor',
      'capabilities', 'roles',
    ]);
    if (result.tenancy !== 'multi'
      || (result.authorization !== 'simple' && result.authorization !== 'advanced')) {
      throw invalid();
    }
    const terminology = exact(result.terminology, ['singular', 'plural']);
    const singular = normalizedText(terminology.singular, 40);
    const plural = normalizedText(terminology.plural, 40);
    const tenant = exact(result.tenant, ['tenantId', 'kind', 'slug', 'name']);
    if (tenant.kind !== 'administration' && tenant.kind !== 'organization') throw invalid();
    const actor = exact(result.actor, [
      'membershipId', 'roles', 'permissions', 'allPermissions',
    ]);
    if (typeof actor.allPermissions !== 'boolean') throw invalid();
    const actorRoles = keyArray(actor.roles, 128, ROLE, 64);
    const permissions = keyArray(actor.permissions, 512, PERMISSION, 128);
    const capabilities = exact(result.capabilities, CAPABILITIES);
    for (const key of CAPABILITIES) {
      if (typeof capabilities[key] !== 'boolean') throw invalid();
    }
    if (tenant.kind === 'administration' && capabilities.canReviewJoinRequests === true) {
      throw invalid();
    }
    const roles = array(result.roles, 128, parsePlatformRoleDescriptor);
    unique(roles.map((role) => role.key));

    return Object.freeze({
      tenancy: 'multi' as const,
      authorization: result.authorization,
      terminology: Object.freeze({ singular, plural }),
      tenant: Object.freeze({
        tenantId: id(tenant.tenantId),
        kind: tenant.kind,
        slug: slug(tenant.slug),
        name: text(tenant.name, 120),
      }),
      actor: Object.freeze({
        membershipId: id(actor.membershipId),
        roles: actorRoles,
        permissions,
        allPermissions: actor.allPermissions,
      }),
      capabilities: Object.freeze(Object.fromEntries(
        CAPABILITIES.map((key) => [key, capabilities[key]]),
      )) as AuthTenantAdministrationConfig['capabilities'],
      roles,
    });
  });
}

export function parseTenantMemberPage(value: unknown): AuthTenantMemberPage {
  return translate(() => parsePlatformMemberPage(value));
}

export function parseTenantMemberMutation(
  value: unknown,
): AuthTenantMemberMutationResult {
  return translate(() => parsePlatformMemberMutation(value));
}

export function parseTenantOwnershipTransfer(
  value: unknown,
): AuthTenantOwnershipTransferResult {
  return translate(() => parsePlatformOwnershipTransfer(value));
}

export function parseTenantInvitationPage(value: unknown): AuthTenantInvitationPage {
  return translate(() => parsePlatformInvitationPage(value));
}

export function parseTenantInvitationIssue(
  value: unknown,
): AuthTenantIssueInvitationResult {
  return translate(() => parsePlatformInvitationIssue(value));
}

export function parseTenantInvitationReceipt(
  value: unknown,
): { invitation: AuthTenantInvitation } {
  return translate(() => parsePlatformInvitationReceipt(value));
}

export function parseTenantJoinRequestSubmission(
  value: unknown,
): { submitted: true } {
  const result = exact(value, ['submitted']);
  if (result.submitted !== true) throw invalid();
  return Object.freeze({ submitted: true });
}

function translate<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw invalid();
  }
}

function exact(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length
    || keys.some((key) => !Object.hasOwn(result, key))) throw invalid();
  return result;
}

function array<T>(
  value: unknown,
  maximum: number,
  parse: (entry: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalid();
  return Object.freeze(value.map(parse)) as unknown as T[];
}

function keyArray(
  value: unknown,
  maximum: number,
  pattern: RegExp,
  maximumLength: number,
): string[] {
  const result = array(value, maximum, (entry) => {
    const key = text(entry, maximumLength);
    if (!pattern.test(key)) throw invalid();
    return key;
  });
  unique(result);
  return result;
}

function id(value: unknown): string {
  const result = text(value, 200);
  if (!ID.test(result)) throw invalid();
  return result;
}

function slug(value: unknown): string {
  if (!isCanonicalAuthTenantSlug(value)) throw invalid();
  return value;
}

function normalizedText(value: unknown, maximum: number): string {
  const result = text(value, maximum);
  if (result !== result.trim().toLocaleLowerCase('en-US')) throw invalid();
  return result;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw invalid();
  }
  return value;
}

function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw invalid();
}

function invalid(): Error {
  return new Error('[client] Zero returned an invalid tenant-administration response.');
}
