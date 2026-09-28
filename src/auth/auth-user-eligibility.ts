import type { UserRecord } from './types';

/** Fields which decide whether an account can receive an application token. */
export type AuthTokenEligibleUser = Pick<
  UserRecord,
  | 'status'
  | 'passwordChangeRequired'
  | 'emailVerificationRequired'
  | 'emailVerifiedAt'
>;

/**
 * Canonical account predicate shared by token issuance and owner lifecycles.
 *
 * Ownership is a recovery boundary, so an "active" row is not enough: the
 * owner must also be able to complete a normal authenticated request.
 */
export function canUserReceiveAuthTokens(
  user: AuthTokenEligibleUser | null | undefined,
): user is AuthTokenEligibleUser {
  return Boolean(user
    && user.status === 'active'
    && !user.passwordChangeRequired
    && (!user.emailVerificationRequired
      || (typeof user.emailVerifiedAt === 'number' && user.emailVerifiedAt > 0)));
}

/**
 * SQL equivalent of canUserReceiveAuthTokens(). `alias` is always a trusted
 * schema-owned identifier, never request input.
 */
export function authTokenEligibleUserSql(alias: string): string {
  assertSqlIdentifier(alias);
  return `${alias}.status = 'active'
    AND ${alias}.password_change_required = 0
    AND (${alias}.email_verification_required = 0
      OR COALESCE(${alias}.email_verified_at, 0) > 0)`;
}

/**
 * Deliberate registration-only bridge after verification delivery is queued
 * and before the address is verified. The intent is removed in the same
 * transaction that makes the account token-eligible.
 */
export function recoverableRegistrationUserSql(alias: string): string {
  assertSqlIdentifier(alias);
  return recoverableRegistrationUserBaseSql(alias, 'registration_intent.tenant_id IS NULL');
}

/** Historical pre-015 form, before a registration intent carried tenant scope. */
export function recoverableLegacyRegistrationUserSql(alias: string): string {
  assertSqlIdentifier(alias);
  return recoverableRegistrationUserBaseSql(alias, '1 = 1');
}

/** Exact organization-scoped variant of the registration bridge. */
export function recoverableTenantRegistrationUserSql(
  userAlias: string,
  tenantAlias: string,
): string {
  assertSqlIdentifier(userAlias);
  assertSqlIdentifier(tenantAlias);
  return recoverableRegistrationUserBaseSql(
    userAlias,
    `registration_intent.tenant_id = ${tenantAlias}.tenant_id`,
  );
}

function recoverableRegistrationUserBaseSql(
  alias: string,
  intentScopeSql: string,
): string {
  return `${alias}.status = 'active'
    AND ${alias}.password_change_required = 0
    AND ${alias}.email_verification_required = 1
    AND (${alias}.email_verified_at IS NULL OR ${alias}.email_verified_at <= 0)
    AND EXISTS (
      SELECT 1 FROM _auth_registration_intents registration_intent
      WHERE registration_intent.user_id = ${alias}.user_id
        AND ${intentScopeSql}
    )`;
}

function assertSqlIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }
}
