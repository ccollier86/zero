/**
 * database-trigger-matcher.ts
 *
 * Purely matches normalized AFTER trigger definitions against logical row
 * mutations. It has no database, registry, logging, or execution side effects.
 */

import type {
  DatabaseTriggerDefinition,
  DatabaseTriggerOperation,
} from './database-trigger';

export interface DatabaseTriggerChange {
  readonly table: string;
  readonly operation: DatabaseTriggerOperation;
  readonly row?: Readonly<Record<string, unknown>> | null;
  readonly previousRow?: Readonly<Record<string, unknown>> | null;
  /** Optional exact changed-column set supplied by a mutation adapter. */
  readonly changedColumns?: readonly string[];
}

/** Test table, operation, and optional UPDATE-column intersection. */
export function matchesDatabaseTrigger(
  trigger: DatabaseTriggerDefinition,
  change: DatabaseTriggerChange,
): boolean {
  if (trigger.table !== change.table) return false;
  const event = trigger.after.find(({ operation }) => operation === change.operation);
  if (!event) return false;
  if (event.operation !== 'update' || event.columns === null) return true;

  const changed = change.changedColumns === undefined
    ? deriveChangedColumns(change.previousRow, change.row)
    : new Set(change.changedColumns);
  return event.columns.some((column) => changed.has(column));
}

/** Derive changed keys with `Object.is` semantics when an adapter omits them. */
export function deriveChangedColumns(
  previousRow: Readonly<Record<string, unknown>> | null | undefined,
  row: Readonly<Record<string, unknown>> | null | undefined,
): ReadonlySet<string> {
  if (!previousRow || !row) return new Set();
  const keys = new Set([...Object.keys(previousRow), ...Object.keys(row)]);
  const changed = new Set<string>();
  for (const key of keys) {
    const beforePresent = Object.prototype.hasOwnProperty.call(previousRow, key);
    const afterPresent = Object.prototype.hasOwnProperty.call(row, key);
    if (beforePresent !== afterPresent || !Object.is(previousRow[key], row[key])) {
      changed.add(key);
    }
  }
  return changed;
}
