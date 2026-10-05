import * as v from 'valibot';
import type { FieldDef, FieldMeta } from './field-types';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type ClientTableDef,
  type DeclaredSyncMode,
  type Row,
  type SyncTableMutationValidator,
  type TableSchema,
} from '../sync/types';
import { assertIdentityFields } from '../sync/identity';
import { decodeFieldValue, encodeFieldValue } from './field-codecs';
import { attachDeclaredTableSyncMode } from './table-sync-metadata';
import {
  attachGuardianTableReferences,
  type GuardianFieldReference,
  type GuardianReferenceKind,
} from './guardian-references';

export type { ClientTableDef };

/** Preserve each field's logical validator rather than widening every entry to unknown. */
type FieldSchemas<T extends Record<string, FieldDef>> = { -readonly [Name in keyof T]: T[Name]['_schema'] };

export interface SchemaDescriptor<
  T extends Record<string, FieldDef> = Record<string, FieldDef>,
  TPk extends string = string,
> {
  /** Valibot object schema for full-record validation. */
  readonly schema: v.ObjectSchema<
    FieldSchemas<T>,
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
  /** Guardian identity references declared by app fields. Storage metadata only. */
  readonly guardianReferences: readonly GuardianFieldReference[];
  /** Complete anchor set required by this schema. */
  readonly guardianAnchorRequirements: readonly GuardianReferenceKind[];
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
  validate(data: unknown): v.SafeParseResult<v.ObjectSchema<FieldSchemas<T>, undefined>>;
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
  /** Server-side logical validator used by websocket mutation handling. */
  readonly mutationValidator: SyncTableMutationValidator;
  /** Client-side table def for createClient(). */
  readonly clientTable: ClientTableDef;
  /** Guardian identity references declared by app fields. Storage metadata only. */
  readonly guardianReferences: readonly GuardianFieldReference[];
  /** Complete anchor set required by this table. */
  readonly guardianAnchorRequirements: readonly GuardianReferenceKind[];
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
  const guardianReferences: GuardianFieldReference[] = [];

  for (const name of names) {
    const def = fieldDefs[name]!;
    metaMap.set(name, def._meta);
    entries[name] = def._schema;
    if (def._guardianReference) {
      guardianReferences.push(Object.freeze({
        field: name,
        ...def._guardianReference,
      }));
    }
  }

  const frozenGuardianReferences = Object.freeze(guardianReferences);
  const needsMembership = frozenGuardianReferences.some(({ kind }) => kind === 'membership');
  const needsUser = needsMembership || frozenGuardianReferences.some(({ kind }) => kind === 'user');
  const guardianAnchorRequirements = Object.freeze([
    ...(needsUser ? ['user' as const] : []),
    ...(needsMembership ? ['membership' as const] : []),
  ]);

  // The loop copies each exact validator under its original field key. This
  // construction assertion restores that mapped key relation; it does not
  // replace or cast an untyped validator into a different logical schema.
  const schema = v.object(entries as FieldSchemas<T>);

  return {
    schema,
    fields: metaMap,
    fieldNames: names,
    primaryKey,
    identity,
    guardianReferences: frozenGuardianReferences,
    guardianAnchorRequirements,

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

      result[SYNC_TABLE_MUTATION_VALIDATOR] = createSyncMutationValidator({
        primaryKey: pk,
        fieldNames: names,
        fieldDefs,
        schema,
      });
      attachGuardianTableReferences(result, frozenGuardianReferences);

      return result;
    },

    toClientTableDef(opts?: { pk?: string; sync?: DeclaredSyncMode; identity?: readonly string[] }): ClientTableDef {
      const pk = opts?.pk ?? primaryKey;
      const tableIdentity = normalizeIdentity(opts?.identity ?? identity, names, pk);
      const result: ClientTableDef = { _pk: pk };
      if (opts?.sync) result._sync = opts.sync;
      if (tableIdentity.length > 0) result._identity = [...tableIdentity];
      const booleanFields = names.filter((name) => fieldDefs[name]!._meta.type === 'boolean');
      if (booleanFields.length > 0) result._booleanFields = booleanFields;

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
        } else {
          const omitted = v.safeParse(fieldDefs[name]!._schema, undefined);
          if (omitted.success) {
            defaults[name] = omitted.output;
          } else if (meta.type === 'boolean') {
            defaults[name] = false;
          } else if (meta.type === 'number') {
            defaults[name] = 0;
          } else if (meta.type === 'multiSelect' || meta.type === 'tags' || (meta.type === 'combobox' && meta.multiple)) {
            defaults[name] = [];
          } else if (meta.type === 'dateRange') {
            defaults[name] = ['', ''];
          } else if (meta.type === 'json') {
            defaults[name] = null;
          } else if (fieldDefs[name]!._guardianReference) {
            defaults[name] = undefined;
          } else {
            defaults[name] = '';
          }
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
 *   done: field.boolean({ defaultValue: false }),
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
  const serverTable = desc.toTableSchema({ identity: opts?.identity });
  attachDeclaredTableSyncMode(serverTable, opts?.sync);
  return {
    name,
    schema: desc,
    serverTable,
    mutationValidator: serverTable[SYNC_TABLE_MUTATION_VALIDATOR]!,
    clientTable: desc.toClientTableDef({ sync: opts?.sync, identity: opts?.identity }),
    guardianReferences: desc.guardianReferences,
    guardianAnchorRequirements: desc.guardianAnchorRequirements,
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
 * The `_types` phantom property retains the original declaration's type;
 * use the explicit inference aliases to derive logical or stored row shapes.
 */
export interface Schema<T extends SchemaConfig> {
  readonly serverTables: { [K in keyof T]: TableSchema };
  readonly clientTables: { [K in keyof T]: ClientTableDef };
  readonly definitions: { [K in keyof T]: SchemaDescriptor<T[K]['fields'], T[K] extends { pk: infer Pk extends string } ? Pk : 'id'> };
  /** @internal Type-level phantom — not used at runtime. */
  readonly _types: T;
}

/**
 * Define a complete schema for all tables. Returns everything needed for
 * both server (ReactiveDB) and client (createClient) in one object.
 *
 * Use the explicit inference aliases for logical and stored row types. The
 * optional Register pattern resolves TableNames/TableRow aliases; hooks and
 * collection calls still receive an explicit row generic.
 *
 * @example
 * ```ts
 * export const db = schema({
 *   todos: {
 *     fields: {
 *       title: field.text({ required: true }),
 *       done: field.boolean({ defaultValue: false }),
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
 * createClient({ tables: db.clientTables });
 * ```
 */
export function schema<const T extends SchemaConfig>(config: T): Schema<T> {
  const serverTables = {} as Record<string, TableSchema>;
  const clientTables = {} as Record<string, ClientTableDef>;
  const definitions = {} as Record<string, SchemaDescriptor>;

  for (const [name, tableDef] of Object.entries(config)) {
    const desc = defineSchema(tableDef.fields, { pk: tableDef.pk, identity: tableDef.identity });
    definitions[name] = desc;
    serverTables[name] = desc.toTableSchema({ identity: tableDef.identity });
    attachDeclaredTableSyncMode(serverTables[name]!, tableDef.sync);
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

function createSyncMutationValidator(input: {
  primaryKey: string;
  fieldNames: readonly string[];
  fieldDefs: Record<string, FieldDef>;
  schema: v.ObjectSchema<v.ObjectEntries, undefined>;
}): SyncTableMutationValidator {
  const fieldNames = [...input.fieldNames];

  return {
    primaryKey: input.primaryKey,
    fieldNames,

    decodeRow(row: Row): Row {
      const next: Row = { ...row };
      for (const name of fieldNames) {
        if (!(name in next)) continue;
        const meta = input.fieldDefs[name]!._meta;
        if (meta.type === 'boolean' && !isBooleanWireValue(next[name])) {
          // Keep an invalid wire value intact so the declarative schema can
          // return its bounded, field-addressed validation issue. Throwing
          // here would force the Sync boundary either to expose arbitrary
          // codec exceptions or to discard useful framework-owned feedback.
          continue;
        }
        next[name] = decodeFieldValue(meta, next[name]);
      }
      return next;
    },

    encodeRow(row: Row): Row {
      const next: Row = { ...row };
      for (const name of fieldNames) {
        if (name in next) {
          next[name] = encodeFieldValue(input.fieldDefs[name]!._meta, next[name]);
        }
      }
      return next;
    },

    validateRow(row: Row) {
      const candidate: Row = {};
      for (const name of fieldNames) {
        if (name in row) candidate[name] = row[name];
      }
      const result = v.safeParse(input.schema, candidate);
      if (result.success) {
        return { success: true, output: result.output as Row };
      }
      return {
        success: false,
        issues: result.issues.map((issue) => ({
          path: validationIssuePath(issue),
          message: issue.message,
        })),
      };
    },
  };
}

function isBooleanWireValue(value: unknown): boolean {
  return value === true
    || value === false
    || value === 1
    || value === 0
    || value === '1'
    || value === '0'
    || value === 'true'
    || value === 'false';
}

function validationIssuePath(issue: v.BaseIssue<unknown>): string | undefined {
  const path = issue.path
    ?.map((item) => String(item.key))
    .filter(Boolean)
    .join('.');
  return path || undefined;
}
