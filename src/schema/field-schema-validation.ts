/** Composes optional scalar validation and validates configured defaults without leaking their values. */

import * as v from 'valibot';
import type { FieldType } from './field-types';
import { SchemaConfigurationError } from './schema-configuration-error';

/** Explicit defaults must pass the same declaration validator as supplied values. */
export function assertFieldDefault(
  type: FieldType,
  schema: v.GenericSchema,
  defaultValue: unknown,
): void {
  if (defaultValue !== undefined && !v.safeParse(schema, defaultValue).success) {
    throw new SchemaConfigurationError(type);
  }
}

/** Optional string controls accept blank/null; nonblank values retain all declared constraints. */
export function scalarFieldSchema(
  type: FieldType,
  base: v.GenericSchema<string, string>,
  opts: { required?: boolean; defaultValue?: unknown },
) {
  const optional = v.nullable(v.union([base, v.literal('')]));
  assertFieldDefault(type, opts.required ? base : optional, opts.defaultValue);
  const defaultValue = opts.defaultValue === undefined ? '' : opts.defaultValue;
  if (typeof defaultValue !== 'string' && defaultValue !== null) {
    throw new SchemaConfigurationError(type);
  }
  return opts.required
    ? base
    : v.optional(optional, defaultValue);
}
