/**
 * database-trigger-input.ts
 *
 * Owns the canonical, JSON-safe input supplied to functions fired by a
 * ReactiveDB AFTER trigger. It does not match definitions, execute handlers,
 * persist work, or expose a mutable application row.
 */

import type { DatabaseAutomationValue } from './database-function';
import type { ReactiveDBMutationChange } from '../sync/reactive-db-mutation-interceptor';

export interface DatabaseTriggerChangeInput {
  readonly [key: string]: DatabaseAutomationValue;
  readonly sequence: number;
  readonly table: string;
  readonly operation: 'insert' | 'update' | 'delete';
  readonly rowId: string;
  readonly row: Readonly<Record<string, DatabaseAutomationValue>> | null;
  readonly previousRow: Readonly<Record<string, DatabaseAutomationValue>> | null;
  readonly timestamp: number;
}

export interface DatabaseTriggerFunctionInput {
  readonly [key: string]: DatabaseAutomationValue;
  readonly change: DatabaseTriggerChangeInput;
}

/** Create one detached immutable input shared by a trigger's ordered chain. */
export function createDatabaseTriggerFunctionInput(
  change: ReactiveDBMutationChange,
): DatabaseTriggerFunctionInput {
  return deepFreeze({
    change: {
      sequence: change.seq,
      table: change.table,
      operation: normalizeOperation(change.op),
      rowId: change.rowId,
      row: change.row,
      previousRow: change.previousRow,
      timestamp: change.ts,
    },
  }) as DatabaseTriggerFunctionInput;
}

function normalizeOperation(
  operation: ReactiveDBMutationChange['op'],
): DatabaseTriggerFunctionInput['change']['operation'] {
  switch (operation) {
    case 'INSERT': return 'insert';
    case 'UPDATE': return 'update';
    case 'DELETE': return 'delete';
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
