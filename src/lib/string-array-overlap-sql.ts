/**
 * Parameterized SQLite JSON1 implementation of exact string-array overlap.
 * Consumes already-quoted column expressions and bounded policy values; it
 * never accepts table/field selectors or installs database-specific functions.
 */

import {
  STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES,
  STRING_ARRAY_OVERLAP_MAX_RETAINED_VALUES,
  STRING_ARRAY_OVERLAP_MAX_VALUE_BYTES,
  validateStringArrayOverlapValues,
} from './string-array-overlap';

/**
 * Return a guarded predicate and append one bind per permitted value. CASE
 * boundaries keep malformed/non-array JSON away from JSON1 iterators. EXISTS
 * avoids duplicate rows, and BINARY text equality avoids affinity/collation.
 */
export function buildStringArrayOverlapSql(
  columnSQL: string,
  permitted: readonly string[],
  params: { push(...values: string[]): unknown },
): string {
  const validated = validateStringArrayOverlapValues(permitted);
  if (!validated.ok) throw new TypeError('Invalid string-array overlap values.');
  if (validated.value.length === 0) return '0';
  params.push(...validated.value);
  // Snapshot the expression outside every JSON iterator scope. A real table
  // column named `value`, `type`, or `key` must not bind to json_each's columns.
  const source = '_zero_overlap_source.json_value';
  const item = '_zero_overlap_item';
  const value = `${item}.value`;
  return `(SELECT CASE WHEN typeof(${source}) = 'text'
    AND length(CAST(${source} AS BLOB)) <= ${STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES}
    THEN CASE WHEN json_valid(${source}) = 1
    THEN CASE WHEN json_type(${source}) = 'array'
    THEN CASE WHEN json_array_length(${source}) <= ${STRING_ARRAY_OVERLAP_MAX_RETAINED_VALUES}
    THEN CASE WHEN NOT EXISTS (
      SELECT 1 FROM json_each(${source}) AS ${item}
      WHERE ${item}.type != 'text'
        OR length(CAST(${value} AS BLOB)) > ${STRING_ARRAY_OVERLAP_MAX_VALUE_BYTES}
        OR ${invalidUtf8Sql(value)}
    ) THEN EXISTS (
      SELECT 1 FROM json_each(${source}) AS ${item}
      WHERE ${item}.type = 'text'
        AND ${value} COLLATE BINARY IN (${validated.value.map(() => '?').join(', ')})
    ) ELSE 0 END ELSE 0 END ELSE 0 END ELSE 0 END ELSE 0 END
    FROM (SELECT (${columnSQL}) AS json_value) AS _zero_overlap_source)`;
}

/**
 * SQLite accepts lone-surrogate JSON escapes and exposes WTF-8 text. Validate
 * exact byte-aligned UTF-8 code points, including bytes after embedded NUL;
 * text length/substr and unaligned hex GLOB checks are not safe substitutes.
 * Work is bounded by the outer per-string/retained-byte admission limits.
 */
function invalidUtf8Sql(value: string): string {
  const next = 'position + width';
  // The common printable-ASCII path needs no code-point walk. The byte/text
  // length agreement is essential: SQLite GLOB stops at embedded NUL.
  return `(CASE WHEN length(CAST(${value} AS BLOB)) = length(${value})
    AND ${value} NOT GLOB '*[^ -~]*' THEN 0 ELSE EXISTS (
    WITH RECURSIVE _zero_overlap_utf8(hex_value, position, width) AS (
      SELECT hex_value, 1, ${utf8WidthSql('1')}
      FROM (SELECT hex(CAST(${value} AS BLOB)) AS hex_value)
      WHERE length(hex_value) > 0
      UNION ALL
      SELECT hex_value, ${next}, ${utf8WidthSql(next)}
      FROM _zero_overlap_utf8
      WHERE width > 0 AND (${next}) * 2 <= length(hex_value)
    ) SELECT 1 FROM _zero_overlap_utf8 WHERE width = 0
  ) END)`;
}

function utf8WidthSql(position: string): string {
  const at = (bytes: number) => `substr(hex_value, ((${position}) - 1) * 2 + 1, ${bytes * 2})`;
  return `(CASE
    WHEN ${at(1)} GLOB '[0-7][0-9A-F]' THEN 1
    WHEN ${at(2)} GLOB 'C[2-F][8-B][0-9A-F]'
      OR ${at(2)} GLOB 'D[0-F][8-B][0-9A-F]' THEN 2
    WHEN ${at(3)} GLOB 'E0[A-B][0-9A-F][8-B][0-9A-F]'
      OR ${at(3)} GLOB 'E[1-C][8-B][0-9A-F][8-B][0-9A-F]'
      OR ${at(3)} GLOB 'ED[8-9][0-9A-F][8-B][0-9A-F]'
      OR ${at(3)} GLOB 'E[E-F][8-B][0-9A-F][8-B][0-9A-F]' THEN 3
    WHEN ${at(4)} GLOB 'F0[9-B][0-9A-F][8-B][0-9A-F][8-B][0-9A-F]'
      OR ${at(4)} GLOB 'F[1-3][8-B][0-9A-F][8-B][0-9A-F][8-B][0-9A-F]'
      OR ${at(4)} GLOB 'F48[0-F][8-B][0-9A-F][8-B][0-9A-F]' THEN 4
    ELSE 0 END)`;
}
