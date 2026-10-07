export { field } from './field-types';
export type { PhoneFieldOptions } from './field-phone';
export { isPhoneNumber, isPhoneCountry } from '../lib/phone-number';
export type { PhoneCountry, PhoneNumberValidation } from '../lib/phone-number';
export { SchemaConfigurationError } from './schema-configuration-error';
export type {
  FieldType,
  FieldMeta,
  FieldDef,
  GuardianReferenceOptions,
} from './field-types';
export { decodeFieldValue, encodeFieldValue } from './field-codecs';

export {
  GUARDIAN_TABLE_REFERENCES,
  getGuardianAnchorRequirements,
  getGuardianTableReferences,
  hasGuardianTableReferences,
  inspectGuardianReferenceSchema,
} from './guardian-references';
export type {
  GuardianFieldReference,
  GuardianReferenceDefinition,
  GuardianReferenceKind,
  GuardianReferenceSchemaIssue,
  GuardianReferenceSchemaIssueCode,
  GuardianReferenceSchemaReader,
  GuardianReferenceStorageInspection,
  GuardianTableReferenceMetadata,
} from './guardian-references';

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
