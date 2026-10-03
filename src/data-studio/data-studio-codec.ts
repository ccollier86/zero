/** Public, side-effect-free Data Studio codec facade. */

import type {
  DataStudioCellEncoding,
  DataStudioColumn,
  DataStudioValue,
} from './data-studio-contracts';
import { canonicalDataStudioJson } from './data-studio-codec-common';
import { normalizeDataStudioColumn } from './data-studio-schema-codec';
import { normalizeValueForDataStudioColumn } from './data-studio-value-codec';

export {
  normalizeDataStudioSchema,
  parseDataStudioSchema,
  serializeDataStudioSchema,
} from './data-studio-schema-codec';
export {
  normalizeDataStudioValue,
  parseDataStudioValue,
  serializeDataStudioValue,
} from './data-studio-value-codec';
export {
  normalizeDataStudioRowValues,
  normalizeDataStudioStoredRowValues,
  parseDataStudioRowValues,
  serializeDataStudioRowValues,
} from './data-studio-row-codec';

/** Validate one value against a logical column and return its canonical form. */
export function normalizeDataStudioValueForColumn(
  column: DataStudioColumn,
  value: unknown,
): DataStudioValue {
  return normalizeValueForDataStudioColumn(normalizeDataStudioColumn(column), value);
}

/** Produce canonical storage JSON and one mutually-exclusive query projection. */
export function encodeDataStudioCellValue(
  column: DataStudioColumn,
  value: unknown,
): DataStudioCellEncoding {
  const normalizedColumn = normalizeDataStudioColumn(column);
  const normalizedValue = normalizeValueForDataStudioColumn(normalizedColumn, value);
  const valueType = normalizedValue === null ? 'null' : normalizedColumn.type;
  return Object.freeze({
    value: normalizedValue,
    valueJson: canonicalDataStudioJson(normalizedValue),
    valueType,
    textValue: valueType === 'text' || valueType === 'date' || valueType === 'datetime'
      ? normalizedValue as string
      : null,
    numberValue: valueType === 'number' ? normalizedValue as number : null,
    booleanValue: valueType === 'boolean' ? (normalizedValue ? 1 : 0) : null,
  });
}
