/**
 * database-transaction-automation-runtime.ts
 *
 * Executes matched transaction functions and captures durable functions from
 * ReactiveDB's same-commit mutation seam. It owns deterministic cascade
 * ordering and hard transaction budgets only; durable leasing/host execution,
 * Fabric routing, configuration, and observability scheduling live elsewhere.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  registerReactiveDBMutationInterceptor,
  type ReactiveDBMutationChange,
  type ReactiveDBMutationInterception,
} from '../sync/reactive-db-mutation-interceptor';
import { isReactiveDBPromiseLike } from '../sync/reactive-db-synchronous-boundary';
import { DatabaseError, isDatabaseError } from '../databases/database-error';
import type { DatabaseAutomationRegistry } from './database-automations';
import type {
  DatabaseFunctionInvocation,
  TransactionDatabaseFunctionDefinition,
} from './database-function';
import type { DatabaseTriggerDefinition } from './database-trigger';
import type { DatabaseDurableAutomationSink } from './database-automation-runtime-contracts';
import {
  createDatabaseTriggerFunctionInput,
  type DatabaseTriggerFunctionInput,
} from './database-trigger-input';
import {
  createDatabaseTransactionFunctionSession,
  type DatabaseTransactionFunctionCapability,
} from './database-transaction-function-capability';

export const DATABASE_AUTOMATION_DEFAULT_MAX_CASCADE_DEPTH = 16;
export const DATABASE_AUTOMATION_DEFAULT_MAX_CHANGES = 256;
export const DATABASE_AUTOMATION_DEFAULT_MAX_FUNCTIONS = 256;
export const DATABASE_AUTOMATION_DEFAULT_MAX_DURABLE_EFFECTS = 256;

export interface DatabaseTransactionAutomationLimits {
  readonly maxCascadeDepth?: number;
  readonly maxChanges?: number;
  readonly maxFunctions?: number;
  readonly maxDurableEffects?: number;
}

export interface DatabaseTransactionAutomationRuntimeOptions {
  readonly db: ReactiveDB;
  readonly registry: DatabaseAutomationRegistry;
  /** Required when the registry contains at least one durable function. */
  readonly durableSink?: DatabaseDurableAutomationSink;
  /** Framework-owned tables unavailable to transaction functions for writes. */
  readonly readOnlyTables?: readonly string[];
  readonly limits?: DatabaseTransactionAutomationLimits;
  readonly now?: () => number;
  readonly createId?: () => string;
}

interface PendingChange {
  readonly change: ReactiveDBMutationChange;
  readonly depth: number;
  readonly triggers: readonly DatabaseTriggerDefinition[];
}

interface RootExecution {
  readonly queue: PendingChange[];
  draining: boolean;
  activeDepth: number;
  changes: number;
  functions: number;
  durableEffects: number;
}

interface NormalizedLimits {
  readonly maxCascadeDepth: number;
  readonly maxChanges: number;
  readonly maxFunctions: number;
  readonly maxDurableEffects: number;
}

/** One revocable automation runtime installed on a single live ReactiveDB. */
export class DatabaseTransactionAutomationRuntime {
  private readonly db: ReactiveDB;
  private readonly registry: DatabaseAutomationRegistry;
  private readonly durableSink: DatabaseDurableAutomationSink | null;
  private readonly readOnlyTables: readonly string[];
  private readonly limits: NormalizedLimits;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly executions = new WeakMap<object, RootExecution>();
  private readonly unregister: () => void;
  private closed = false;

