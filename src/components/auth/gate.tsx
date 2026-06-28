'use client';

/**
 * gate.tsx
 *
 * Auth UI gate components and hooks. This file owns client-side visibility
 * decisions based on the current auth user; it does not enforce backend
 * authorization or fetch user data directly.
 */

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

export type PropertyGateValue = string | number | boolean;

export interface PropertyGateProps {
  /** Current user's property key to inspect. */
  propertyKey: string;
  /** Allowed property value or values. Compared against stored string values. */
  allow: PropertyGateValue | PropertyGateValue[];
  /** Content shown when access is denied. Defaults to nothing. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export interface HasFlagProps {
  /** Current user's boolean-like property key to inspect. */
  propertyKey: string;
  /** Required boolean value. Defaults to true. */
  value?: boolean;
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

/**
 * Returns true when the current user's stored property matches an allowed value.
 *
 * Property gates are UI convenience checks only. Sensitive routes and data
 * access still need backend authorization.
 */
export function usePropertyGate(
  propertyKey: string,
  allow: PropertyGateValue | PropertyGateValue[]
): boolean {
  const user = useCurrentUser();
  if (!user) return false;

  const actual = user.properties[propertyKey];
  if (actual === undefined) return false;

  const allowed = Array.isArray(allow) ? allow : [allow];
  return allowed.some((value) => actual === serializeGateValue(value));
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

/**
 * Conditionally renders children based on a current-user property value.
 *
 * ```tsx
 * <PropertyGate propertyKey="department" allow={['accounting', 'management']}>
 *   <DepartmentTools />
 * </PropertyGate>
 * ```
 */
function PropertyGate({ propertyKey, allow, fallback = null, children }: PropertyGateProps) {
  const authorized = usePropertyGate(propertyKey, allow);
  return <>{authorized ? children : fallback}</>;
}

/**
 * Alias for PropertyGate when the property represents a specific value.
 */
function HasProperty(props: PropertyGateProps) {
  return <PropertyGate {...props} />;
}

/**
 * Convenience gate for boolean-like user properties stored as `true`/`false`.
 */
function HasFlag({ propertyKey, value = true, fallback = null, children }: HasFlagProps) {
  return (
    <PropertyGate propertyKey={propertyKey} allow={value} fallback={fallback}>
      {children}
    </PropertyGate>
  );
}

function serializeGateValue(value: PropertyGateValue): string {
  return String(value);
}

export { Gate, PropertyGate, HasProperty, HasFlag };
