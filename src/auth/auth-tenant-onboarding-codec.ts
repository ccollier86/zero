/** Storage/public projections and opaque pagination codecs for tenant onboarding. */

import { canonicalizeEmail } from './auth-email-identity';
import { createOpaqueToken } from '../tokens/token-utils';
import type {
  AuthTenantInvitation,
  AuthTenantInvitationRecord,
  AuthTenantInvitationStatus,
  AuthTenantJoinRequestRecord,
  AuthTenantJoinRequestStatus,
} from './auth-tenant-onboarding-types';
import { AuthError } from './types';

const INVITATION_TOKEN_PREFIX = 'zinv_';
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_ROLE_COUNT = 32;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface InvitationRow {
  invitation_id: string;
  tenant_id: string;
  email: string;
  token_hash: string;
  role_keys_json: string;
  grant_snapshot_json: string | null;
  grant_snapshot_fingerprint: string | null;
  status: string;
  issued_by: string;
  accepted_by_user_id: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
}

export interface JoinRequestRow {
  join_request_id: string;
  tenant_id: string;
  user_id: string;
  email: string;
  status: string;
  request_revision: number;
  requested_at: number;
  created_at: number;
  updated_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  last_decision: string | null;
  approved_membership_id: string | null;
}

interface Cursor { timestamp: number; id: string }

export function mapInvitation(row: InvitationRow): AuthTenantInvitationRecord {
  return {
    invitationId: row.invitation_id,
    tenantId: row.tenant_id,
    email: canonicalizeEmail(row.email),
    roleKeys: parseRoleKeys(row.role_keys_json),
    grantSnapshotJson: row.grant_snapshot_json,
    grantSnapshotFingerprint: row.grant_snapshot_fingerprint,
    status: row.status as AuthTenantInvitationStatus,
    issuedBy: row.issued_by,
    acceptedByUserId: row.accepted_by_user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

export function toInvitation(record: AuthTenantInvitationRecord): AuthTenantInvitation {
  return Object.freeze({
    invitationId: record.invitationId,
    email: record.email,
    roles: Object.freeze([...record.roleKeys]),
    status: record.status,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    acceptedAt: record.acceptedAt,
    revokedAt: record.revokedAt,
  });
}

export function mapJoinRequest(row: JoinRequestRow): AuthTenantJoinRequestRecord {
  return {
    joinRequestId: row.join_request_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    email: canonicalizeEmail(row.email),
    status: row.status as AuthTenantJoinRequestStatus,
    requestRevision: row.request_revision,
    requestedAt: row.requested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    lastDecision: row.last_decision as 'approved' | 'denied' | null,
    approvedMembershipId: row.approved_membership_id,
  };
}

export function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw invalidCursor(`Page limit must be between 1 and ${MAX_PAGE_LIMIT}`);
  }
  return value;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  if (value.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw invalidCursor();
    const timestamp = Reflect.get(parsed, 'timestamp');
    const id = Reflect.get(parsed, 'id');
    if (!Number.isSafeInteger(timestamp) || timestamp < 0
      || typeof id !== 'string' || id.length < 1 || id.length > 200
      || !OPAQUE_ID_PATTERN.test(id)) throw invalidCursor();
    return { timestamp, id };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw invalidCursor();
  }
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}${email.slice(at)}`;
}

export function isInvitationToken(value: string): boolean {
  return typeof value === 'string'
    && value.startsWith(INVITATION_TOKEN_PREFIX)
    && value.length >= INVITATION_TOKEN_PREFIX.length + 40
    && value.length <= 200;
}

export function createInvitationToken(): string {
  return `${INVITATION_TOKEN_PREFIX}${createOpaqueToken(32)}`;
}

function parseRoleKeys(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_ROLE_COUNT
      || parsed.some((key) => typeof key !== 'string')) throw new Error('invalid');
    return Object.freeze([...parsed]);
  } catch {
    throw new AuthError(
      'Stored invitation role binding is invalid',
      'AUTH_POLICY_UNAVAILABLE',
      503,
    );
  }
}

function invalidCursor(message = 'Page cursor is invalid'): AuthError {
  return new AuthError(message, 'TENANT_ONBOARDING_PAGE_INVALID', 422);
}
