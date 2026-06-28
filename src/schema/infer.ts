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
 * // { id: string; title: string; done: number }
 * ```
 */
export type InferRow<T extends TableDefinition<any, any>> =
  T extends TableDefinition<infer F, infer PK>
    ? { [K in PK]: string } & { [K in keyof F]: InferFieldOutput<F[K]> }
    : never;
