'use client';

/**
 * use-user-mfa-status.ts
 *
 * Loads public-safe MFA status for the selected admin-user row. Transport stays
 * in useAdminUsers; this hook owns selection-scoped loading and stale guards.
 */

import * as React from 'react';
import type { AuthAdminUserMfaStatus } from '../../../frontend/client/auth-client';
import type { UseAdminUsersResult, UserManagementUser } from './user-management-types';

/** Return MFA status for one selected user and ignore superseded responses. */
export function useUserMfaStatus(params: {
  user: UserManagementUser | null;
  enabled: boolean;
  revision: number;
  load: UseAdminUsersResult['getMfaStatus'];
}) {
  const [status, setStatus] = React.useState<AuthAdminUserMfaStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const userId = params.user?.userId ?? null;

  React.useEffect(() => {
    let current = true;
    setStatus(null);
    setError(null);
    if (!params.enabled || !userId) {
      setLoading(false);
      return () => { current = false; };
    }

    setLoading(true);
    void params.load(userId).then(
      (next) => { if (current) setStatus(next); },
      (reason) => {
        if (current) setError(reason instanceof Error ? reason.message : 'MFA status unavailable');
      },
    ).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [params.enabled, params.load, params.revision, userId]);

  return { status, loading, error };
}
