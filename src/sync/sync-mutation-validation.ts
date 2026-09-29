/**
 * Server-side logical validation for websocket mutations.
 *
 * Schema-backed tables opt into this boundary through a server-only validator.
 * Raw SQL tables keep their historical behavior when no validator is present.
 */

import type { ReactiveDB } from './reactive-db';
import type {
  Row,
  SyncMutateMessage,
  SyncTableMutationValidator,
} from './types';

export type SyncMutationValidationResult =
  | { ok: true; row: Row | Partial<Row> | undefined }
  | { ok: false; error: string };

/**
 * Validate and normalize one mutation after policy stamping and before its
 * transaction begins. UPDATE validation uses the complete logical row while
 * returning only the validated fields included in the incoming partial.
 */
export function validateSyncMutation(
  db: ReactiveDB,
  table: string,
  op: SyncMutateMessage['op'],
  rowId: string | undefined,
  row: Row | Partial<Row> | undefined,
  validator: SyncTableMutationValidator | undefined,
): SyncMutationValidationResult {
  if (!validator || op === 'DELETE') return { ok: true, row };
  if (!row) return invalid(table, `${op} requires a row`);

  const sqlPrimaryKey = db.getPrimaryKey(table);
  if (validator.primaryKey !== sqlPrimaryKey) {
    return invalid(
      table,
      `validator primary key "${validator.primaryKey}" does not match SQL primary key "${sqlPrimaryKey}"`,
    );
  }

  const allowedFields = new Set([
    validator.primaryKey,
    ...validator.fieldNames,
  ]);
  const unknownFields = Object.keys(row).filter((field) => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    const noun = unknownFields.length === 1 ? 'field' : 'fields';
    return invalid(
      table,
      `unknown ${noun}: ${unknownFields.map((field) => `"${field}"`).join(', ')}`,
    );
  }

  if (op === 'INSERT') {
    const primaryKey = row[validator.primaryKey];
    const canDerivePrimaryKey = db.getIdentity(table).length > 0;
    if (
      !canDerivePrimaryKey
      && (primaryKey === undefined || primaryKey === null || primaryKey === '')
    ) {
      return invalid(table, `missing primary key "${validator.primaryKey}"`);
    }
    return validateCompleteRow(table, row as Row, validator);
  }

  if (!rowId) return invalid(table, 'UPDATE requires rowId');
  const existing = db.get(table, rowId);
  if (!existing) return { ok: false, error: `Row not found: ${rowId}` };

  if (Object.prototype.hasOwnProperty.call(row, validator.primaryKey)) {
    const submittedPrimaryKey = row[validator.primaryKey];
    const storedPrimaryKey = existing[validator.primaryKey];
    if (String(submittedPrimaryKey) !== String(storedPrimaryKey)) {
      return invalid(
        table,
        `cannot change primary key "${validator.primaryKey}" through UPDATE`,
      );
    }
  }

  const complete = {
    ...existing,
    ...row,
    [validator.primaryKey]: existing[validator.primaryKey],
  };
  const validated = validateCompleteRow(table, complete, validator);
  if (!validated.ok) return validated;

  const encodedComplete = validated.row as Row;
  const encodedPartial: Partial<Row> = {};
  for (const field of Object.keys(row)) {
    if (field !== validator.primaryKey) {
      encodedPartial[field] = encodedComplete[field];
    }
  }
  return { ok: true, row: encodedPartial };
}

function validateCompleteRow(
  table: string,
  row: Row,
  validator: SyncTableMutationValidator,
): SyncMutationValidationResult {
  try {
    const decoded = validator.decodeRow(row);
    const result = validator.validateRow(decoded);
    if (!result.success) {
      return invalid(table, formatIssues(result.issues));
    }

    return {
      ok: true,
      row: validator.encodeRow({ ...decoded, ...result.output }),
    };
  } catch {
    // Codec/validator implementations are app extension points. Their thrown
    // messages may contain row values, SQL, paths, or secrets, so only an
    // explicit validation result may contribute client-facing issue text.
    return invalid(table, 'logical row validation failed');
  }
}

function formatIssues(
  issues: readonly { path?: string; message: string }[],
): string {
  if (issues.length === 0) return 'logical row validation failed';
  return issues
    .map((issue) => issue.path ? `${issue.path}: ${issue.message}` : issue.message)
    .join('; ');
}

function invalid(table: string, detail: string): SyncMutationValidationResult {
  return { ok: false, error: `Invalid row for table "${table}": ${detail}` };
}
