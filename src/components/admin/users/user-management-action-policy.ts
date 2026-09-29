/**
 * user-management-action-policy.ts
 *
 * Resolves which admin-user actions are safe and operational for one row. This
 * module owns pure UI policy only; backend authorization remains authoritative.
 */

import type { AuthAdminConfig, AuthAdminUserMfaStatus } from '../../../frontend/client/auth-client';
import type { UserManagementUser } from './user-management-types';

export interface UserManagementActionPolicy {
  setupEmail: boolean;
  setPassword: boolean;
  resetEmail: boolean;
  clearPasswordRequirement: boolean;
  sendVerification: boolean;
  verifyEmail: boolean;
  revokeSessions: boolean;
  suspend: boolean;
  activate: boolean;
  deleteUser: boolean;
  requireMfa: boolean;
  clearMfa: boolean;
  resetMfa: boolean;
}

/** Return action visibility without weakening server-side auth invariants. */
export function resolveUserManagementActionPolicy(params: {
  user: UserManagementUser;
  config: AuthAdminConfig | null;
  mfaStatus: AuthAdminUserMfaStatus | null;
  currentUserId: string | null;
  controlled: boolean;
  controlledDelete: boolean;
}): UserManagementActionPolicy {
  const { user, config, mfaStatus } = params;
  const live = !params.controlled;
  const self = user.userId === params.currentUserId;
  const active = user.status === 'active';
  const verificationPending = user.emailVerificationRequired && user.emailVerifiedAt === null;
  const mfaRequired = mfaStatus?.required ?? user.mfaRequired;
  // Multi-tenant identities may own retained membership, invitation, join-
  // request, or tenant-attribution history that must not be cascaded. The
  // generic identity list does not expose enough lifecycle detail to prove a
  // row is history-free, so the packaged live UI offers suspension instead.
  // A controlled surface owns its own lifecycle ceremony and may opt in.
  const liveDelete = live && config !== null
    && (config.tenancy?.mode ?? 'single') === 'single';
  const canManageTarget = !live || Boolean(
    config?.capabilities.canManageUsers
    && (user.role !== 'admin' || config.capabilities.canManageGlobalAdmins),
  );

  return {
    setupEmail: canManageTarget && live && !self && active && user.passwordChangeRequired
      && Boolean(config?.capabilities.setupEmail),
    setPassword: canManageTarget && live && !self && Boolean(config?.capabilities.manualPasswordReset),
    resetEmail: canManageTarget && live && !self && active && Boolean(config?.capabilities.passwordResetEmail),
    clearPasswordRequirement: canManageTarget && live && !self && user.passwordChangeRequired,
    sendVerification: canManageTarget && live && !self && active && verificationPending
      && Boolean(config?.capabilities.emailVerification),
    verifyEmail: canManageTarget && live && !self && verificationPending
      && Boolean(config?.capabilities.adminMarkEmailVerified),
    revokeSessions: canManageTarget && live && !self && active,
    suspend: canManageTarget && live && !self && active && Boolean(config?.capabilities.suspendUsers),
    activate: canManageTarget && live && !self && !active && Boolean(config?.capabilities.suspendUsers),
    deleteUser: canManageTarget && !self && (liveDelete || (!live && params.controlledDelete)),
    requireMfa: canManageTarget && live && !self && !mfaRequired && Boolean(config?.capabilities.mfa),
    clearMfa: canManageTarget && live && !self && user.mfaRequired,
    resetMfa: canManageTarget && live && !self && Boolean(mfaStatus?.methods.length),
  };
}

/** Return whether the configured registration policy permits admin creation. */
export function canCreateManagedUser(config: AuthAdminConfig | null): boolean {
  return config?.capabilities.canManageUsers === true
    && config.registration.mode !== 'disabled';
}
