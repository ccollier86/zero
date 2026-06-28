'use client';

import * as React from 'react';
import { useCurrentUser } from '../../frontend/client/hooks';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GateProps {
  /** Role(s) that are allowed to see the children. */
  allow: string | string[];
  /** Content shown when access is denied. Defaults to nothing. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the current user has one of the specified roles.
 * Returns false if not authenticated or role doesn't match.
 */
export function useGate(allow: string | string[]): boolean {
  const user = useCurrentUser();
  if (!user) return false;
  const roles = Array.isArray(allow) ? allow : [allow];
  return roles.includes(user.role);
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Conditionally renders children based on the current user's role.
 *
 * ```tsx
 * <Gate allow={['admin', 'provider']}>
 *   <DangerZone />
 * </Gate>
 * ```
 */
function Gate({ allow, fallback = null, children }: GateProps) {
  const authorized = useGate(allow);
  return <>{authorized ? children : fallback}</>;
}

export { Gate };
