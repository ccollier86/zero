/**
 * database-realm-contribution.ts
 *
 * Defines one reusable, side-effect-free fragment of a Fabric database realm.
 * Contributions are detached through the same admission boundary as complete
 * realms so plugins cannot weaken schema, migration, or handler validation.
 */

import { types as utilTypes } from 'node:util';
import type { DatabaseAutomationRegistry } from '../database-automations/database-automations';
import type { Migration } from '../migrations/types';
import type { TableSchema } from '../sync/types';
import { DatabaseError } from './database-error';
import { requireDatabaseAutomationRegistry } from './database-realm-automation-admission';
import {
  defineDatabaseRealm,
  type DatabaseReadQueryRegistry,
  type DatabaseRealm,
  type DatabaseWriteCommandRegistry,
} from './database-realm';

const CONTRIBUTION_FIELDS = new Set([
  'name',
  'version',
  'tables',
  'migrations',
  'queries',
  'commands',
  'automations',
]);

/** Caller-owned definition for one independently reusable realm fragment. */
export interface DatabaseRealmContributionDefinition<
  TQueries extends DatabaseReadQueryRegistry = DatabaseReadQueryRegistry,
  TCommands extends DatabaseWriteCommandRegistry = DatabaseWriteCommandRegistry,
> {
  /** Stable diagnostic identity for collision reporting. */
  readonly name: string;
  /**
   * Version of this fragment's schema and handler behavior. Bump it whenever
   * a handler or mutation validator changes behavior without changing names.
   */
  readonly version: string;
  /** ReactiveDB tables supplied by this fragment. */
  readonly tables?: Readonly<Record<string, TableSchema>>;
  /**
   * Independently ordered migrations supplied by this fragment. Versions must
   * also remain globally unique once every contribution is composed.
   */
  readonly migrations?: readonly Migration[];
  /** Actor-local registered read handlers supplied by this fragment. */
  readonly queries?: TQueries;
  /** Actor-local registered write handlers supplied by this fragment. */
  readonly commands?: TCommands;
  /** Actor-local functions and triggers supplied by this fragment. */
  readonly automations?: DatabaseAutomationRegistry;
}

/** Detached, immutable contribution safe to reuse in multiple compositions. */
export interface DatabaseRealmContribution<
  TQueries extends DatabaseReadQueryRegistry = DatabaseReadQueryRegistry,
  TCommands extends DatabaseWriteCommandRegistry = DatabaseWriteCommandRegistry,
> {
  readonly name: string;
  readonly version: string;
  readonly tables: Readonly<Record<string, Readonly<TableSchema>>>;
  readonly migrations: readonly Readonly<Migration>[];
  readonly queries: Readonly<TQueries>;
  readonly commands: Readonly<TCommands>;
  readonly automations?: DatabaseAutomationRegistry;
}

/**
 * Validate and detach one reusable realm contribution.
 *
 * Complete realm composition validates the merged registry again. This first
 * pass prevents a reusable plugin fragment from retaining mutable caller data
 * and keeps Guardian reference metadata attached to its table declarations.
 */
export function defineDatabaseRealmContribution<
  TQueries extends DatabaseReadQueryRegistry = DatabaseReadQueryRegistry,
  TCommands extends DatabaseWriteCommandRegistry = DatabaseWriteCommandRegistry,
>(
  definition: DatabaseRealmContributionDefinition<TQueries, TCommands>,
): DatabaseRealmContribution<TQueries, TCommands> {
  const record = contributionRecord(definition);
  const realm = defineDatabaseRealm<TQueries, TCommands>({
    name: record.name as string,
    version: record.version as string,
    tables: (record.tables ?? {}) as Readonly<Record<string, TableSchema>>,
    migrations: record.migrations as readonly Migration[] | undefined,
    queries: record.queries as TQueries | undefined,
    commands: record.commands as TCommands | undefined,
  });
  // Trigger targets can intentionally refer to tables owned by another
  // contribution. Full schema-backed admission therefore occurs only after
  // composition has merged every table.
  const automations = record.automations === undefined
    ? undefined
    : requireDatabaseAutomationRegistry(record.automations);

  return Object.freeze({
    name: realm.name,
    version: realm.version,
    tables: realm.tables,
    migrations: realm.migrations,
    queries: realm.queries,
    commands: realm.commands,
    ...(automations === undefined ? {} : { automations }),
  });
}

/**
 * Adapt an existing admitted realm into a reusable contribution.
 *
 * The realm's stable name becomes the contribution identity used in collision
 * diagnostics. This lets an existing application realm remain unchanged while
 * plugins are introduced through composeDatabaseRealm().
 */
export function databaseRealmContribution<
  TQueries extends DatabaseReadQueryRegistry = DatabaseReadQueryRegistry,
  TCommands extends DatabaseWriteCommandRegistry = DatabaseWriteCommandRegistry,
>(
  realm: DatabaseRealm<TQueries, TCommands>,
): DatabaseRealmContribution<TQueries, TCommands> {
  return defineDatabaseRealmContribution<TQueries, TCommands>({
    name: realm.name,
    version: realm.version,
    tables: realm.tables,
    migrations: realm.migrations,
    queries: realm.queries,
    commands: realm.commands,
    automations: realm.automations,
  });
}

function contributionRecord(value: unknown): Record<string, unknown> {
  if (value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || isProxy(value)) {
    throw configInvalid('Database realm contribution must be a plain object.');
  }

  let prototype: object | null;
  let keys: (string | symbol)[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw configInvalid('Database realm contribution could not be inspected.', cause);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw configInvalid('Database realm contribution must be a plain object.');
  }
  if (keys.some((key) => typeof key !== 'string')) {
    throw configInvalid('Database realm contribution must not contain symbol fields.');
  }

  const record = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    if (!CONTRIBUTION_FIELDS.has(key)) {
      throw configInvalid('Database realm contribution contains an unknown field.');
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      throw configInvalid('Database realm contribution could not be inspected.', cause);
    }
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw configInvalid(
        'Database realm contribution must use enumerable data properties.',
      );
    }
    record[key] = descriptor.value;
  }
  return record;
}

function isProxy(value: object): boolean {
  try {
    return utilTypes.isProxy(value);
  } catch {
    return true;
  }
}

function configInvalid(message: string, cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    message,
    cause === undefined ? undefined : { cause },
  );
}