  constructor(options: DatabaseTransactionAutomationRuntimeOptions) {
    this.db = options.db;
    this.registry = options.registry;
    this.durableSink = options.durableSink ?? null;
    this.readOnlyTables = Object.freeze([...(options.readOnlyTables ?? [])]);
    this.limits = normalizeLimits(options.limits);
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    assertDurableSinkConfigured(this.registry, this.durableSink);
    assertNoPrivateTriggerTargets(this.registry);
    this.unregister = registerReactiveDBMutationInterceptor(
      this.db,
      (interception) => this.intercept(interception),
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unregister();
  }

  private intercept(interception: ReactiveDBMutationInterception): void {
    if (this.closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database automation runtime is closed.',
        { outcome: 'not-committed' },
      );
    }
    const token = interception.transactionToken as object;
    let execution = this.executions.get(token);
    const change = interception.change;
    const triggers = this.registry.match({
      table: change.table,
      operation: operationName(change),
      row: change.row,
      previousRow: change.previousRow,
    });
    // This is an automation budget, not a cap on ordinary application writes.
    // Handler-generated writes still count even when their rollup table/event
    // has no matching trigger; they are part of the bounded cascade.
    if (triggers.length === 0 && !execution?.draining) return;
    if (!execution) {
      execution = {
        queue: [],
        draining: false,
        activeDepth: -1,
        changes: 0,
        functions: 0,
        durableEffects: 0,
      };
      this.executions.set(token, execution);
    }

    const depth = execution.draining ? execution.activeDepth + 1 : 0;
    assertBudget(depth <= this.limits.maxCascadeDepth, 'cascade-depth');
    execution.changes += 1;
    assertBudget(execution.changes <= this.limits.maxChanges, 'changes');
    if (triggers.length === 0) return;
    execution.queue.push({ change, depth, triggers });
    if (execution.draining) return;

    execution.draining = true;
    try {
      while (execution.queue.length > 0) {
        const pending = execution.queue.shift()!;
        execution.activeDepth = pending.depth;
        this.runChange(pending, execution);
      }
    } finally {
      execution.activeDepth = -1;
      execution.draining = false;
      execution.queue.length = 0;
    }
  }

  private runChange(
    pending: PendingChange,
    execution: RootExecution,
  ): void {
    const input = createDatabaseTriggerFunctionInput(pending.change);
    for (const trigger of pending.triggers) {
      this.runTrigger(trigger, input, execution);
    }
  }

  private runTrigger(
    trigger: DatabaseTriggerDefinition,
    input: DatabaseTriggerFunctionInput,
    execution: RootExecution,
  ): void {
    const invocationId = this.nextIdentifier();
    const functions = this.registry.resolveTriggerFunctions(trigger);
    for (const definition of functions) {
      execution.functions += 1;
      assertBudget(execution.functions <= this.limits.maxFunctions, 'functions');
      const invocation = Object.freeze({
        invocationId,
        functionIdentity: definition.identity,
        triggerIdentity: trigger.identity,
        table: input.change.table,
        operation: input.change.operation,
      }) satisfies DatabaseFunctionInvocation;

      if (definition.mode === 'transaction') {
        this.runTransactionFunction(definition, input, invocation);
        continue;
      }

      execution.durableEffects += 1;
      assertBudget(
        execution.durableEffects <= this.limits.maxDurableEffects,
        'durable-effects',
      );
      try {
        this.durableSink!.enqueue(Object.freeze({
          deliveryId: this.nextIdentifier(),
          invocation,
          automationFingerprint: this.registry.fingerprint,
          input,
          availableAt: this.currentTime(),
        }));
      } catch (cause) {
        if (isDatabaseError(cause)) throw cause;
        throw infrastructureFailed(cause, 'automation-outbox');
      }
    }
  }

