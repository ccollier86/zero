/**
 * user-property-service.ts
 *
 * Owns configured user key/value property validation and default application.
 * This service is framework-independent; HTTP routes pass concrete user ids,
 * actors, and values, while persistence remains behind a small store contract.
 */

import { AuthError, type ResolvedAuthBehaviorConfig } from './types';

/** Actor attempting to mutate a user property through platform routes. */
export type UserPropertyActor = 'user' | 'admin' | 'system';

/** Minimal persistence contract required by UserPropertyService. */
export interface UserPropertyStore {
  getProperty(userId: string, key: string): string | null;
  setProperty(userId: string, key: string, value: string): void;
  deleteProperty(userId: string, key: string): void;
}

/**
 * Validates and serializes configured user KV properties.
 *
 * Unknown keys are allowed by default for backward compatibility. Configured
 * keys receive type validation and actor-based write protection.
 */
export class UserPropertyService {
  constructor(private readonly config: ResolvedAuthBehaviorConfig) {}

  /**
   * Return configured default properties as serialized string values.
   */
  getDefaultProperties(): Record<string, string> {
    const defaults: Record<string, string> = {};

    for (const [key, field] of Object.entries(this.config.userProperties)) {
      if (field.default !== undefined) defaults[key] = field.default;
    }

    return defaults;
  }

  /**
   * Validate a single property write and return its serialized storage value.
   *
   * Throws AuthError for unknown keys in strict mode, unsupported values, or
   * actor attempts to edit fields outside their configured authority.
   */
  validateWrite(key: string, value: unknown, actor: UserPropertyActor): string {
    const field = this.config.userProperties[key];

    if (!field) {
      if (this.config.strictUserProperties) {
        throw new AuthError('Unknown user property', 'UNKNOWN_PROPERTY', 400);
      }
      return serializeUnknownProperty(value);
    }

    this.assertEditable(key, actor);

    switch (field.type) {
      case 'enum': {
        const serialized = String(value);
        if (!field.values?.includes(serialized)) {
          throw new AuthError('Invalid property value', 'INVALID_PROPERTY_VALUE', 400);
        }
        return serialized;
      }
      case 'boolean':
        return serializeBooleanProperty(value);
      case 'number':
        return serializeNumberProperty(value);
      case 'string':
        return String(value);
    }
  }

  /**
   * Validate multiple property writes for one actor.
   */
  validateWrites(
    properties: Record<string, unknown> | undefined,
    actor: UserPropertyActor
  ): Record<string, string> {
    const validated: Record<string, string> = {};
    for (const [key, value] of Object.entries(properties ?? {})) {
      validated[key] = this.validateWrite(key, value, actor);
    }
    return validated;
  }

  /**
   * Apply configured default properties if they are missing for the user.
   *
   * Existing values are never overwritten. Returns the values that were set.
   */
  applyMissingDefaults(userId: string, store: UserPropertyStore): Record<string, string> {
    const applied: Record<string, string> = {};

    for (const [key, value] of Object.entries(this.getDefaultProperties())) {
      if (store.getProperty(userId, key) !== null) continue;
      store.setProperty(userId, key, value);
      applied[key] = value;
    }

    return applied;
  }

  /**
   * Delete a property when the actor is allowed to mutate the configured key.
   */
  deleteProperty(userId: string, key: string, actor: UserPropertyActor, store: UserPropertyStore): void {
    const field = this.config.userProperties[key];
    if (!field && this.config.strictUserProperties) {
      throw new AuthError('Unknown user property', 'UNKNOWN_PROPERTY', 400);
    }
    if (field) this.assertEditable(key, actor);
    store.deleteProperty(userId, key);
  }

  private assertEditable(key: string, actor: UserPropertyActor): void {
    const field = this.config.userProperties[key];
    if (!field) return;
    if (actor === 'system') return;
    if (actor === 'admin' && (field.editableBy === 'admin' || field.editableBy === 'user')) return;
    if (actor === 'user' && field.editableBy === 'user') return;

    throw new AuthError('Property is not editable by this actor', 'PROPERTY_FORBIDDEN', 403);
  }
}

function serializeUnknownProperty(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? String(value);
}

function serializeBooleanProperty(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === 'true' || value === 'false') return value;
  throw new AuthError('Boolean property value must be true or false', 'INVALID_PROPERTY_VALUE', 400);
}

function serializeNumberProperty(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new AuthError('Number property value must be finite', 'INVALID_PROPERTY_VALUE', 400);
  }
  return String(numeric);
}
