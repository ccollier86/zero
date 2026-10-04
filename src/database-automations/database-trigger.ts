/**
 * database-trigger.ts
 *
 * Defines immutable, SQLite-inspired AFTER trigger declarations and ordered
 * function references. It validates authoring input but does not inspect app
 * schemas, match mutations, or execute functions.
 */

import { AutomationError } from './automation-error';
import {
  type DatabaseFunctionDefinition,
} from './database-function';
import {
  automationDefinitionIdentity,
  normalizeAutomationColumn,
  normalizeAutomationName,
  normalizeAutomationTable,
  normalizeAutomationVersion,
  type VersionedAutomationReference,
} from './definition-identity';

export const DATABASE_TRIGGER_DEFINITION_KIND = Symbol.for(
  '@zero/framework/database-trigger-definition',
);

export type DatabaseTriggerOperation = 'insert' | 'update' | 'delete';

export interface DatabaseTriggerUpdateOptions {
  /** Match when at least one listed column changes. Omit to match every update. */
  readonly columns?: readonly string[];
}

/** Declarative AFTER events accepted by `defineDatabaseTrigger`. */
export interface DatabaseTriggerAfterInput {
  readonly insert?: boolean;
  readonly update?: boolean | DatabaseTriggerUpdateOptions;
  readonly delete?: boolean;
}

/** One normalized event in deterministic insert/update/delete order. */
export interface DatabaseTriggerAfterEvent {
  readonly operation: DatabaseTriggerOperation;
  /** Null means every UPDATE; insert and delete always carry null. */
  readonly columns: readonly string[] | null;
}

/** Handler-free reference resolved by the automation registry. */
export interface DatabaseFunctionReference extends VersionedAutomationReference {
  readonly identity: string;
}

export type DatabaseFunctionTarget =
  | DatabaseFunctionDefinition
  | VersionedAutomationReference;

export interface DatabaseTriggerOptions extends VersionedAutomationReference {
  readonly table: string;
  readonly after: DatabaseTriggerAfterInput;
  /** Ordered, non-empty function chain. Order is part of the manifest. */
  readonly run: DatabaseFunctionTarget | readonly DatabaseFunctionTarget[];
}

/** Immutable AFTER-trigger definition consumed by a validated registry. */
export interface DatabaseTriggerDefinition extends VersionedAutomationReference {
  readonly kind: 'database-trigger';
  readonly [DATABASE_TRIGGER_DEFINITION_KIND]: true;
  readonly identity: string;
  readonly table: string;
  readonly timing: 'after';
  readonly after: readonly DatabaseTriggerAfterEvent[];
  readonly run: readonly DatabaseFunctionReference[];
}

/** Define a versioned AFTER trigger with an ordered function chain. */
export function defineDatabaseTrigger(
  options: DatabaseTriggerOptions,
): DatabaseTriggerDefinition {
  const name = normalizeAutomationName(options.name, 'Database trigger name');
  const version = normalizeAutomationVersion(options.version, 'Database trigger version');
  const table = normalizeAutomationTable(options.table);
  const after = normalizeAfterEvents(options.after);
  const run = normalizeFunctionTargets(options.run);
  return Object.freeze({
    kind: 'database-trigger' as const,
    [DATABASE_TRIGGER_DEFINITION_KIND]: true as const,
    name,
    version,
    identity: automationDefinitionIdentity('trigger', { name, version }),
    table,
    timing: 'after' as const,
    after,
    run,
  });
}

/** Create a canonical handler-free reference for trigger composition. */
export function databaseFunctionReference(
  reference: VersionedAutomationReference,
): DatabaseFunctionReference {
  const name = normalizeAutomationName(reference.name, 'Database function reference name');
  const version = normalizeAutomationVersion(
    reference.version,
    'Database function reference version',
  );
  return Object.freeze({
    name,
    version,
    identity: automationDefinitionIdentity('function', { name, version }),
  });
}

/** Return true only for definitions created by `defineDatabaseTrigger`. */
export function isDatabaseTriggerDefinition(
  value: unknown,
): value is DatabaseTriggerDefinition {
  if (!value || typeof value !== 'object') return false;
  return (value as Record<PropertyKey, unknown>)[DATABASE_TRIGGER_DEFINITION_KIND] === true;
}

function normalizeAfterEvents(
  input: DatabaseTriggerAfterInput,
): readonly DatabaseTriggerAfterEvent[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return invalid('Database trigger after must be an event object.');
  }
  const events: DatabaseTriggerAfterEvent[] = [];
  if (input.insert === true) events.push(event('insert', null));
  if (input.insert !== undefined && input.insert !== true && input.insert !== false) {
    return invalid('Database trigger after.insert must be boolean.');
  }

  if (input.update === true) {
    events.push(event('update', null));
  } else if (input.update !== undefined && input.update !== false) {
    if (!input.update || typeof input.update !== 'object' || Array.isArray(input.update)) {
      return invalid('Database trigger after.update must be boolean or an options object.');
    }
    const columns = normalizeUpdateColumns(input.update.columns);
    events.push(event('update', columns));
  }

  if (input.delete === true) events.push(event('delete', null));
  if (input.delete !== undefined && input.delete !== true && input.delete !== false) {
    return invalid('Database trigger after.delete must be boolean.');
  }
  if (events.length === 0) {
    return invalid('Database trigger must enable at least one AFTER event.');
  }
  return Object.freeze(events);
}

function normalizeUpdateColumns(columns: readonly string[] | undefined): readonly string[] | null {
  if (columns === undefined) return null;
  if (!Array.isArray(columns) || columns.length === 0) {
    return invalid('Database trigger update columns must be a non-empty array.');
  }
  const normalized = columns.map(normalizeAutomationColumn);
  const unique = [...new Set(normalized)].sort(compareCanonicalText);
  if (unique.length !== normalized.length) {
    return invalid('Database trigger update columns must not contain duplicates.');
  }
  return Object.freeze(unique);
}

function normalizeFunctionTargets(
  input: DatabaseFunctionTarget | readonly DatabaseFunctionTarget[],
): readonly DatabaseFunctionReference[] {
  const targets = Array.isArray(input) ? input : [input];
  if (targets.length === 0) {
    return invalid('Database trigger run must contain at least one function.');
  }
  const references = targets.map((target) => databaseFunctionReference(target));
  const identities = new Set<string>();
  for (const reference of references) {
    if (identities.has(reference.identity)) {
      return invalid('Database trigger run must not contain duplicate function references.');
    }
    identities.add(reference.identity);
  }
  return Object.freeze(references);
}

function event(
  operation: DatabaseTriggerOperation,
  columns: readonly string[] | null,
): DatabaseTriggerAfterEvent {
  return Object.freeze({ operation, columns });
}

function invalid(message: string): never {
  throw new AutomationError('AUTOMATION_DEFINITION_INVALID', message);
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
