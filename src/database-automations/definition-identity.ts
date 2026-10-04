/**
 * definition-identity.ts
 *
 * Owns stable names, versions, and identities for database automation
 * definitions. It does not register definitions or inspect application tables.
 */

import { AutomationError } from './automation-error';

const AUTOMATION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const MAX_AUTOMATION_NAME_LENGTH = 128;
const MAX_TABLE_NAME_LENGTH = 128;

export interface VersionedAutomationReference {
  readonly name: string;
  readonly version: number;
}

/** Normalize a durable definition name used in manifests and persisted work. */
export function normalizeAutomationName(value: string, label: string): string {
  if (typeof value !== 'string') return invalid(`${label} must be a string.`);
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_AUTOMATION_NAME_LENGTH
    || !AUTOMATION_NAME_PATTERN.test(normalized)
  ) {
    return invalid(
      `${label} must use lowercase letters, digits, dots, underscores, or hyphens.`,
    );
  }
  return normalized;
}

/** Normalize a positive safe-integer definition version. */
export function normalizeAutomationVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    return invalid(`${label} must be a positive safe integer.`);
  }
  return value;
}

/** Normalize an exact application table key without imposing SQL syntax. */
export function normalizeAutomationTable(value: string): string {
  if (typeof value !== 'string') return invalid('Automation table must be a string.');
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_TABLE_NAME_LENGTH
    || /[\0-\x1f\x7f]/u.test(normalized)
  ) {
    return invalid('Automation table must be a non-empty, bounded table key.');
  }
  return normalized;
}

/** Normalize an exact column key used by an UPDATE-column match. */
export function normalizeAutomationColumn(value: string): string {
  if (typeof value !== 'string') return invalid('Automation column must be a string.');
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_TABLE_NAME_LENGTH
    || /[\0-\x1f\x7f]/u.test(normalized)
  ) {
    return invalid('Automation column must be a non-empty, bounded column key.');
  }
  return normalized;
}

/** Build an unambiguous stable identity for one versioned definition. */
export function automationDefinitionIdentity(
  kind: 'function' | 'trigger',
  reference: VersionedAutomationReference,
): string {
  return `${kind}:${reference.name}@${reference.version}`;
}

function invalid(message: string): never {
  throw new AutomationError('AUTOMATION_DEFINITION_INVALID', message);
}
