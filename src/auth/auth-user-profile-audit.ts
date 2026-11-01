/** Value-free, canonical profile change evidence. No biography, names, links or regional values are retained. */
import type { AuthAuditActor, AuthAuditRequestContext } from './auth-audit-types';
import { USER_PROFILE_FIELDS, USER_REGIONAL_FIELDS, type UserProfileValues } from './auth-user-profile-types';
import type { UserStore } from './user-store';

/** Append only real accepted field changes inside the profile writer's active transaction. */
export function appendUserProfileAudit(
  users: UserStore, userId: string, actor: AuthAuditActor,
  before: UserProfileValues, after: UserProfileValues, revision: number, request?: AuthAuditRequestContext,
): boolean {
  const fields: string[] = USER_PROFILE_FIELDS.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  fields.push(...USER_REGIONAL_FIELDS.filter(field => before.regional[field] !== after.regional[field]).map(field => `regional.${field}`));
  if (!fields.length) return false;
  users.appendControlPlaneAudit({ action: 'account.profile-updated', outcome: 'succeeded',
    scope: { kind: 'application' }, actor, request, target: { type: 'user', id: userId },
    metadata: { fields: fields.join(','), revision } });
  return true;
}
