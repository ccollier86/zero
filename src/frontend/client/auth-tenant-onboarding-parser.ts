/** Strict parsers for invitation and tenant join-request response bodies. */

import { parseAuthCompletionResult } from './auth-completion-parser';
import { isCanonicalAuthTenantSlug } from './auth-tenant-identifiers';
import type {
  AuthTenantInvitationAcceptanceResult,
  AuthTenantInvitationInspection,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestPage,
} from './auth-types';

type UnknownRecord = Record<string, unknown>;

const ID = /^[A-Za-z0-9_-]+$/;
const ROLE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const JOIN_REQUEST_STATUSES = new Set(['pending', 'approved', 'denied', 'cancelled']);
const MEMBERSHIP_STATUSES = new Set(['active', 'suspended', 'removed']);
const TENANT_KINDS = new Set(['administration', 'organization']);

/** Strictly validate the public invitation projection before it drives UI. */
export function parseTenantInvitationInspection(
  value: unknown,
): AuthTenantInvitationInspection {
  const result = exactInvitationRecord(value, valueAt(value, 'available') === false
    ? ['available']
    : ['available', 'tenant', 'platformAuthority', 'emailHint', 'expiresAt', 'account']);
  if (result.available === false) return Object.freeze({ available: false });
  if (result.available !== true
    || typeof result.platformAuthority !== 'boolean'
    || !boundedString(result.emailHint, 1, 320)
    || !isTimestamp(result.expiresAt)
    || (result.account !== 'sign-in' && result.account !== 'create')) {
    throw invalidInvitationDto();
  }
  const tenant = exactInvitationRecord(result.tenant, ['name', 'slug', 'kind']);
  if (!boundedString(tenant.name, 1, 120)
    || !isCanonicalAuthTenantSlug(tenant.slug)
    || !TENANT_KINDS.has(String(tenant.kind))
    || (result.platformAuthority && tenant.kind !== 'administration')) {
    throw invalidInvitationDto();
  }
  return Object.freeze({
    available: true,
    tenant: Object.freeze({
      name: tenant.name,
      slug: tenant.slug,
      kind: tenant.kind as 'administration' | 'organization',
    }),
    platformAuthority: result.platformAuthority,
    emailHint: result.emailHint,
    expiresAt: result.expiresAt,
    account: result.account,
  });
}

/** Validate both the auth completion and invitation-specific envelope. */
export function parseTenantInvitationAcceptance(
  value: unknown,
): AuthTenantInvitationAcceptanceResult {
  const result = invitationRecord(value);
  if (result.invitationAccepted === true) {
    let completion;
    try {
      completion = parseAuthCompletionResult(result, [
        'invitationAccepted', 'acceptedTenant',
      ]);
    } catch {
      throw invalidInvitationDto();
    }
    const tenant = exactInvitationRecord(result.acceptedTenant, [
      'tenantId', 'name', 'slug', 'kind', 'membershipId',
    ]);
    if (!identifier(tenant.tenantId)
      || !identifier(tenant.membershipId)
      || !boundedString(tenant.name, 1, 120)
      || !isCanonicalAuthTenantSlug(tenant.slug)
      || !TENANT_KINDS.has(String(tenant.kind))) throw invalidInvitationDto();
    return Object.freeze({
      ...completion,
      invitationAccepted: true,
      acceptedTenant: Object.freeze({
        tenantId: tenant.tenantId,
        name: tenant.name,
        slug: tenant.slug,
        kind: tenant.kind as 'administration' | 'organization',
        membershipId: tenant.membershipId,
      }),
    }) as AuthTenantInvitationAcceptanceResult;
  }
  if (result.invitationAcceptancePending !== true
    || Object.hasOwn(result, 'acceptedTenant')) throw invalidInvitationDto();
  let completion;
  try {
    completion = parseAuthCompletionResult(result, ['invitationAcceptancePending']);
  } catch {
    throw invalidInvitationDto();
  }
  return Object.freeze({
    ...completion,
    invitationAcceptancePending: true,
  }) as AuthTenantInvitationAcceptanceResult;
}

