/**
 * database-realm-composition.ts
 *
 * Deterministically combines independently owned Fabric realm contributions.
 * It owns namespace collision detection and the outer contribution-manifest
 * fingerprint. Final schema/handler admission and the base realm fingerprint
 * remain centralized in defineDatabaseRealm().
 */

import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import type { Migration } from '../migrations/types';
import type { TableSchema } from '../sync/types';
import { DatabaseError } from './database-error';
import {
  defineDatabaseRealmContribution,
  type DatabaseRealmContribution,
  type DatabaseRealmContributionDefinition,
} from './database-realm-contribution';
import {
  defineDatabaseRealm,
  type DatabaseReadQueryHandler,
  type DatabaseRealm,
  type DatabaseWriteCommandHandler,
} from './database-realm';

const COMPOSITION_FIELDS = new Set(['name', 'version', 'contributions']);

/** Complete realm identity plus the ordered set of reusable fragments. */
export interface DatabaseRealmCompositionDefinition {
  /** Stable deployment-independent realm identity. */
  readonly name: string;
  /** Explicit application schema/behavior version. */
  readonly version: string;
  /** Contributions to merge. Their array order does not affect the result. */
  readonly contributions: readonly DatabaseRealmContributionDefinition[];
}

interface OwnedValue<T> {
  readonly contribution: string;
  readonly name: string;
  readonly value: T;
}

/**
 * Compose reusable fragments into one admitted, immutable Fabric realm.
 *
 * Registry ordering is canonicalized before final admission, so semantically
 * identical compositions produce the same catalogs and realm fingerprint even
 * when callers list contributions in a different order.
 */
export function composeDatabaseRealm(
  definition: DatabaseRealmCompositionDefinition,
): DatabaseRealm {
  const record = compositionRecord(definition);
  const contributions = contributionArray(record.contributions).map((entry) =>
    defineDatabaseRealmContribution(
      entry as DatabaseRealmContributionDefinition,
    ));
  assertUniqueContributionNames(contributions);

  const tables = new Map<string, OwnedValue<Readonly<TableSchema>>>();
  const migrations = new Map<string, OwnedValue<Readonly<Migration>>>();
  const queries = new Map<string, OwnedValue<DatabaseReadQueryHandler>>();
  const commands = new Map<string, OwnedValue<DatabaseWriteCommandHandler>>();

  for (const contribution of contributions) {
    mergeTables(tables, contribution);
    mergeMigrations(migrations, contribution);
    mergeHandlers(queries, commands, contribution);
  }

  const realm = defineDatabaseRealm({
    name: record.name as string,
    version: record.version as string,
    tables: sortedRegistry(tables),
    migrations: sortedValues(migrations),
    queries: sortedRegistry(queries),
    commands: sortedRegistry(commands),
  });
  return withCompositionFingerprint(realm, contributions);
}

function mergeTables(
  target: Map<string, OwnedValue<Readonly<TableSchema>>>,
  contribution: DatabaseRealmContribution,
): void {
  for (const [name, table] of Object.entries(contribution.tables)) {
    const key = name.toLowerCase();
    const existing = target.get(key);
    if (existing) {
      throw collision(
        'table',
        existing.name,
        name,
        contribution.name,
        existing.contribution,
        existing.name === name ? '' : ' ignoring case',
      );
    }
    target.set(key, { contribution: contribution.name, name, value: table });
  }
}

function mergeMigrations(
  target: Map<string, OwnedValue<Readonly<Migration>>>,
  contribution: DatabaseRealmContribution,
): void {
  for (const migration of contribution.migrations) {
    const existing = target.get(migration.version);
    if (existing) {
      throw collision(
        'migration',
        existing.name,
        migration.version,
        contribution.name,
        existing.contribution,
      );
    }
    target.set(migration.version, {
      contribution: contribution.name,
      name: migration.version,
      value: migration,
    });
  }
}

function mergeHandlers(
  queries: Map<string, OwnedValue<DatabaseReadQueryHandler>>,
  commands: Map<string, OwnedValue<DatabaseWriteCommandHandler>>,
  contribution: DatabaseRealmContribution,
): void {
  for (const [name, handler] of Object.entries(contribution.queries)) {
    const existingQuery = queries.get(name);
    if (existingQuery) {
      throw collision(
        'query',
        existingQuery.name,
        name,
        contribution.name,
        existingQuery.contribution,
      );
    }
    const existingCommand = commands.get(name);
    if (existingCommand) {
      throw handlerKindCollision(
        name,
        contribution.name,
        existingCommand.contribution,
      );
    }
    queries.set(name, { contribution: contribution.name, name, value: handler });
  }

  for (const [name, handler] of Object.entries(contribution.commands)) {
    const existingCommand = commands.get(name);
    if (existingCommand) {
      throw collision(
        'command',
        existingCommand.name,
        name,
        contribution.name,
        existingCommand.contribution,
      );
    }
    const existingQuery = queries.get(name);
    if (existingQuery) {
      throw handlerKindCollision(
        name,
        existingQuery.contribution,
        contribution.name,
      );
    }
    commands.set(name, { contribution: contribution.name, name, value: handler });
  }
}

