/**
 * database-automations.ts
 *
 * Composes immutable function/trigger definitions into a validated in-memory
 * registry. It owns lookup and canonical metadata only; runtime execution,
 * persistence, logging, IPC, and application lifecycle wiring belong elsewhere.
 */

import { AutomationError } from './automation-error';
import {
  createDatabaseAutomationManifest,
  type DatabaseAutomationManifest,
} from './automation-manifest';
import type { DatabaseFunctionDefinition } from './database-function';
import type {
  DatabaseFunctionReference,
  DatabaseTriggerDefinition,
} from './database-trigger';
import {
  matchesDatabaseTrigger,
  type DatabaseTriggerChange,
} from './database-trigger-matcher';
import {
  validateDatabaseAutomations,
  type DatabaseAutomationValidationHooks,
  type DatabaseAutomationValidationIssue,
} from './automation-validation';

export interface DatabaseAutomationDefinitions {
  readonly functions?: readonly DatabaseFunctionDefinition[];
  readonly triggers?: readonly DatabaseTriggerDefinition[];
}

export interface DefineDatabaseAutomationsOptions extends DatabaseAutomationDefinitions {
  /** Registries composed before local definitions. Duplicate identities fail closed. */
  readonly include?: readonly DatabaseAutomationRegistry[];
  /** Optional application-schema hooks evaluated before the registry is returned. */
  readonly validation?: DatabaseAutomationValidationHooks;
}

/** Validated immutable registry used by transaction and durable runtimes. */
export class DatabaseAutomationRegistry {
  readonly manifest: DatabaseAutomationManifest;
  readonly manifestJson: string;
  readonly fingerprint: `sha256:${string}`;

  private readonly functionsByIdentity: ReadonlyMap<string, DatabaseFunctionDefinition>;
  private readonly triggersByIdentity: ReadonlyMap<string, DatabaseTriggerDefinition>;

  constructor(
    private readonly functions: readonly DatabaseFunctionDefinition[],
    private readonly triggers: readonly DatabaseTriggerDefinition[],
    validation: DatabaseAutomationValidationHooks = {},
  ) {
    const issues = validateDatabaseAutomations({ functions, triggers }, validation);
    if (issues.length > 0) throw validationError(issues);
    this.functions = Object.freeze([...functions]);
    this.triggers = Object.freeze([...triggers]);
    this.functionsByIdentity = new Map(
      this.functions.map((definition) => [definition.identity, definition]),
    );
    this.triggersByIdentity = new Map(
      this.triggers.map((definition) => [definition.identity, definition]),
    );
    const canonical = createDatabaseAutomationManifest({
      functions: this.functions,
      triggers: this.triggers,
    });
    this.manifest = canonical.manifest;
    this.manifestJson = canonical.json;
    this.fingerprint = canonical.fingerprint;
    Object.freeze(this);
  }

  /** Return functions in composition order. */
  listFunctions(): readonly DatabaseFunctionDefinition[] {
    return this.functions;
  }

  /** Return triggers in composition order. */
  listTriggers(): readonly DatabaseTriggerDefinition[] {
    return this.triggers;
  }

  /** Resolve one exact function version, or return null. */
  getFunction(
    reference: DatabaseFunctionReference | string,
  ): DatabaseFunctionDefinition | null {
    const identity = typeof reference === 'string' ? reference : reference.identity;
    return this.functionsByIdentity.get(identity) ?? null;
  }

  /** Resolve one exact trigger version, or return null. */
  getTrigger(identity: string): DatabaseTriggerDefinition | null {
    return this.triggersByIdentity.get(identity) ?? null;
  }

  /** Resolve a trigger's function chain while preserving declared order. */
  resolveTriggerFunctions(
    trigger: DatabaseTriggerDefinition,
  ): readonly DatabaseFunctionDefinition[] {
    return Object.freeze(trigger.run.map((target) => {
      const definition = this.functionsByIdentity.get(target.identity);
      if (!definition) {
        // Construction proves this invariant; retain a stable fail-closed guard
        // for definitions reconstructed across a process boundary.
        throw new AutomationError(
          'AUTOMATION_TARGET_MISSING',
          'Database trigger target is not registered.',
          { details: { functionIdentity: target.identity } },
        );
      }
      return definition;
    }));
  }

  /** Return every trigger matching one logical AFTER-change in registry order. */
  match(change: DatabaseTriggerChange): readonly DatabaseTriggerDefinition[] {
    return Object.freeze(this.triggers.filter((trigger) => (
      matchesDatabaseTrigger(trigger, change)
    )));
  }
}

/** Compose definitions and existing registries into one validated registry. */
export function defineDatabaseAutomations(
  options: DefineDatabaseAutomationsOptions,
): DatabaseAutomationRegistry {
  const functions: DatabaseFunctionDefinition[] = [];
  const triggers: DatabaseTriggerDefinition[] = [];
  for (const registry of options.include ?? []) {
    functions.push(...registry.listFunctions());
    triggers.push(...registry.listTriggers());
  }
  functions.push(...(options.functions ?? []));
  triggers.push(...(options.triggers ?? []));
  return new DatabaseAutomationRegistry(functions, triggers, options.validation);
}

function validationError(
  issues: readonly DatabaseAutomationValidationIssue[],
): AutomationError {
  const first = issues[0]!;
  return new AutomationError(first.code, first.message, {
    details: {
      issueCount: issues.length,
      ...(first.functionIdentity ? { functionIdentity: first.functionIdentity } : {}),
      ...(first.triggerIdentity ? { triggerIdentity: first.triggerIdentity } : {}),
      ...(first.table ? { table: first.table } : {}),
      ...(first.column ? { column: first.column } : {}),
    },
  });
}
