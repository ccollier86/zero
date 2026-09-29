/**
 * User-property schema normalization and policy-trust classification.
 */

import type {
  ResolvedUserPropertyFieldConfig,
  UserPropertyEditableBy,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
} from './types';
import {
  assertOnlyKeys,
  assertOptionalBoolean,
  assertOptionalString,
  assertPlainRecord,
} from './auth-config-validation';

const VALID_PROPERTY_TYPES = new Set<UserPropertyFieldType>([
  'string',
  'enum',
  'boolean',
  'number',
]);

const POLICY_TRUSTED_EDITORS = new Set<UserPropertyEditableBy>([
  'admin',
  'system',
  'none',
]);

const VALID_PROPERTY_EDITORS = new Set<UserPropertyEditableBy>([
  'user',
  'admin',
  'system',
  'none',
]);

export function normalizeAuthUserProperties(
  fields: Record<string, UserPropertyFieldConfig> = {},
): Record<string, ResolvedUserPropertyFieldConfig> {
  assertPlainRecord(fields, 'User properties config');
  const normalized: Record<string, ResolvedUserPropertyFieldConfig> = {};

  for (const [key, field] of Object.entries(fields)) {
    assertPlainRecord(field, `User property "${key}"`);
    assertOnlyKeys(field, [
      'type',
      'label',
      'values',
      'default',
      'editableBy',
      'useInPolicies',
      'description',
    ], `User property "${key}"`);
    assertOptionalString(field.label, `User property "${key}" label`);
    assertOptionalString(field.description, `User property "${key}" description`);
    assertOptionalBoolean(field.useInPolicies, `User property "${key}" useInPolicies`);
    if (field.values !== undefined && (!Array.isArray(field.values)
      || field.values.some((value) => typeof value !== 'string'))) {
      throw new Error(`[auth] User property "${key}" values must be an array of strings.`);
    }
    if (field.default !== undefined
      && typeof field.default !== 'string'
      && typeof field.default !== 'number'
      && typeof field.default !== 'boolean') {
      throw new Error(
        `[auth] User property "${key}" default must be a string, number, or boolean.`,
      );
    }
    const type = field.type ?? inferPropertyType(field);
    if (!VALID_PROPERTY_TYPES.has(type)) {
      throw new Error(`[auth] Unsupported user property type for "${key}": ${type}`);
    }

    if (type === 'enum' && (!field.values || field.values.length === 0)) {
      throw new Error(`[auth] Enum user property "${key}" must define values.`);
    }

    const editableBy = field.editableBy ?? 'user';
    if (!VALID_PROPERTY_EDITORS.has(editableBy)) {
      throw new Error(
        `[auth] Unsupported user property editor for "${key}": ${String(editableBy)}`,
      );
    }
    const useInPolicies = field.useInPolicies ?? false;
    if (useInPolicies && !POLICY_TRUSTED_EDITORS.has(editableBy)) {
      throw new Error(
        `[auth] User property "${key}" cannot set useInPolicies: true while editableBy is "${editableBy}".`,
      );
    }

    normalized[key] = {
      key,
      type,
      label: field.label,
      values: field.values,
      default: field.default === undefined ? undefined : String(field.default),
      editableBy,
      useInPolicies,
      description: field.description,
    };
  }

  return normalized;
}

/**
 * Return true when a resolved user property can be trusted by authorization
 * policy. Resource policy uses this instead of checking editability ad hoc.
 */
export function isPolicyTrustedAuthUserProperty(
  field: ResolvedUserPropertyFieldConfig,
): boolean {
  return field.useInPolicies && POLICY_TRUSTED_EDITORS.has(field.editableBy);
}

function inferPropertyType(field: UserPropertyFieldConfig): UserPropertyFieldType {
  if (field.values) return 'enum';
  if (typeof field.default === 'boolean') return 'boolean';
  if (typeof field.default === 'number') return 'number';
  return 'string';
}
