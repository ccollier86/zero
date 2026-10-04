/**
 * database-realm-automation-admission.ts
 *
 * Admits actor-local ReactiveDB automation registries into a Fabric realm.
 * This module owns canonical composition and schema-backed validation only; it
 * does not execute handlers, install runtimes, persist effects, or cross IPC.
 */

import { types as utilTypes } from 'node:util';
import {
  DatabaseAutomationRegistry,
  defineDatabaseAutomations,
} from '../database-automations/database-automations';
import {
  isAutomationError,
  type AutomationErrorCode,
} from '../database-automations/automation-error';
import type { DatabaseFunctionDefinition } from '../database-automations/database-function';
import type { DatabaseTriggerDefinition } from '../database-automations/database-trigger';
import type { TableSchema } from '../sync/types';
import { DatabaseError } from './database-error';

/** One registry owned by a named realm contribution. */
export interface OwnedDatabaseAutomationRegistry {
  readonly contribution: string;
  readonly registry: DatabaseAutomationRegistry;
}

/**
 * Validate and canonically detach an optional realm automation registry.
 *
 * Trigger tables and UPDATE-column filters are checked against the final
 * admitted table registry. Function and trigger handlers remain actor-local.
 */
export function admitDatabaseRealmAutomations(
  value: unknown,
  tables: Readonly<Record<string, Readonly<TableSchema>>>,
): DatabaseAutomationRegistry | undefined {
  if (value === undefined) return undefined;
  const registry = requireDatabaseAutomationRegistry(value);
  return composeAndValidate([registry], tables);
}

/**
 * Compose contribution-owned registries in a deterministic order, then
 * validate them against the complete realm schema.
 */
export function composeDatabaseRealmAutomations(
  values: readonly OwnedDatabaseAutomationRegistry[],
  tables: Readonly<Record<string, Readonly<TableSchema>>>,
): DatabaseAutomationRegistry | undefined {
  if (values.length === 0) return undefined;
  const registries = [...values]
    .sort((left, right) => compareText(left.contribution, right.contribution))
    .map(({ registry }) => requireDatabaseAutomationRegistry(registry));
  return composeAndValidate(registries, tables);
}

/** Require a genuine, non-proxied registry created by this package instance. */
export function requireDatabaseAutomationRegistry(
  value: unknown,
): DatabaseAutomationRegistry {
  if (!isExactRegistry(value)) {
    throw configInvalid(
      'Database realm automations must be a DatabaseAutomationRegistry.',
    );
  }
  return value;
}

function composeAndValidate(
  registries: readonly DatabaseAutomationRegistry[],
  tables: Readonly<Record<string, Readonly<TableSchema>>>,
): DatabaseAutomationRegistry {
  const functions: DatabaseFunctionDefinition[] = [];
  const triggers: DatabaseTriggerDefinition[] = [];
  for (const registry of registries) {
    functions.push(...registry.listFunctions());
    triggers.push(...registry.listTriggers());
  }

  // Definition order is not part of the handler-free manifest. Canonicalize
  // execution order here as well so equal fingerprints cannot hide different
  // trigger ordering across parent and actor processes.
  functions.sort(compareIdentity);
  triggers.sort(compareIdentity);

  try {
    return defineDatabaseAutomations({
      functions,
      triggers,
      validation: {
        tableExists: (table) => Object.prototype.hasOwnProperty.call(tables, table),
        tableColumns: (table) => {
          const schema = tables[table];
          if (!schema) return undefined;
          return Object.keys(schema).filter((column) => column !== '_identity');
        },
      },
    });
  } catch (cause) {
    throw mapAutomationAdmissionFailure(cause);
  }
}

function isExactRegistry(value: unknown): value is DatabaseAutomationRegistry {
  if (value === null || typeof value !== 'object') return false;
  try {
    return !utilTypes.isProxy(value)
      && value instanceof DatabaseAutomationRegistry
      && Object.getPrototypeOf(value) === DatabaseAutomationRegistry.prototype;
  } catch {
    return false;
  }
}

function compareIdentity(
  left: { readonly identity: string },
  right: { readonly identity: string },
): number {
  return compareText(left.identity, right.identity);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mapAutomationAdmissionFailure(cause: unknown): DatabaseError {
  if (!isAutomationError(cause)) {
    return configInvalid('Database realm automation registry is invalid.', cause);
  }
  return configInvalid(messageForAutomationCode(cause.code), cause);
}

function messageForAutomationCode(code: AutomationErrorCode): string {
  switch (code) {
    case 'AUTOMATION_TABLE_MISSING':
      return 'Database realm automation trigger targets a table outside the admitted realm.';
    case 'AUTOMATION_TABLE_INVALID':
      return 'Database realm automation trigger references an invalid admitted table column.';
    case 'AUTOMATION_FUNCTION_DUPLICATE':
      return 'Database realm automation function identities must be unique.';
    case 'AUTOMATION_TRIGGER_DUPLICATE':
      return 'Database realm automation trigger identities must be unique.';
    case 'AUTOMATION_TARGET_MISSING':
      return 'Database realm automation trigger targets an unregistered function.';
    case 'AUTOMATION_DEFINITION_INVALID':
      return 'Database realm automation definition is invalid.';
  }
}

function configInvalid(message: string, cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    message,
    cause === undefined ? undefined : { cause },
  );
}
