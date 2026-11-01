import { expect, test } from 'bun:test';
import type { AuthAuditEvent } from '../auth/auth-audit-types';
import { projectAuthAuditLogging } from './logging-auth-audit-projection';

function event(action: string, metadata: AuthAuditEvent['metadata']): AuthAuditEvent {
  return { eventId: 'synthetic-event', occurredAt: 1, action, outcome: 'succeeded', reason: null,
    scopeKind: 'application', tenantId: null, actorUserId: 'account', actorMembershipId: null,
    actorSessionId: 'synthetic-session', actorSessionKind: 'web', actorClientId: null,
    actorProvenance: 'authenticated-request', requestId: null, correlationId: null,
    targetType: 'user', targetId: 'account', metadata };
}

test('native audit preserves the affected account and only explicitly value-free descriptors', () => {
  expect(projectAuthAuditLogging(event('account.profile-updated', { fields: 'firstName,bio,regional.timeZone', revision: 2, extra: 'PRIVATE_VALUE' })))
    .toEqual({ target: { type: 'user', id: 'account' }, metadata: { fields: 'firstName,bio,regional.timeZone', revision: 2 } });
  expect(projectAuthAuditLogging(event('account.property-updated', { field: 'professional_credentials', operation: 'set', value: 'PRIVATE_VALUE' })))
    .toEqual({ target: { type: 'user', id: 'account' }, metadata: { field: 'professional_credentials', operation: 'set' } });
  expect(projectAuthAuditLogging(event('account.properties-updated-by-admin', { extra: 'PRIVATE_VALUE' })))
    .toEqual({ target: { type: 'user', id: 'account' }, metadata: {} });
});

test('unrecognized field lists and arbitrary metadata do not cross the core audit bridge', () => {
  expect(projectAuthAuditLogging(event('account.profile-updated', { fields: 'PRIVATE_VALUE', revision: -1 })).metadata).toEqual({});
  expect(projectAuthAuditLogging(event('account.property-updated', { field: 'PRIVATE FIELD VALUE', operation: 'PRIVATE_VALUE' })).metadata).toEqual({});
});
