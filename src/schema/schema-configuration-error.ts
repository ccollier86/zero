/** Provides stable, value-free failures for invalid schema declaration defaults. */

import type { FieldType } from './field-types';

/** Invalid declared defaults are configuration failures, not mutation validation bypasses. */
export class SchemaConfigurationError extends Error {
  readonly code = 'SCHEMA_DEFAULT_INVALID';

  constructor(readonly fieldType: FieldType) {
    super(`Invalid default value for ${fieldType} field.`);
    this.name = 'SchemaConfigurationError';
  }
}