  private runTransactionFunction(
    definition: TransactionDatabaseFunctionDefinition,
    input: DatabaseTriggerFunctionInput,
    invocation: DatabaseFunctionInvocation,
  ): void {
    const session = createDatabaseTransactionFunctionSession(
      this.db,
      this.readOnlyTables,
    );
    try {
      let output: unknown;
      try {
        output = definition.handler(Object.freeze({
          input,
          invocation,
          transaction: session.capability as DatabaseTransactionFunctionCapability,
        }));
      } catch (cause) {
        if (isDatabaseError(cause)) throw cause;
        throw handlerFailed(cause);
      }
      if (isReactiveDBPromiseLike(output)) {
        void Promise.resolve(output).catch(() => {});
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database transaction automation must be synchronous.',
          {
            retryable: false,
            outcome: 'not-committed',
            details: { phase: 'automation-transaction' },
          },
        );
      }
    } finally {
      session.close();
    }
  }

  private nextIdentifier(): string {
    let value: unknown;
    try {
      value = this.createId();
    } catch (cause) {
      throw infrastructureFailed(cause, 'automation-identity');
    }
    if (typeof value !== 'string'
      || value.length < 1
      || value.length > 200
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
      throw infrastructureFailed(undefined, 'automation-identity');
    }
    return value;
  }

  private currentTime(): number {
    let value: unknown;
    try {
      value = this.now();
    } catch (cause) {
      throw infrastructureFailed(cause, 'automation-clock');
    }
    return normalizeNow(value);
  }
}

function operationName(
  change: ReactiveDBMutationChange,
): 'insert' | 'update' | 'delete' {
  switch (change.op) {
    case 'INSERT': return 'insert';
    case 'UPDATE': return 'update';
    case 'DELETE': return 'delete';
  }
}

function normalizeLimits(
  input: DatabaseTransactionAutomationLimits | undefined,
): NormalizedLimits {
  return Object.freeze({
    maxCascadeDepth: positiveLimit(
      input?.maxCascadeDepth,
      DATABASE_AUTOMATION_DEFAULT_MAX_CASCADE_DEPTH,
    ),
    maxChanges: positiveLimit(
      input?.maxChanges,
      DATABASE_AUTOMATION_DEFAULT_MAX_CHANGES,
    ),
    maxFunctions: positiveLimit(
      input?.maxFunctions,
      DATABASE_AUTOMATION_DEFAULT_MAX_FUNCTIONS,
    ),
    maxDurableEffects: positiveLimit(
      input?.maxDurableEffects,
      DATABASE_AUTOMATION_DEFAULT_MAX_DURABLE_EFFECTS,
    ),
  });
}

function positiveLimit(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 10_000) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database automation limit is invalid.',
      { details: { phase: 'automation-config' } },
    );
  }
  return resolved;
}

function normalizeNow(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database automation clock returned an invalid value.',
      {
        retryable: false,
        outcome: 'not-committed',
        details: { phase: 'automation-transaction' },
      },
    );
  }
  return value;
}

function assertDurableSinkConfigured(
  registry: DatabaseAutomationRegistry,
  sink: DatabaseDurableAutomationSink | null,
): void {
  if (!sink && registry.listFunctions().some(({ mode }) => mode === 'durable')) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Durable database automations require an outbox sink.',
      { details: { phase: 'automation-config' } },
    );
  }
}

function assertNoPrivateTriggerTargets(registry: DatabaseAutomationRegistry): void {
  if (registry.listTriggers().some(({ table }) => table.startsWith('_'))) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database automations cannot target framework-private tables.',
      { details: { phase: 'automation-config' } },
    );
  }
}

function assertBudget(condition: boolean, budget: string): asserts condition {
  if (condition) return;
  throw new DatabaseError(
    'DATABASE_PAYLOAD_LIMIT',
    'Database automation transaction budget was exceeded.',
    {
      retryable: false,
      outcome: 'not-committed',
      details: { reason: budget },
    },
  );
}

function handlerFailed(cause: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database transaction automation failed.',
    {
      cause,
      retryable: false,
      outcome: 'not-committed',
      details: { phase: 'automation-transaction' },
    },
  );
}

function infrastructureFailed(cause: unknown, phase: string): DatabaseError {
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database automation infrastructure failed.',
    {
      ...(cause === undefined ? {} : { cause }),
      retryable: false,
      outcome: 'not-committed',
      details: { phase },
    },
  );
}
