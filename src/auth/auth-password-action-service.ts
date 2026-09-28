/** Atomic reset/setup token consumption and password replacement. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { AuthActionTokenService } from './action-token-service';
import {
  requireAccountServices,
  type AuthAccountPluginConfig,
} from './auth-account-dependencies';
import { toAuthUserResponse } from './auth-user-response';
import { AuthError } from './types';
import type { AuthAuditRequestContext } from './auth-audit-types';

export async function completePasswordAction(
  config: AuthAccountPluginConfig,
  params: {
    rawToken: string;
    newPassword: string;
    allowedTypes: Parameters<AuthActionTokenService['consume']>[1];
    auditRequest?: AuthAuditRequestContext;
  }
) {
  const { store, actionTokens } = requireAccountServices(config);
  const inspection = actionTokens.inspect(params.rawToken, params.allowedTypes);
  if (inspection.user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
  }

  const changed = await store.completePasswordAction(
    inspection.user.userId,
    params.newPassword,
    () => {
      const currentUser = store.getUserById(inspection.user.userId);
      if (!currentUser) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      if (currentUser.status === 'suspended') {
        throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
      }
      actionTokens.consume(params.rawToken, params.allowedTypes);
      config.getNativeAuthorizationService()?.claimContinuationForUser(
        inspection.record.metadata.nativeContinuation,
        inspection.user.userId
      );
    },
    {
      actor: { userId: inspection.user.userId, provenance: 'account-recovery' },
      request: params.auditRequest,
    },
  );
  if (!changed) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  const user = store.getUserById(inspection.user.userId);
  if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);

  emitPlatformCode(OBS_CODES.AUTH_PASSWORD_RESET_COMPLETED, {
    userId: user.userId,
    metadata: { actionType: inspection.record.type },
  });
  return {
    user: toAuthUserResponse(user),
    passwordUpdated: true as const,
    signInRequired: true as const,
  };
}