/** Fail closed before an untrusted response can drive reviewer controls. */
export function parseJoinRequestPage(value: unknown): AuthTenantJoinRequestPage {
  const pageValue = exactRecord(value, ['requests', 'page']);
  if (!Array.isArray(pageValue.requests) || pageValue.requests.length > 100) {
    throw invalidJoinDto();
  }
  const requests = Object.freeze(pageValue.requests.map(parseJoinRequest));
  const page = exactRecord(pageValue.page, [
    'limit', 'count', 'hasMore', 'nextCursor',
  ]);
  if (!safeInteger(page.limit, 1, 100)
    || !safeInteger(page.count, 0, 100)
    || page.count !== requests.length
    || typeof page.hasMore !== 'boolean'
    || !(page.nextCursor === null || boundedString(page.nextCursor, 1, 512))
    || page.hasMore !== (page.nextCursor !== null)) throw invalidJoinDto();
  return Object.freeze({
    requests: [...requests],
    page: Object.freeze({
      limit: page.limit,
      count: page.count,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    }),
  });
}

/** Validate approve/deny responses through the same browser trust boundary. */
export function parseJoinRequestMutation(
  value: unknown,
): { request: AuthTenantJoinRequest } {
  const result = exactRecord(value, ['request']);
  return Object.freeze({ request: parseJoinRequest(result.request) });
}

function parseJoinRequest(value: unknown): AuthTenantJoinRequest {
  const request = exactRecord(value, [
    'joinRequestId', 'applicant', 'status', 'requestRevision', 'requestedAt',
    'createdAt', 'updatedAt', 'reviewedAt', 'lastDecision', 'membership',
    'reactivationRequired', 'approvalPolicy',
  ]);
  if (!identifier(request.joinRequestId)
    || !JOIN_REQUEST_STATUSES.has(String(request.status))
    || !safeInteger(request.requestRevision, 1, Number.MAX_SAFE_INTEGER)
    || !isTimestamp(request.requestedAt)
    || !isTimestamp(request.createdAt)
    || !isTimestamp(request.updatedAt)
    || !(request.reviewedAt === null || isTimestamp(request.reviewedAt))
    || !(request.lastDecision === null
      || request.lastDecision === 'approved'
      || request.lastDecision === 'denied')
    || typeof request.reactivationRequired !== 'boolean') throw invalidJoinDto();

  const applicant = exactRecord(request.applicant, [
    'userId', 'username', 'email', 'firstName', 'lastName',
  ]);
  if (!boundedString(applicant.userId, 1, 200)
    || !boundedString(applicant.username, 1, 200)
    || !boundedString(applicant.email, 3, 320)
    || !nullableString(applicant.firstName, 200)
    || !nullableString(applicant.lastName, 200)) throw invalidJoinDto();

  let membership: AuthTenantJoinRequest['membership'] = null;
  if (request.membership !== null) {
    const candidate = exactRecord(request.membership, [
      'membershipId', 'status', 'roles',
    ]);
    if (!identifier(candidate.membershipId)
      || !MEMBERSHIP_STATUSES.has(String(candidate.status))) throw invalidJoinDto();
    const roles = parseRoleKeys(candidate.roles, 0);
    membership = Object.freeze({
      membershipId: candidate.membershipId,
      status: candidate.status as NonNullable<AuthTenantJoinRequest['membership']>['status'],
      roles: [...roles],
    });
  }

  return Object.freeze({
    joinRequestId: request.joinRequestId,
    applicant: Object.freeze({
      userId: applicant.userId,
      username: applicant.username,
      email: applicant.email,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
    }),
    status: request.status as AuthTenantJoinRequest['status'],
    requestRevision: request.requestRevision,
    requestedAt: request.requestedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    reviewedAt: request.reviewedAt,
    lastDecision: request.lastDecision,
    membership,
    reactivationRequired: request.reactivationRequired,
    approvalPolicy: parseApprovalPolicy(request.approvalPolicy),
  });
}

