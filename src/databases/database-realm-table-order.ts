/** Deterministic foreign-key dependency ordering for every admitted realm. */

import type { TableSchema } from '../sync/types';
import { DatabaseError } from './database-error';

export interface DatabaseRealmTableEntry<T = Readonly<TableSchema>> {
  readonly name: string;
  readonly value: T;
}

/**
 * Order realm tables so every in-realm foreign-key parent is created before
 * its dependants. Lexical ordering breaks ties and keeps composition stable.
 * References outside the declared realm are external dependencies (including
 * Guardian anchors and migration-created support tables), so runtime schema
 * verification remains their authority and they do not affect this ordering.
 */
export function orderDatabaseRealmTables<T extends Readonly<TableSchema>>(
  input: readonly DatabaseRealmTableEntry<T>[],
): readonly DatabaseRealmTableEntry<T>[] {
  const entries = [...input].sort(compareEntries);
  const byName = new Map(entries.map((entry) => [foldName(entry.name), entry]));
  const dependencies = new Map<string, Set<string>>();
  const dependants = new Map<string, Set<string>>();

  for (const entry of entries) {
    const entryName = foldName(entry.name);
    const entryDependencies = new Set<string>();
    for (const [field, definition] of Object.entries(entry.value)) {
      if (field === '_identity' || typeof definition !== 'string') continue;
      for (const referencedName of readReferencedTables(definition)) {
        const referenced = byName.get(foldName(referencedName));
        if (!referenced) continue;
        const dependencyName = foldName(referenced.name);
        if (dependencyName === entryName) continue;
        entryDependencies.add(dependencyName);
        const reverse = dependants.get(dependencyName) ?? new Set<string>();
        reverse.add(entryName);
        dependants.set(dependencyName, reverse);
      }
    }
    dependencies.set(entryName, entryDependencies);
  }

  const ready = entries
    .filter((entry) => dependencies.get(foldName(entry.name))?.size === 0)
    .sort(compareEntries);
  const ordered: DatabaseRealmTableEntry<T>[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(current);
    for (const dependantName of dependants.get(foldName(current.name)) ?? []) {
      const remaining = dependencies.get(dependantName)!;
      remaining.delete(foldName(current.name));
      if (remaining.size !== 0) continue;
      const dependant = byName.get(dependantName)!;
      insertSorted(ready, dependant);
    }
  }

  if (ordered.length !== entries.length) {
    const cycle = entries
      .filter((entry) => (dependencies.get(foldName(entry.name))?.size ?? 0) > 0)
      .map((entry) => `"${entry.name}"`)
      .join(', ');
    throw configInvalid(
      `Database realm foreign-key cycle is not supported across tables: ${cycle}.`,
    );
  }
  return ordered;
}

function readReferencedTables(definition: string): readonly string[] {
  let index = 0;
  let depth = 0;
  let expectsTable = false;
  const references: string[] = [];
  while (index < definition.length) {
    if (definition.startsWith('--', index)) {
      index = skipLineComment(definition, index + 2);
      continue;
    }
    if (definition.startsWith('/*', index)) {
      index = skipBlockComment(definition, index + 2);
      continue;
    }
    const character = definition[index];
    if (character === "'"
      || character === '"'
      || character === '`'
      || character === '[') {
      const quoted = skipQuoted(definition, index, character);
      if (expectsTable && depth === 0) {
        references.push(quoted.value);
        expectsTable = false;
      }
      index = quoted.next;
      continue;
    }
    if (character === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (isIdentifierContinue(definition[index])) index += 1;
      const word = definition.slice(start, index);
      if (expectsTable && depth === 0) {
        references.push(word);
        expectsTable = false;
      } else if (depth === 0 && foldName(word) === 'references') {
        expectsTable = true;
      }
      continue;
    }
    index += 1;
  }
  return references;
}

function skipQuoted(
  value: string,
  start: number,
  opener: string,
): { readonly next: number; readonly value: string } {
  const closer = opener === '[' ? ']' : opener;
  let index = start + 1;
  let decoded = '';
  while (index < value.length) {
    if (value[index] !== closer) {
      decoded += value[index];
      index += 1;
      continue;
    }
    if (value[index + 1] === closer) {
      decoded += closer;
      index += 2;
      continue;
    }
    return { next: index + 1, value: decoded };
  }
  return { next: value.length, value: decoded };
}

function skipLineComment(value: string, start: number): number {
  let index = start;
  while (index < value.length && value[index] !== '\n') index += 1;
  return index;
}

function skipBlockComment(value: string, start: number): number {
  const end = value.indexOf('*/', start);
  return end === -1 ? value.length : end + 2;
}

function isIdentifierStart(character: string | undefined): boolean {
  if (!character) return false;
  const codePoint = character.codePointAt(0) ?? 0;
  return character === '_'
    || (codePoint >= 65 && codePoint <= 90)
    || (codePoint >= 97 && codePoint <= 122)
    || (codePoint >= 0x80 && codePoint !== 0xfeff);
}

function isIdentifierContinue(character: string | undefined): boolean {
  if (!character) return false;
  const codePoint = character.codePointAt(0) ?? 0;
  return isIdentifierStart(character)
    || character === '$'
    || (codePoint >= 48 && codePoint <= 57);
}

function foldName(value: string): string {
  return value.toLowerCase();
}

function compareEntries<T extends DatabaseRealmTableEntry>(left: T, right: T): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function insertSorted<T extends DatabaseRealmTableEntry>(values: T[], entry: T): void {
  const index = values.findIndex((candidate) => compareEntries(entry, candidate) < 0);
  if (index === -1) values.push(entry);
  else values.splice(index, 0, entry);
}

function configInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message);
}
