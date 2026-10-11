/** Schema and resource-field contracts. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Schema (pure JS — no server deps, no bun:sqlite) ──────────────────
export { defineTable, defineSchema, schema, field } from '../../../schema';
export type {
  SchemaDescriptor,
  TableDefinition,
  SchemaConfig,
  Schema,
  FieldType,
  FieldMeta,
  FieldDef,
  InferRow,
  InferInsert,
  InsertInput,
  PrimaryKeyOf,
  Register,
  TableNames,
  TableRow as RegisteredTableRow,
} from '../../../schema';
export { defineResourceFields } from '../../../resources/resource-field-access';
export type {
  ResourceFieldAccess,
  ResourceFieldAccessInput,
} from '../../../resources/resource-field-access';
