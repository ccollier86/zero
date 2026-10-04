/**
 * automation-validation.ts
 *
 * Validates composed automation definitions and optional application-table
 * hooks. It reports deterministic issues only; it does not mutate a registry,
 * inspect SQLite directly, emit telemetry, or execute user code beyond hooks.
 */

import type { DatabaseFunctionDefinition } from './database-function';
import type { DatabaseTriggerDefinition } from './database-trigger';

export type DatabaseAutomationValidationIssueCode =
  | 'AUTOMATION_FUNCTION_DUPLICATE'
  | 'AUTOMATION_TRIGGER_DUPLICATE'
  | 'AUTOMATION_TARGET_MISSING'
  | 'AUTOMATION_TABLE_MISSING'
  | 'AUTOMATION_TABLE_INVALID';

export interface DatabaseAutomationValidationIssue {
  readonly code: DatabaseAutomationValidationIssueCode;
  readonly message: string;
  readonly functionIdentity?: string;
  readonly triggerIdentity?: string;
  readonly table?: string;
  readonly column?: string;
}

/** Hooks supplied by the schema/runtime composition root during validation. */
export interface DatabaseAutomationValidationHooks {
  /** Return whether the exact logical table is present in this app schema. */
  readonly tableExists?: (table: string) => boolean;
  /** Return known columns to validate UPDATE filters, or undefined to defer. */
  readonly tableColumns?: (table: string) => Iterable<string> | undefined;
}

export interface DatabaseAutomationValidationInput {
  readonly functions: readonly DatabaseFunctionDefinition[];
  readonly triggers: readonly DatabaseTriggerDefinition[];
}

/** Validate duplicates, function targets, and optional schema-backed tables. */
export function validateDatabaseAutomations(
  input: DatabaseAutomationValidationInput,
  hooks: DatabaseAutomationValidationHooks = {},
): readonly DatabaseAutomationValidationIssue[] {
  const issues: DatabaseAutomationValidationIssue[] = [];
  const functions = uniqueDefinitions(
    input.functions,
    'AUTOMATION_FUNCTION_DUPLICATE',
    'functionIdentity',
    issues,
  );
  uniqueDefinitions(
    input.triggers,
    'AUTOMATION_TRIGGER_DUPLICATE',
    'triggerIdentity',
    issues,
  );

  for (const trigger of input.triggers) {
    for (const target of trigger.run) {
      if (!functions.has(target.identity)) {
        issues.push(freezeIssue({
          code: 'AUTOMATION_TARGET_MISSING',
          message: `Trigger "${trigger.identity}" targets missing function "${target.identity}".`,
          triggerIdentity: trigger.identity,
          functionIdentity: target.identity,
        }));
      }
    }
    validateTriggerTable(trigger, hooks, issues);
  }
  return Object.freeze(issues);
}

function uniqueDefinitions(
  definitions: readonly { readonly identity: string }[],
  code: 'AUTOMATION_FUNCTION_DUPLICATE' | 'AUTOMATION_TRIGGER_DUPLICATE',
  identityField: 'functionIdentity' | 'triggerIdentity',
  issues: DatabaseAutomationValidationIssue[],
): ReadonlySet<string> {
  const identities = new Set<string>();
  for (const definition of definitions) {
    if (identities.has(definition.identity)) {
      issues.push(freezeIssue({
        code,
        message: `Automation definition "${definition.identity}" is registered more than once.`,
        [identityField]: definition.identity,
      }));
    }
    identities.add(definition.identity);
  }
  return identities;
}

function validateTriggerTable(
  trigger: DatabaseTriggerDefinition,
  hooks: DatabaseAutomationValidationHooks,
  issues: DatabaseAutomationValidationIssue[],
): void {
  if (hooks.tableExists) {
    let exists: boolean;
    try {
      exists = hooks.tableExists(trigger.table) === true;
    } catch {
      issues.push(tableHookIssue(trigger));
      return;
    }
    if (!exists) {
      issues.push(freezeIssue({
        code: 'AUTOMATION_TABLE_MISSING',
        message: `Trigger "${trigger.identity}" targets missing table "${trigger.table}".`,
        triggerIdentity: trigger.identity,
        table: trigger.table,
      }));
      return;
    }
  }
  if (!hooks.tableColumns) return;

  let columns: ReadonlySet<string> | null;
  try {
    const resolved = hooks.tableColumns(trigger.table);
    columns = resolved === undefined ? null : new Set(resolved);
  } catch {
    issues.push(tableHookIssue(trigger));
    return;
  }
  if (columns === null) return;
  for (const event of trigger.after) {
    for (const column of event.columns ?? []) {
      if (!columns.has(column)) {
        issues.push(freezeIssue({
          code: 'AUTOMATION_TABLE_INVALID',
          message: `Trigger "${trigger.identity}" references unknown column "${column}".`,
          triggerIdentity: trigger.identity,
          table: trigger.table,
          column,
        }));
      }
    }
  }
}

function tableHookIssue(
  trigger: DatabaseTriggerDefinition,
): DatabaseAutomationValidationIssue {
  return freezeIssue({
    code: 'AUTOMATION_TABLE_INVALID',
    message: `Table validation failed for trigger "${trigger.identity}".`,
    triggerIdentity: trigger.identity,
    table: trigger.table,
  });
}

function freezeIssue(
  issue: DatabaseAutomationValidationIssue,
): DatabaseAutomationValidationIssue {
  return Object.freeze(issue);
}
