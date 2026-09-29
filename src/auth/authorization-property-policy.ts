import type {
  TrustedPropertyRequirement,
  TrustedPropertyScalar,
} from './authorization-policy-types';
import {
  assertNonEmptyAuthorizationString,
  authorizationConfigError,
  compareAuthorizationKeys,
  isPlainAuthorizationRecord,
} from './authorization-kernel-utils';

const PROPERTY_FIELDS = new Set(['equals', 'in', 'not', 'exists']);

/** Validate and normalize one declarative trusted-property constraint group. */
export function normalizeTrustedPropertyGroup(
  properties: Readonly<Record<string, TrustedPropertyRequirement>>,
  trustedProperties: readonly string[] | undefined,
): Record<string, TrustedPropertyRequirement> {
  if (!isPlainAuthorizationRecord(properties)) {
    throw authorizationConfigError('Access requirement properties must be an object.');
  }
  const trusted = trustedProperties === undefined ? undefined : new Set(trustedProperties);
  const normalized: Record<string, TrustedPropertyRequirement> = {};
  for (const [key, requirement] of Object.entries(properties).sort(
    ([a], [b]) => compareAuthorizationKeys(a, b),
  )) {
    assertNonEmptyAuthorizationString(key, 'Trusted property key');
    if (trusted && !trusted.has(key)) {
      throw authorizationConfigError(
        `Access requirement property "${key}" is not policy-trusted.`,
      );
    }
    normalized[key] = normalizeTrustedPropertyRequirement(requirement, key);
  }
  return normalized;
}

/** Clone and freeze a validated matcher before retaining compiled policy. */
export function cloneTrustedPropertyRequirement(
  requirement: TrustedPropertyRequirement,
): TrustedPropertyRequirement {
  if (isPropertyScalar(requirement)) return requirement;
  if (isPropertyScalarArray(requirement)) return Object.freeze([...requirement]);
  return Object.freeze({
    ...(requirement.equals !== undefined ? { equals: requirement.equals } : {}),
    ...(requirement.in !== undefined ? { in: Object.freeze([...requirement.in]) } : {}),
    ...(requirement.not !== undefined
      ? {
          not: isPropertyScalarArray(requirement.not)
            ? Object.freeze([...requirement.not])
            : requirement.not,
        }
      : {}),
    ...(requirement.exists !== undefined ? { exists: requirement.exists } : {}),
  });
}

/** Evaluate every inherited trusted-property group conjunctively. */
export function matchesTrustedPropertyGroups(
  properties: Readonly<Record<string, string>>,
  groups: readonly Readonly<Record<string, TrustedPropertyRequirement>>[],
): boolean {
  return groups.every((group) => Object.entries(group).every(
    ([key, requirement]) => matchesTrustedPropertyRequirement(
      properties[key] ?? null,
      requirement,
    ),
  ));
}

function normalizeTrustedPropertyRequirement(
  value: unknown,
  key: string,
): TrustedPropertyRequirement {
  if (isPropertyScalar(value)) return value;
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every(isPropertyScalar)) {
      throw authorizationConfigError(
        `Access requirement property "${key}" has an invalid value list.`,
      );
    }
    return Object.freeze([...value]);
  }
  if (!isPlainAuthorizationRecord(value)) {
    throw authorizationConfigError(
      `Access requirement property "${key}" has an invalid matcher.`,
    );
  }
  const unknown = Object.keys(value)
    .filter((field) => !PROPERTY_FIELDS.has(field))
    .sort(compareAuthorizationKeys)[0];
  if (unknown) {
    throw authorizationConfigError(
      `Access requirement property "${key}" has unsupported field "${unknown}".`,
    );
  }
  if (Object.keys(value).length === 0) {
    throw authorizationConfigError(
      `Access requirement property "${key}" matcher may not be empty.`,
    );
  }
  if (value.exists !== undefined && typeof value.exists !== 'boolean') {
    throw authorizationConfigError(
      `Access requirement property "${key}" exists must be a boolean.`,
    );
  }
  if (value.equals !== undefined && !isPropertyScalar(value.equals)) {
    throw authorizationConfigError(
      `Access requirement property "${key}" equals must be a scalar.`,
    );
  }
  if (value.in !== undefined && (
    !Array.isArray(value.in)
    || value.in.length === 0
    || !value.in.every(isPropertyScalar)
  )) {
    throw authorizationConfigError(
      `Access requirement property "${key}" in must be a non-empty scalar array.`,
    );
  }
  if (value.not !== undefined
    && !isPropertyScalar(value.not)
    && !(
      Array.isArray(value.not)
      && value.not.length > 0
      && value.not.every(isPropertyScalar)
    )) {
    throw authorizationConfigError(
      `Access requirement property "${key}" not must be a scalar or scalar array.`,
    );
  }
  return Object.freeze({
    ...(value.equals !== undefined ? { equals: value.equals } : {}),
    ...(value.in !== undefined ? { in: Object.freeze([...value.in]) } : {}),
    ...(value.not !== undefined
      ? { not: Array.isArray(value.not) ? Object.freeze([...value.not]) : value.not }
      : {}),
    ...(value.exists !== undefined ? { exists: value.exists } : {}),
  });
}

function matchesTrustedPropertyRequirement(
  value: string | null,
  requirement: TrustedPropertyRequirement,
): boolean {
  if (isPropertyScalarArray(requirement)) {
    return value !== null && requirement.map(String).includes(value);
  }
  if (isPropertyScalar(requirement)) return value === String(requirement);
  if (requirement.exists !== undefined && (value !== null) !== requirement.exists) return false;
  if (requirement.equals !== undefined && value !== String(requirement.equals)) return false;
  if (requirement.in !== undefined && (
    value === null || !requirement.in.map(String).includes(value)
  )) return false;
  if (requirement.not !== undefined) {
    const deniedValues = Array.isArray(requirement.not)
      ? requirement.not.map(String)
      : [String(requirement.not)];
    if (value !== null && deniedValues.includes(value)) return false;
  }
  return true;
}

function isPropertyScalar(value: unknown): value is TrustedPropertyScalar {
  return typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean';
}

function isPropertyScalarArray(value: unknown): value is readonly TrustedPropertyScalar[] {
  return Array.isArray(value) && value.every(isPropertyScalar);
}
