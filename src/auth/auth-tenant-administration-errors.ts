import { AuthorizationRoleAssignmentError } from './authorization-role-types';
import { AuthError } from './types';
import { TenancyError } from './tenancy/tenancy-types';

export function mapTenantAdministrationError(error: unknown): Error {
  if (error instanceof AuthError) return error;
  if (error instanceof TenancyError) {
    switch (error.code) {
      case 'TENANT_MEMBERSHIP_EXISTS':
        return new AuthError(
          'That account already has a retained membership',
          error.code,
          409,
        );
      case 'TENANT_LAST_OWNER':
      case 'TENANT_MEMBERSHIP_STATUS_CONFLICT':
      case 'TENANT_OWNERSHIP_REQUIRED':
      case 'TENANT_OWNERSHIP_TARGET_INVALID':
        return new AuthError(error.message, error.code, 409);
      case 'TENANT_MEMBERSHIP_NOT_FOUND':
      case 'TENANT_NOT_FOUND':
        return tenantMemberNotFound();
      case 'TENANT_USER_NOT_FOUND':
        return new AuthError('Account not found', error.code, 404);
      default:
        return new AuthError(error.message, error.code, 422);
    }
  }
  if (error instanceof AuthorizationRoleAssignmentError) {
    const status = error.code === 'AUTHORIZATION_SCOPE_MISMATCH'
      || error.code === 'AUTHORIZATION_SUBJECT_NOT_FOUND'
      ? 404
      : error.code === 'AUTHORIZATION_SYSTEM_ROLE_PROTECTED'
        || error.code === 'AUTHORIZATION_SUBJECT_INACTIVE'
        ? 409
        : 422;
    return new AuthError(error.message, error.code, status);
  }
  return error instanceof Error ? error : new Error('Tenant administration failed');
}

export function administrationRoleScopeRequired(roleKey: string): AuthError {
  return new AuthError(
    `Role requires the administration organization: ${roleKey}`,
    'AUTHORIZATION_ADMINISTRATION_SCOPE_REQUIRED',
    422,
  );
}

export function administrationRoleRequired(roleKey?: string): AuthError {
  return new AuthError(
    roleKey
      ? `Role is not assignable to the administration organization: ${roleKey}`
      : 'Administration organization members require at least one explicit role',
    'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED',
    422,
  );
}

export function tenantMemberNotFound(): AuthError {
  return new AuthError('Tenant member not found', 'TENANT_MEMBER_NOT_FOUND', 404);
}

export function roleRevisionRequired(): AuthError {
  return new AuthError(
    'A current role revision is required to replace tenant roles',
    'TENANT_ROLE_REVISION_REQUIRED',
    422,
  );
}

export function roleRevisionConflict(): AuthError {
  return new AuthError(
    'Tenant roles changed after this view was loaded; reload and try again',
    'TENANT_ROLE_REVISION_CONFLICT',
    409,
  );
}

export function retiredRoleCleanupRequired(): AuthError {
  return new AuthError(
    'Retired tenant roles must be removed by an owner before other roles can change',
    'TENANT_RETIRED_ROLE_CLEANUP_REQUIRED',
    409,
  );
}

export function roleEscalationForbidden(): AuthError {
  return new AuthError(
    'A role cannot be changed outside the acting member\'s authority ceiling',
    'TENANT_ROLE_ESCALATION_FORBIDDEN',
    403,
  );
}

export function protectedOwnerLifecycle(): AuthError {
  return new AuthError(
    'The owner role can only change through explicit ownership transfer',
    'TENANT_OWNER_ROLE_PROTECTED',
    409,
  );
}

export function tenantAdministrationForbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}
