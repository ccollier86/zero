/** Content-free operation messages; never reflect adapter exceptions or request values into the form. */
import { isDataStudioMutationError } from '../../frontend/client/data-studio-client';

/** Project known mutation outcomes without losing their ambiguous retry classification. */
export function dataStudioRowCreateFailure(cause: unknown): { message: string; uncertain: boolean } {
  if (!isDataStudioMutationError(cause)) return { message: 'Could not create this record. Your values are kept; please try again.', uncertain: false };
  if (cause.requiresSameIdempotencyKey) return { message: 'The result could not be confirmed. Retry this request without changing its values to avoid creating a duplicate.', uncertain: true };
  const messages = {
    DATA_STUDIO_AUTHORITY_REQUIRED: 'You do not have permission to add a record to this table.',
    DATA_STUDIO_AUTHORITY_CHANGED: 'Your access changed. Reopen Data Studio before creating a record.',
    DATA_STUDIO_TABLE_ARCHIVED: 'This table is archived. Restore it before adding records.',
    DATA_STUDIO_TABLE_NOT_FOUND: 'This table is no longer available. Choose another table.',
    DATA_STUDIO_REVISION_CONFLICT: 'The table changed. Reload its fields before creating the record.',
    DATA_STUDIO_VALUE_INVALID: 'These values do not match the current fields. Review the form and try again.',
    DATA_STUDIO_SCHEMA_INVALID: 'The table fields changed. Reload them before creating the record.',
    DATA_STUDIO_LIMIT_EXCEEDED: 'This record exceeds the application limits. Reduce its size or check the table quota.',
    DATA_STUDIO_IDEMPOTENCY_CONFLICT: 'This request could not be retried safely. Refresh the table before adding another record.',
  } as const;
  const message = cause.status === 403 ? 'You do not have permission to add a record to this table.'
    : cause.code && Object.hasOwn(messages, cause.code) ? messages[cause.code as keyof typeof messages]
      : 'Could not create this record. Your values are kept; please try again.';
  return { message, uncertain: false };
}
