/** Core profile authority identity, deliberately excluding independently adaptive contact/media/presence capabilities. */
import type { UserProfileCapabilities } from '../../auth/auth-user-profile-types';

export function userProfilePolicyKey(policy: UserProfileCapabilities | undefined): string | undefined {
  if (!policy) return undefined;
  const { state, usernameMode, fields, regional } = policy;
  return JSON.stringify({ state, usernameMode, fields, regional });
}
