/** Shared TypeBox schemas for bounded auth HTTP fields. */

import { t } from 'elysia';
import { AUTH_REQUEST_LIMITS as LIMIT } from './auth-request-limits';

export const authUsernameSchema = t.String({
  minLength: 1,
  maxLength: LIMIT.username,
});

export const authLoginIdentifierSchema = t.String({
  minLength: 1,
  maxLength: LIMIT.loginIdentifier,
});

export const authPasswordSchema = t.String({
  minLength: 1,
  maxLength: LIMIT.password,
});

export const authNewPasswordSchema = t.String({
  minLength: 8,
  maxLength: LIMIT.password,
});

export const authDisplayNameSchema = t.String({ maxLength: LIMIT.displayName });
export const authRoleSchema = t.String({ maxLength: LIMIT.role });
export const authUserIdSchema = t.String({ minLength: 1, maxLength: LIMIT.userId });
export const authUserIdParamsSchema = t.Object({ userId: authUserIdSchema });
export const authTokenSchema = t.String({ minLength: 1, maxLength: LIMIT.token });
export const authMfaCodeSchema = t.String({ minLength: 1, maxLength: LIMIT.mfaCode });
export const authMfaLabelSchema = t.String({ maxLength: LIMIT.mfaLabel });
export const authNativeContinuationSchema = t.String({
  maxLength: LIMIT.nativeContinuation,
});
export const authUserSearchSchema = t.String({ maxLength: LIMIT.userSearch });

const propertyKeyPattern = `^[\\s\\S]{1,${LIMIT.propertyKey}}$`;

export const authPropertiesSchema = t.Record(
  t.String({ pattern: propertyKeyPattern }),
  t.Unknown(),
  {
    additionalProperties: false,
    maxProperties: LIMIT.propertyCount,
  }
);

export const authPropertyKeySchema = t.String({
  minLength: 1,
  maxLength: LIMIT.propertyKey,
});
