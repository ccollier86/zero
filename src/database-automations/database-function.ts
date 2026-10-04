/**
 * database-function.ts
 *
 * Defines typed transaction and durable database-function declarations. This
 * authoring layer stores handlers but never invokes them or supplies runtime
 * database/service bindings.
 */

import { AutomationError } from './automation-error';
import {
  automationDefinitionIdentity,
  normalizeAutomationName,
  normalizeAutomationVersion,
  type VersionedAutomationReference,
} from './definition-identity';

export const DATABASE_FUNCTION_DEFINITION_KIND = Symbol.for(
  '@zero/framework/database-function-definition',
);

export type DatabaseFunctionMode = 'transaction' | 'durable';

/** JSON-compatible value accepted as a function input or result by default. */
export type DatabaseAutomationValue =
  | null
  | boolean
  | number
  | string
  | readonly DatabaseAutomationValue[]
  | { readonly [key: string]: DatabaseAutomationValue };

/** Invocation data common to transaction and durable handlers. */
export interface DatabaseFunctionInvocation {
  readonly invocationId: string;
  readonly functionIdentity: string;
  readonly triggerIdentity: string | null;
  readonly table: string | null;
  readonly operation: 'insert' | 'update' | 'delete' | null;
}

/** Context for synchronous, same-database work in the originating commit. */
export interface DatabaseTransactionFunctionContext<
  TInput = DatabaseAutomationValue,
  TTransaction = unknown,
> {
  readonly input: TInput;
  readonly invocation: DatabaseFunctionInvocation;
  readonly transaction: TTransaction;
}

/** Context for durable host work that may call other Zero services. */
export interface DatabaseDurableFunctionContext<
  TInput = DatabaseAutomationValue,
  TServices = unknown,
> {
  readonly input: TInput;
  readonly invocation: DatabaseFunctionInvocation;
  readonly zero: TServices;
  readonly signal: AbortSignal;
}

export type DatabaseTransactionFunctionHandler<
  TInput = DatabaseAutomationValue,
  TOutput extends DatabaseAutomationValue | void = DatabaseAutomationValue | void,
  TTransaction = unknown,
> = (context: DatabaseTransactionFunctionContext<TInput, TTransaction>) => TOutput;

export type DatabaseDurableFunctionHandler<
  TInput = DatabaseAutomationValue,
  TOutput extends DatabaseAutomationValue | void = DatabaseAutomationValue | void,
  TServices = unknown,
> = (
  context: DatabaseDurableFunctionContext<TInput, TServices>,
) => TOutput | Promise<TOutput>;

interface DatabaseFunctionDefinitionBase extends VersionedAutomationReference {
  readonly kind: 'database-function';
  readonly identity: string;
  readonly mode: DatabaseFunctionMode;
  readonly [DATABASE_FUNCTION_DEFINITION_KIND]: true;
}

export interface TransactionDatabaseFunctionDefinition<
  TInput = DatabaseAutomationValue,
  TOutput extends DatabaseAutomationValue | void = DatabaseAutomationValue | void,
  TTransaction = unknown,
> extends DatabaseFunctionDefinitionBase {
  readonly mode: 'transaction';
  readonly handler: DatabaseTransactionFunctionHandler<TInput, TOutput, TTransaction>;
}

export interface DurableDatabaseFunctionDefinition<
  TInput = DatabaseAutomationValue,
  TOutput extends DatabaseAutomationValue | void = DatabaseAutomationValue | void,
  TServices = unknown,
> extends DatabaseFunctionDefinitionBase {
  readonly mode: 'durable';
  readonly handler: DatabaseDurableFunctionHandler<TInput, TOutput, TServices>;
}

export type DatabaseFunctionDefinition =
  | TransactionDatabaseFunctionDefinition<any, any, any>
  | DurableDatabaseFunctionDefinition<any, any, any>;

export interface TransactionDatabaseFunctionOptions<
  TInput = DatabaseAutomationValue,
  TOutput extends DatabaseAutomationValue | void = DatabaseAutomationValue | void,
  TTransaction = unknown,
> extends VersionedAutomationReference {
  readonly mode: 'transaction';
  readonly handler: DatabaseTransactionFunctionHandler<TInput, TOutput, TTransaction>;
}

export interface DurableDatabaseFunctionOptions<
  TInput = DatabaseAutomationValue,
  TOutput extends DatabaseAutomationValue | void = DatabaseAutomationValue | void,
  TServices = unknown,
> extends VersionedAutomationReference {
  readonly mode: 'durable';
  readonly handler: DatabaseDurableFunctionHandler<TInput, TOutput, TServices>;
}

/** Define a synchronous function intended to run inside the originating transaction. */
export function defineDatabaseFunction<
  TInput = DatabaseAutomationValue,
  TOutput extends DatabaseAutomationValue | void = DatabaseAutomationValue | void,
  TTransaction = unknown,
>(
  options: TransactionDatabaseFunctionOptions<TInput, TOutput, TTransaction>,
): TransactionDatabaseFunctionDefinition<TInput, TOutput, TTransaction>;

/** Define a durable function whose eventual runtime may await host-side services. */
export function defineDatabaseFunction<
  TInput = DatabaseAutomationValue,
  TOutput extends DatabaseAutomationValue | void = DatabaseAutomationValue | void,
  TServices = unknown,
>(
  options: DurableDatabaseFunctionOptions<TInput, TOutput, TServices>,
): DurableDatabaseFunctionDefinition<TInput, TOutput, TServices>;

export function defineDatabaseFunction(
  options: TransactionDatabaseFunctionOptions | DurableDatabaseFunctionOptions,
): DatabaseFunctionDefinition {
  const name = normalizeAutomationName(options.name, 'Database function name');
  const version = normalizeAutomationVersion(options.version, 'Database function version');
  if (options.mode !== 'transaction' && options.mode !== 'durable') {
    throw new AutomationError(
      'AUTOMATION_DEFINITION_INVALID',
      'Database function mode must be "transaction" or "durable".',
    );
  }
  if (typeof options.handler !== 'function') {
    throw new AutomationError(
      'AUTOMATION_DEFINITION_INVALID',
      'Database function handler must be callable.',
    );
  }
  return Object.freeze({
    kind: 'database-function' as const,
    [DATABASE_FUNCTION_DEFINITION_KIND]: true as const,
    name,
    version,
    identity: automationDefinitionIdentity('function', { name, version }),
    mode: options.mode,
    handler: options.handler,
  }) as DatabaseFunctionDefinition;
}

/** Return true only for definitions created by `defineDatabaseFunction`. */
export function isDatabaseFunctionDefinition(
  value: unknown,
): value is DatabaseFunctionDefinition {
  if (!value || typeof value !== 'object') return false;
  return (value as Record<PropertyKey, unknown>)[DATABASE_FUNCTION_DEFINITION_KIND] === true;
}
