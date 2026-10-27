/** Reuse Guardian's account eligibility; an unfinished provisioning row is never a chat identity. */
import { authTokenEligibleUserSql } from '../auth/auth-user-eligibility';
export const MESSAGING_DIRECTORY_ELIGIBLE = `${authTokenEligibleUserSql('u')}
  AND NOT EXISTS (SELECT 1 FROM _auth_registration_provisioning r WHERE r.user_id=u.user_id)
  AND NOT EXISTS (SELECT 1 FROM _auth_admin_user_provisioning p WHERE p.user_id=u.user_id)`;
