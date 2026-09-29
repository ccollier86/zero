/** Row and wire validation for actor-backed tenant Sync mutations. */

import type {
  Row,
  SyncMutateMessage,
  SyncResourceMutationScope,
  SyncTableMutationValidator,
} from './types';
import type { SyncTenantDataPlaneTable } from './sync-tenant-data-plane-contract';

interface TenantMutationRowReader {
  table(table: string): SyncTenantDataPlaneTable | null;
  loadRow(table: string, rowId: string): Promise<Row | null>;
}

export type TenantMutationValidation =
  | { ok: true; row: Row | Partial<Row> | undefined; existing?: Row }
  | { ok: false; error: string };

/** Validate the small routing envelope before any policy or actor work. */
export function validTenantMutationRequest(message: SyncMutateMessage): boolean {
  if (!message
    || typeof message.ref !== 'string'
    || message.ref.length === 0
    || message.ref.length > 128
    || typeof message.table !== 'string'
    || !['INSERT', 'UPDATE', 'DELETE'].includes(message.op)
    || (message.plane !== undefined
      && message.plane !== 'default'
      && message.plane !== 'tenant')
    || (message.epoch !== undefined && typeof message.epoch !== 'string')
    || (message.attempt !== undefined
      && (!Number.isSafeInteger(message.attempt) || message.attempt < 1))) {
    return false;
  }
  if (message.op === 'INSERT'
    && (!message.row || typeof message.row !== 'object' || Array.isArray(message.row))) {
    return false;
  }
  if (message.op === 'UPDATE'
    && (typeof message.rowId !== 'string'
      || !message.row
      || typeof message.row !== 'object'
      || Array.isArray(message.row))) return false;
  return message.op !== 'DELETE' || typeof message.rowId === 'string';
}

/** Validate and canonicalize a row against the actor and app table schemas. */
export async function validateTenantMutationRow(
  reader: TenantMutationRowReader,
  table: string,
  op: SyncMutateMessage['op'],
  rowId: string | undefined,
  row: Row | Partial<Row> | undefined,
  validator: SyncTableMutationValidator | undefined,
  authorizedExisting: Row | undefined,
): Promise<TenantMutationValidation> {
  const definition = reader.table(table);
  if (!definition) return invalid(table, 'table is not declared by the tenant data plane');
  if (validator && validator.primaryKey !== definition.primaryKey) {
    return invalid(
      table,
      `validator primary key "${validator.primaryKey}" does not match actor primary key "${definition.primaryKey}"`,
    );
  }

  if (op === 'INSERT') {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return invalid(table, 'INSERT requires a row');
    }
    if (!validator) return { ok: true, row };
    const unknown = unknownFields(row, validator);
    if (unknown) return invalid(table, unknown);
    const id = row[definition.primaryKey];
    if ((definition.identity?.length ?? 0) === 0
      && (id === undefined || id === null || id === '')) {
      return invalid(table, `missing primary key "${definition.primaryKey}"`);
    }
    const complete = validateCompleteRow(table, row as Row, validator);
    return complete.ok ? { ok: true, row: complete.row } : complete;
  }

  if (!rowId || typeof rowId !== 'string') {
    return invalid(table, `${op} requires rowId`);
  }
  const existing = authorizedExisting ?? await reader.loadRow(table, rowId) ?? undefined;
  if (!existing) return { ok: false, error: `Row not found: ${rowId}` };
  if (op === 'DELETE') return { ok: true, row, existing };
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return invalid(table, 'UPDATE requires row (partial)');
  }
  if (!validator) return { ok: true, row, existing };
  const unknown = unknownFields(row, validator);
  if (unknown) return invalid(table, unknown);
  if (Object.hasOwn(row, definition.primaryKey)
    && String(row[definition.primaryKey]) !== String(existing[definition.primaryKey])) {
    return invalid(
      table,
      `cannot change primary key "${definition.primaryKey}" through UPDATE`,
    );
  }
  const complete = validateCompleteRow(table, {
    ...existing,
    ...row,
    [definition.primaryKey]: existing[definition.primaryKey],
  }, validator);
  if (!complete.ok) return complete;
  const partial: Partial<Row> = {};
  for (const field of Object.keys(row)) {
    if (field !== definition.primaryKey) partial[field] = complete.row[field];
  }
  return { ok: true, row: partial, existing };
}

export function tenantMutationMatchesScope(
  row: Row | Partial<Row> | undefined,
  scope: SyncResourceMutationScope | undefined,
): boolean {
  if (!scope) return true;
  return Boolean(row) && row![scope.field] === scope.value;
}

function validateCompleteRow(
  table: string,
  row: Row,
  validator: SyncTableMutationValidator,
): { ok: true; row: Row } | { ok: false; error: string } {
  try {
    const decoded = validator.decodeRow(row);
    const result = validator.validateRow(decoded);
    if (!result.success) {
      const detail = result.issues.length === 0
        ? 'logical row validation failed'
        : result.issues.map((issue) => (
          issue.path ? `${issue.path}: ${issue.message}` : issue.message
        )).join('; ');
      return invalid(table, detail);
    }
    return {
      ok: true,
      row: validator.encodeRow({ ...decoded, ...result.output }),
    };
  } catch {
    // Extension exceptions are not validation details. Keep arbitrary row,
    // filesystem, and provider data out of the wire acknowledgement.
    return invalid(table, 'logical row validation failed');
  }
}

function unknownFields(
  row: Row | Partial<Row>,
  validator: SyncTableMutationValidator,
): string | null {
  const allowed = new Set([validator.primaryKey, ...validator.fieldNames]);
  const unknown = Object.keys(row).filter((field) => !allowed.has(field));
  if (unknown.length === 0) return null;
  return `unknown ${unknown.length === 1 ? 'field' : 'fields'}: ${unknown
    .map((field) => `"${field}"`).join(', ')}`;
}

function invalid(table: string, detail: string): { ok: false; error: string } {
  return { ok: false, error: `Invalid row for table "${table}": ${detail}` };
}
