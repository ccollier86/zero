export { field } from './field-types';
export type { FieldType, FieldMeta, FieldDef } from './field-types';
export { decodeFieldValue, encodeFieldValue } from './field-codecs';

export { defineSchema, defineTable, schema } from './define-schema';
export type { SchemaDescriptor, TableDefinition, ClientTableDef, SchemaConfig, Schema } from './define-schema';

export type {
  InferSchemaType,
  InferSchemaInput,
  InferRow,
  InferInsert,
  InsertInput,
  PrimaryKeyOf,
} from './infer';

export type { Register, TableNames, TableRow } from './registry';
