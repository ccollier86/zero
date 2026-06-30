import * as v from 'valibot';
import type { FieldDef, FieldMeta } from './field-types';
import type { TableSchema, ClientTableDef, DeclaredSyncMode } from '../sync/types';
import { assertIdentityFields } from '../sync/identity';
import { decodeFieldValue, encodeFieldValue } from './field-codecs';

export type { ClientTableDef };

export interface SchemaDescriptor<
  T extends Record<string, FieldDef> = Record<string, FieldDef>,
  TPk extends string = string,
> {
  /** Valibot object schema for full-record validation. */
  readonly schema: v.ObjectSchema<
    v.ObjectEntries,
    undefined
  >;
  /** Field metadata indexed by name. */
  readonly fields: ReadonlyMap<string, FieldMeta>;
  /** Ordered field names (insertion order). */
  readonly fieldNames: readonly string[];
  /** Primary key field used by generated server/client table definitions. */
  readonly primaryKey: TPk;
  /** Natural/business identity fields used for deterministic sync ids. */
  readonly identity: readonly string[];
  /** Get the valibot schema for a single field by name. */
  getFieldSchema(name: string): v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>> | undefined;
  /** Convert to ReactiveDB table schema (SQL column defs). */
  toTableSchema(opts?: { pk?: string; identity?: readonly string[] }): TableSchema;
  /** Convert to client-side table definition. */
  toClientTableDef(opts?: { pk?: string; sync?: DeclaredSyncMode; identity?: readonly string[] }): ClientTableDef;
  /** Get default values for all fields. */
  getDefaults(): Record<string, unknown>;
  /** Convert one stored row value into its UI value. */
  decodeField(name: string, value: unknown): unknown;
  /** Convert one UI value into its ReactiveDB row value. */
  encodeField(name: string, value: unknown): unknown;
  /** Convert stored row values into UI values for forms and tables. */
  decodeRow(row: Record<string, unknown>): Record<string, unknown>;
  /** Convert UI row values into ReactiveDB row values for collection writes. */
  encodeRow(row: Record<string, unknown>): Record<string, unknown>;
  /** Validate data against the schema. */
  validate(data: unknown): v.SafeParseResult<v.ObjectSchema<v.ObjectEntries, undefined>>;
}

export interface TableDefinition<
  T extends Record<string, FieldDef> = Record<string, FieldDef>,
  TPk extends string = string,
> {
  /** Table name. */
  readonly name: string;
  /** Schema descriptor with validation + metadata. */
  readonly schema: SchemaDescriptor<T, TPk>;
  /** Server-side table schema (SQL column defs). */
  readonly serverTable: TableSchema;
  /** Client-side table def for createClient(). */
  readonly clientTable: ClientTableDef;
}

// ─── defineSchema ───────────────────────────────────────────────────────────

/**
 * Create a schema descriptor from field definitions.
 *
 * @example
 * ```ts
 * const todoSchema = defineSchema({
 *   title: field.text({ required: true, label: 'Title' }),
 *   done: field.boolean({ label: 'Completed' }),
 *   priority: field.select([
 *     { label: 'Low', value: 'low' },
 *     { label: 'High', value: 'high' },
 *   ]),
 * });
 * ```
 */
export function defineSchema<
  T extends Record<string, FieldDef>,
  TPk extends string = 'id',
>(
  fieldDefs: T,
  opts?: { pk?: TPk; identity?: readonly string[] },
): SchemaDescriptor<T, TPk> {
  const names = Object.keys(fieldDefs);
  const primaryKey = (opts?.pk ?? 'id') as TPk;
  const identity = normalizeIdentity(opts?.identity, names, primaryKey);
  const metaMap = new Map<string, FieldMeta>();
  const entries: Record<string, v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>> = {};

  for (const name of names) {
    const def = fieldDefs[name]!;
    metaMap.set(name, def._meta);
    entries[name] = def._schema;
  }

  const schema = v.object(entries as v.ObjectEntries);

  return {
    schema,
    fields: metaMap,
    fieldNames: names,
    primaryKey,
    identity,

    getFieldSchema(name: string) {
      return fieldDefs[name]?._schema;
    },

    toTableSchema(opts?: { pk?: string; identity?: readonly string[] }): TableSchema {
      const pk = opts?.pk ?? primaryKey;
      const tableIdentity = normalizeIdentity(opts?.identity ?? identity, names, pk);
      const result: TableSchema = {};
      if (tableIdentity.length > 0) result._identity = [...tableIdentity];

      // Add PK if not already defined
      if (!fieldDefs[pk]) {
        result[pk] = 'text primary key';
      }

      for (const name of names) {
        const def = fieldDefs[name]!;
        if (name === pk) {
          // Ensure PK has primary key constraint
          const sqlType = def._sqlType.replace(/ not null$/, '');
          result[name] = `${sqlType} primary key`;
        } else {
          result[name] = def._sqlType;
        }
      }

      return result;
    },

    toClientTableDef(opts?: { pk?: string; sync?: DeclaredSyncMode; identity?: readonly string[] }): ClientTableDef {
      const pk = opts?.pk ?? primaryKey;
      const tableIdentity = normalizeIdentity(opts?.identity ?? identity, names, pk);
      const result: ClientTableDef = { _pk: pk };
      if (opts?.sync) result._sync = opts.sync;
      if (tableIdentity.length > 0) result._identity = [...tableIdentity];

      // Add PK if not already defined
      if (!fieldDefs[pk]) {
        result[pk] = 'text';
      }

      for (const name of names) {
        result[name] = fieldDefs[name]!._clientType;
      }

      return result;
    },

    getDefaults(): Record<string, unknown> {
      const defaults: Record<string, unknown> = {};
      for (const name of names) {
        const meta = fieldDefs[name]!._meta;
        if (meta.defaultValue !== undefined) {
          defaults[name] = meta.defaultValue;
        } else if (meta.type === 'boolean') {
          defaults[name] = false;
        } else if (meta.type === 'number') {
          defaults[name] = 0;
        } else if (meta.type === 'multiSelect') {
          defaults[name] = [];
        } else {
          defaults[name] = '';
        }
      }
      return defaults;
    },

    decodeField(name: string, value: unknown): unknown {
      const meta = metaMap.get(name);
      return meta ? decodeFieldValue(meta, value) : value;
    },

    encodeField(name: string, value: unknown): unknown {
      const meta = metaMap.get(name);
      return meta ? encodeFieldValue(meta, value) : value;
    },

    decodeRow(row: Record<string, unknown>): Record<string, unknown> {
      const next: Record<string, unknown> = { ...row };
      for (const name of names) {
        if (name in next) next[name] = this.decodeField(name, next[name]);
      }
      return next;
    },

    encodeRow(row: Record<string, unknown>): Record<string, unknown> {
      const next: Record<string, unknown> = { ...row };
      for (const name of names) {
        if (name in next) next[name] = this.encodeField(name, next[name]);
      }
      return next;
    },

    validate(data: unknown) {
      return v.safeParse(schema, data);
    },
  };
}

