'use client';

/**
 * user-management-readiness.tsx
 *
 * Surfaces only actionable auth-readiness problems. Normal disabled, optional,
 * and ready states stay out of the primary user-management workflow.
 */

import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import { Badge } from '../../ui/badge';

/** Render compact warnings for auth capabilities that are configured but not ready. */
export function UserManagementReadiness({
  config,
  loading,
}: {
  config: AuthAdminConfig | null;
  loading: boolean;
}) {
  if (!config) {
    return loading ? (
      <p className="text-xs text-muted-foreground" aria-live="polite">Loading auth readiness…</p>
    ) : null;
  }

  const warnings = getAuthReadinessWarnings(config);
  if (warnings.length === 0) return null;

  return (
    <section
      aria-label="Auth readiness warnings"
      className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2"
    >
      <span className="text-xs font-medium text-warning-foreground dark:text-warning">Auth setup</span>
      {warnings.map((warning) => (
        <Badge key={warning} variant="warning">
          {warning}
        </Badge>
      ))}
    </section>
  );
}

export function getAuthReadinessWarnings(config: AuthAdminConfig): string[] {
  const warnings: string[] = [];
  const usesEmailLinks = config.capabilities.setupEmail
    || config.capabilities.passwordResetEmail
    || config.capabilities.emailVerification;

  if (config.email.enabled && usesEmailLinks && !config.email.hasPublicUrl) {
    warnings.push('Email actions need a public URL');
  }
  if (config.account.requireEmailVerification && !config.account.emailVerificationReady) {
    warnings.push('Email verification is not ready');
  }
  if (config.mfa?.enabled && !config.mfa.ready) {
    warnings.push('MFA is enabled but not ready');
  }

  return warnings;
}