function sortedRegistry<T>(
  values: ReadonlyMap<string, OwnedValue<T>>,
): Record<string, T> {
  const registry = Object.create(null) as Record<string, T>;
  for (const entry of [...values.values()].sort(compareOwnedNames)) {
    registry[entry.name] = entry.value;
  }
  return registry;
}

function sortedValues<T>(
  values: ReadonlyMap<string, OwnedValue<T>>,
): T[] {
  return [...values.values()].sort(compareOwnedNames).map((entry) => entry.value);
}

function compareOwnedNames<T>(left: OwnedValue<T>, right: OwnedValue<T>): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function collision(
  kind: 'table' | 'migration' | 'query' | 'command',
  existingName: string,
  incomingName: string,
  incoming: string,
  existing: string,
  qualifier = '',
): DatabaseError {
  const names = [...new Set([existingName, incomingName])].sort();
  const nameLabel = names.length === 1
    ? `"${names[0]}"`
    : `names "${names[0]}" and "${names[1]}"`;
  const contributions = [existing, incoming].sort();
  return configInvalid(
    `Database realm ${kind} ${nameLabel} collides${qualifier} between contributions `
    + `"${contributions[0]}" and "${contributions[1]}".`,
  );
}

function handlerKindCollision(
  name: string,
  queryContribution: string,
  commandContribution: string,
): DatabaseError {
  return configInvalid(
    `Database handler "${name}" collides between query contribution `
    + `"${queryContribution}" and command contribution `
    + `"${commandContribution}".`,
  );
}

function assertUniqueContributionNames(
  contributions: readonly DatabaseRealmContribution[],
): void {
  const seen = new Set<string>();
  for (const contribution of contributions) {
    if (seen.has(contribution.name)) {
      throw configInvalid(
        `Database realm contribution name "${contribution.name}" is duplicated.`,
      );
    }
    seen.add(contribution.name);
  }
}

function withCompositionFingerprint(
  realm: DatabaseRealm,
  contributions: readonly DatabaseRealmContribution[],
): DatabaseRealm {
  const manifest = contributions
    .map((contribution) => ({
      name: contribution.name,
      version: contribution.version,
    }))
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const fingerprint = `sha256:${createHash('sha256')
    .update('zero.database-realm-composition.v1\0', 'utf8')
    .update(realm.fingerprint, 'utf8')
    .update('\0', 'utf8')
    .update(JSON.stringify(manifest), 'utf8')
    .digest('hex')}`;
  return Object.freeze({ ...realm, fingerprint });
}

function compositionRecord(value: unknown): Record<string, unknown> {
  if (value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || isProxy(value)) {
    throw configInvalid('Database realm composition must be a plain object.');
  }

  let prototype: object | null;
  let keys: (string | symbol)[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw configInvalid('Database realm composition could not be inspected.', cause);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw configInvalid('Database realm composition must be a plain object.');
  }
  if (keys.some((key) => typeof key !== 'string')) {
    throw configInvalid('Database realm composition must not contain symbol fields.');
  }

  const record = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    if (!COMPOSITION_FIELDS.has(key)) {
      throw configInvalid('Database realm composition contains an unknown field.');
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      throw configInvalid('Database realm composition could not be inspected.', cause);
    }
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw configInvalid(
        'Database realm composition must use enumerable data properties.',
      );
    }
    record[key] = descriptor.value;
  }
  return record;
}

function contributionArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value)) {
    throw configInvalid('Database realm contributions must be an array.');
  }
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw configInvalid('Database realm contributions could not be inspected.', cause);
  }
  if (keys.length !== value.length + 1 || !keys.includes('length')) {
    throw configInvalid('Database realm contributions must be dense and unextended.');
  }
  const contributions: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch (cause) {
      throw configInvalid('Database realm contributions could not be inspected.', cause);
    }
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw configInvalid('Database realm contributions must contain data elements.');
    }
    contributions.push(descriptor.value);
  }
  return contributions;
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
