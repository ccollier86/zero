'use client';

/**
 * user-management-security-panel.tsx
 *
 * Displays only security states that need an administrator's attention. Normal
 * states stay out of the detail pane so routine profile editing remains compact.
 */

import type { AuthAdminUserMfaStatus } from '../../../frontend/client/auth-client';
import { Badge } from '../../ui/badge';
import type { UserManagementUser } from './user-management-types';

/** Render exceptional security gates and enrolled MFA methods for the selected user. */
export function UserManagementSecurityPanel({
  user,
  mfaStatus,
  loading,
  error,
}: {
  user: UserManagementUser;
  mfaStatus: AuthAdminUserMfaStatus | null;
  loading: boolean;
  error: string | null;
}) {
  const notices = getSecurityNotices(user, mfaStatus);
  const methods = mfaStatus?.methods ?? [];

  if (notices.length === 0 && methods.length === 0 && !error) return null;

  return (
    <section
      className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3"
      aria-label="Security attention"
      aria-busy={loading}
    >
      {notices.map((notice) => (
        <Badge key={notice} variant="warning">
          {notice}
        </Badge>
      ))}
      {methods.map((method) => (
        <Badge key={method.methodId} variant="outline" className="capitalize">
          {method.type} {method.status}
        </Badge>
      ))}
      {error && <p className="text-xs text-destructive" role="status">{error}</p>}
    </section>
  );
}

function getSecurityNotices(
  user: UserManagementUser,
  status: AuthAdminUserMfaStatus | null,
): string[] {
  const notices: string[] = [];
  if (user.emailVerifiedAt === null && user.emailVerificationRequired) {
    notices.push('Email verification pending');
  }
  if (user.passwordChangeRequired) notices.push('Password setup required');

  if (status?.required || (!status && user.mfaRequired)) {
    const enrolled = status?.methods.some((method) => method.status === 'active') ?? false;
    if (!enrolled) notices.push('MFA enrollment required');
  }

  return notices;
}
