import type * as v from 'valibot';
import type { SchemaDescriptor, TableDefinition } from './define-schema';
import type { FieldDef } from './field-types';

/**
 * Infer the TypeScript type from a SchemaDescriptor.
 *
 * @example
 * ```ts
 * const todoSchema = defineSchema({
 *   title: field.text({ required: true }),
 *   done: field.boolean(),
 * });
 *
 * type Todo = InferSchemaType<typeof todoSchema>;
 * // { title: string; done?: boolean }
 * ```
 */
export type InferSchemaType<T extends SchemaDescriptor> =
  T extends SchemaDescriptor<infer _F>
    ? v.InferOutput<T['schema']>
    : never;

/**
 * Infer the input type (before transforms/defaults) from a SchemaDescriptor.
 */
export type InferSchemaInput<T extends SchemaDescriptor> =
  T extends SchemaDescriptor<infer _F>
    ? v.InferInput<T['schema']>
    : never;

/**
 * Extract the TypeScript type from a FieldDef's phantom TOutput parameter.
 */
type InferFieldOutput<F> = F extends FieldDef<any, infer O> ? O : unknown;

/**
 * Type-only metadata carried by rows inferred from `defineTable()`.
 *
 * The symbol is intentionally not exported: callers use `PrimaryKeyOf` and
 * `InsertInput`, while ordinary row objects remain free of runtime metadata.
 */
declare const inferredRowPrimaryKey: unique symbol;

type InferredRowPrimaryKey<T> =
  typeof inferredRowPrimaryKey extends keyof T
    ? Extract<T[typeof inferredRowPrimaryKey], keyof T & string>
    : never;

/** Resolve the sync primary-key field for a row type. */
export type PrimaryKeyOf<T extends Record<string, unknown>> =
  [InferredRowPrimaryKey<T>] extends [never]
    ? 'id' extends keyof T
      ? 'id'
      : never
    : InferredRowPrimaryKey<T>;

/**
 * Input accepted by collection insert/load APIs.
 *
 * Zero generates a missing sync primary key at runtime, so that one field is
 * optional at creation boundaries. Every other row field keeps its inferred
 * type and requiredness.
 */
export type InsertInput<
  T extends Record<string, unknown>,
  TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
> = [TPrimaryKey] extends [never]
  ? T
  : Omit<T, TPrimaryKey> & Partial<Pick<T, TPrimaryKey>>;

/**
 * Infer the row type from a defineTable() result.
 *
 * Maps each field to its TypeScript type via the phantom `TOutput` parameter
 * on FieldDef (set by each field builder: text->string, number->number, etc.).
 * Adds the table's configured primary key as a string. Defaults to `id`.
 *
 * @example
 * ```ts
 * const todosTable = defineTable('todos', {
 *   title: field.text({ required: true }),
 *   done: field.boolean(),
 * });
 *
 * type TodoRow = InferRow<typeof todosTable>;
 * // { id: string; title: string; done: boolean }
 * ```
 */
export type InferRow<T extends TableDefinition<any, any>> =
  T extends TableDefinition<infer F, infer PK>
    ? { [K in PK]: string }
      & { [K in keyof F]: InferFieldOutput<F[K]> }
      & { readonly [inferredRowPrimaryKey]?: PK }
    : never;

/** Infer the insert/load input for a `defineTable()` result. */
export type InferInsert<T extends TableDefinition<any, any>> =
  T extends TableDefinition<any, infer PK>
    ? InsertInput<InferRow<T>, Extract<PK, keyof InferRow<T> & string>>
    : never;
