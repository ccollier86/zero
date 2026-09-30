import { createHash } from 'node:crypto';
import { identityProjectionError } from './identity-projection-error';
import type { IdentityAnchor } from './identity-projection-types';

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export function requireIdentityProjectionId(value: string, label: string): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID', {
      cause: new TypeError(`${label} must be a bounded opaque identifier`),
    });
  }
  return value;
}

export function validateIdentityAnchor(anchor: IdentityAnchor): IdentityAnchor {
  if (!anchor || typeof anchor !== 'object') {
    throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
  }
  if (anchor.kind === 'user') {
    return Object.freeze({
      kind: 'user',
      userId: requireIdentityProjectionId(anchor.userId, 'userId'),
    });
  }
  if (anchor.kind === 'membership') {
    return Object.freeze({
      kind: 'membership',
      membershipId: requireIdentityProjectionId(anchor.membershipId, 'membershipId'),
      tenantId: requireIdentityProjectionId(anchor.tenantId, 'tenantId'),
      userId: requireIdentityProjectionId(anchor.userId, 'userId'),
    });
  }
  throw identityProjectionError('IDENTITY_PROJECTION_SCHEMA_INVALID');
}

export function identityAnchorFingerprint(anchor: IdentityAnchor): string {
  const value = anchor.kind === 'user'
    ? `user\0${anchor.userId}`
    : `membership\0${anchor.membershipId}\0${anchor.tenantId}\0${anchor.userId}`;
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function identityAnchorDedupeKey(anchor: IdentityAnchor): string {
  return anchor.kind === 'user'
    ? `user:${anchor.userId}`
    : `membership:${anchor.membershipId}`;
}
