/**
 * user-management-property-editor.ts
 *
 * Owns pure data helpers for the admin user property editor. This file does
 * not render UI or call the SDK; the form uses it to build safe property
 * upsert/delete mutations.
 */

import type { AuthAdminConfig } from '../../../frontend/client/auth-client';

export interface UserManagementCustomPropertyRow {
  id: string;
  key: string;
  value: string;
}

export interface UserManagementPropertyMutationPlan {
  properties: Record<string, unknown>;
  deleteKeys: string[];
}

/** Return true when admins may add unconfigured user property keys. */
export function canEditCustomUserProperties(config: AuthAdminConfig | null): boolean {
  return Boolean(config?.capabilities.userProperties) && config?.strictUserProperties === false;
}

/** Build editable rows for properties not declared in auth.userProperties. */
export function createCustomPropertyRows(
  config: AuthAdminConfig | null,
  properties: Record<string, string>,
): UserManagementCustomPropertyRow[] {
  const configuredKeys = getConfiguredPropertyKeys(config);

  return Object.entries(properties)
    .filter(([key]) => !configuredKeys.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      id: `existing:${key}`,
      key,
      value,
    }));
}

/**
 * Build admin property upserts and deletions from configured values and custom
 * rows. Throws when custom rows are duplicated or collide with configured keys.
 */
export function buildPropertyMutationPlan(params: {
  config: AuthAdminConfig | null;
  originalProperties: Record<string, string>;
  configuredValues: Record<string, unknown>;
  customRows: readonly UserManagementCustomPropertyRow[];
}): UserManagementPropertyMutationPlan {
  const configuredKeys = getConfiguredPropertyKeys(params.config);
  const originalCustomKeys = new Set(
    Object.keys(params.originalProperties).filter((key) => !configuredKeys.has(key)),
  );
  const properties: Record<string, unknown> = { ...params.configuredValues };
  const nextCustomKeys = new Set<string>();

  for (const row of params.customRows) {
    const key = row.key.trim();
    const value = row.value;
    if (!key && !value.trim()) continue;
    if (!key) throw new Error('Property key is required.');
    if (configuredKeys.has(key)) {
      throw new Error(`"${key}" is already managed by the configured property fields.`);
    }
    if (nextCustomKeys.has(key)) {
      throw new Error(`"${key}" is listed more than once.`);
    }

    nextCustomKeys.add(key);
    properties[key] = value;
  }

  const deleteKeys = [...originalCustomKeys].filter((key) => !nextCustomKeys.has(key));

  return { properties, deleteKeys };
}

/** Return configured property keys for collision and custom-key filtering. */
export function getConfiguredPropertyKeys(config: AuthAdminConfig | null): Set<string> {
  return new Set(Object.keys(config?.userProperties ?? {}));
}