function parseApprovalPolicy(
  value: unknown,
): AuthTenantJoinRequest['approvalPolicy'] {
  const policy = exactRecord(value, ['canApprove', 'roleSelection']);
  if (typeof policy.canApprove !== 'boolean') throw invalidJoinDto();
  const selection = record(policy.roleSelection);
  const mode = selection.mode;
  if (mode === 'fixed' || mode === 'default') {
    assertExactKeys(selection, ['mode', 'roles']);
    const roles = parseApprovalRoles(selection.roles);
    if (roles.length !== 1) throw invalidJoinDto();
    return Object.freeze({
      canApprove: policy.canApprove,
      roleSelection: Object.freeze({ mode, roles: [...roles] }),
    });
  }
  if (mode !== 'selectable') throw invalidJoinDto();
  assertExactKeys(selection, ['mode', 'defaultRoleKeys', 'maxRoleCount', 'roles']);
  const roles = parseApprovalRoles(selection.roles);
  const defaultRoleKeys = parseRoleKeys(selection.defaultRoleKeys, 1);
  if (!safeInteger(selection.maxRoleCount, 1, 32)
    || roles.length < 1
    || defaultRoleKeys.length > selection.maxRoleCount
    || defaultRoleKeys.some((key) => !roles.some((role) => role.key === key))) {
    throw invalidJoinDto();
  }
  return Object.freeze({
    canApprove: policy.canApprove,
    roleSelection: Object.freeze({
      mode,
      defaultRoleKeys: [...defaultRoleKeys],
      maxRoleCount: selection.maxRoleCount,
      roles: [...roles],
    }),
  });
}

function parseApprovalRoles(
  value: unknown,
): AuthTenantJoinRequest['approvalPolicy']['roleSelection']['roles'] {
  if (!Array.isArray(value) || value.length > 32) throw invalidJoinDto();
  const seen = new Set<string>();
  return value.map((entry) => {
    const role = exactRecord(entry, ['key', 'label']);
    if (!boundedString(role.key, 1, 64) || !ROLE.test(role.key)
      || !boundedString(role.label, 1, 200) || seen.has(role.key)) throw invalidJoinDto();
    seen.add(role.key);
    return Object.freeze({ key: role.key, label: role.label });
  });
}

function parseRoleKeys(value: unknown, minimum: 0 | 1): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 32) {
    throw invalidJoinDto();
  }
  const roles = value.filter((key): key is string => (
    boundedString(key, 1, 64) && ROLE.test(key)
  ));
  if (roles.length !== value.length || new Set(roles).size !== roles.length) {
    throw invalidJoinDto();
  }
  return Object.freeze(roles);
}

function valueAt(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)[key]
    : undefined;
}

function exactInvitationRecord(
  value: unknown,
  keys: readonly string[],
): UnknownRecord {
  const result = invitationRecord(value);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) throw invalidInvitationDto();
  return result;
}

function invitationRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidInvitationDto();
  }
  return value as UnknownRecord;
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  const result = record(value);
  assertExactKeys(result, keys);
  return result;
}

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidJoinDto();
  return value as UnknownRecord;
}

function assertExactKeys(value: UnknownRecord, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) throw invalidJoinDto();
}

function identifier(value: unknown): value is string {
  return boundedString(value, 1, 200) && ID.test(value);
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function nullableString(value: unknown, maximum: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maximum);
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isTimestamp(value: unknown): value is number {
  return safeInteger(value, 0, 8_640_000_000_000_000);
}

function invalidJoinDto(): Error {
  return new Error('[client] Zero returned an invalid tenant join-request response.');
}

function invalidInvitationDto(): Error {
  return new Error('[client] Zero returned an invalid tenant invitation response.');
}