// ─── defineTable ────────────────────────────────────────────────────────────

/**
 * Define a table with name + schema. Returns everything needed for
 * both server (ReactiveDB) and client (createClient).
 *
 * @example
 * ```ts
 * const todos = defineTable('todos', {
 *   title: field.text({ required: true }),
 *   done: field.boolean({ default: false }),
 * });
 *
 * // Full-stack app
 * createApp({ tables: { todos } });
 *
 * // Lower-level clients can still pass the client shape directly:
 * createClient({ tables: { todos: todos.clientTable } });
 * ```
 */
export function defineTable<
  T extends Record<string, FieldDef>,
  TPk extends string = 'id',
>(
  name: string,
  fieldDefs: T,
  opts?: { pk?: TPk; sync?: DeclaredSyncMode; identity?: readonly (keyof T & string)[] },
): TableDefinition<T, TPk> {
  const desc = defineSchema(fieldDefs, { pk: opts?.pk, identity: opts?.identity });
  return {
    name,
    schema: desc,
    serverTable: desc.toTableSchema({ identity: opts?.identity }),
    clientTable: desc.toClientTableDef({ sync: opts?.sync, identity: opts?.identity }),
  };
}

// ─── Schema Config ──────────────────────────────────────────────────────────

/**
 * Per-table configuration for `schema()`.
 */
export interface SchemaConfig {
  [tableName: string]: {
    fields: Record<string, FieldDef>;
    pk?: string;
    sync?: DeclaredSyncMode;
    identity?: readonly string[];
  };
}

/**
 * A fully-resolved schema object returned by `schema()`.
 *
 * Provides `serverTables` and `clientTables` for passing directly to
 * `createApp()` / `createClient()`, plus `definitions` for runtime
 * validation and metadata access.
 *
 * The `_types` phantom property is used by the Register pattern to
 * infer table names and row types at compile time.
 */
export interface Schema<T extends SchemaConfig> {
  readonly serverTables: { [K in keyof T]: TableSchema };
  readonly clientTables: { [K in keyof T]: ClientTableDef };
  readonly definitions: { [K in keyof T]: SchemaDescriptor };
  /** @internal Type-level phantom — not used at runtime. */
  readonly _types: T;
}

/**
 * Define a complete schema for all tables. Returns everything needed for
 * both server (ReactiveDB) and client (createClient) in one object.
 *
 * Use with the Register pattern to get typed table names + row types
 * across all hooks and collection calls.
 *
 * @example
 * ```ts
 * export const db = schema({
 *   todos: {
 *     fields: {
 *       title: field.text({ required: true }),
 *       done: field.boolean({ default: false }),
 *     },
 *     sync: 'full',
 *   },
 *   attachments: {
 *     fields: {
 *       todo_id: field.text({ required: true }),
 *       url: field.url({ required: true }),
 *     },
 *     sync: 'lazy',
 *   },
 * });
 *
 * // Server
 * createApp({ tables: db.serverTables });
 *
 * // Client
 * createClient({ schema: db });
 * ```
 */
export function schema<T extends SchemaConfig>(config: T): Schema<T> {
  const serverTables = {} as Record<string, TableSchema>;
  const clientTables = {} as Record<string, ClientTableDef>;
  const definitions = {} as Record<string, SchemaDescriptor>;

  for (const [name, tableDef] of Object.entries(config)) {
    const desc = defineSchema(tableDef.fields, { pk: tableDef.pk, identity: tableDef.identity });
    definitions[name] = desc;
    serverTables[name] = desc.toTableSchema({ identity: tableDef.identity });
    clientTables[name] = desc.toClientTableDef({ sync: tableDef.sync, identity: tableDef.identity });
  }

  return {
    serverTables,
    clientTables,
    definitions,
    _types: config,
  } as Schema<T>;
}

function normalizeIdentity(
  identity: readonly string[] | undefined,
  fieldNames: readonly string[],
  primaryKey: string,
): readonly string[] {
  if (!identity || identity.length === 0) return [];
  assertIdentityFields(identity);

  const fieldSet = new Set(fieldNames);
  for (const field of identity) {
    if (field === primaryKey) {
      throw new Error(`[schema] identity field "${field}" cannot be the primary key.`);
    }
    if (!fieldSet.has(field)) {
      throw new Error(`[schema] identity field "${field}" is not defined in table fields.`);
    }
  }

  return [...identity];
}
