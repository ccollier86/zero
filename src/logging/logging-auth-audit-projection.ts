/**
 * Projects Guardian's opaque target and explicitly value-free native profile
 * descriptors into core logging. It never forwards arbitrary Guardian metadata
 * or relaxes core event validation.
 */
import type { AuthAuditEvent } from '../auth/auth-audit-types';
import { USER_PROFILE_FIELDS, USER_REGIONAL_FIELDS } from '../auth/auth-user-profile-types';
import type { LoggingScalar } from './logging-contracts';

const profileFields = new Set<string>([...USER_PROFILE_FIELDS, ...USER_REGIONAL_FIELDS.map(field => `regional.${field}`)]);

/** Preserve the affected account and safe schema names, not the submitted field values. */
export function projectAuthAuditLogging(event: AuthAuditEvent) {
  const metadata: Record<string, LoggingScalar> = {};
  if (event.action === 'account.property-updated' || event.action === 'account.property-deleted') {
    if (event.metadata.operation === 'set' || event.metadata.operation === 'delete') metadata.operation = event.metadata.operation;
    const field = event.metadata.field;
    if (typeof field === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(field)) metadata.field = field;
  }
  if (event.action === 'account.profile-updated') {
    const fields = event.metadata.fields;
    if (typeof fields === 'string' && fields.split(',').every(field => profileFields.has(field))) metadata.fields = fields;
    const revision = event.metadata.revision;
    if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0) metadata.revision = revision;
  }
  return {
    ...(event.targetType && event.targetId ? { target: { type: event.targetType, id: event.targetId } } : {}),
    metadata,
  };
}
