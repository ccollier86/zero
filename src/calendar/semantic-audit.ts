/** Canonical source facts only. No title, scheduling instants, participants, labels or provider payload enters evidence. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { appendDatabaseCommandSourceAudit } from '../databases/database-command-source-audit';
import type { Change } from '../sync/types';
import type { LoggingScalar } from '../logging/logging-contracts';
import type { CalendarCommandReceipt } from './contracts';
import { CalendarError } from './error';
import { calendarHash } from './validation';

interface CalendarAuditMetadata {
  readonly revision: number;
  readonly resourceCount?: number;
  readonly locationCount?: number;
  readonly typeCount?: number;
  readonly mode?: 'unrestricted' | 'optional' | 'required';
  readonly active?: boolean;
  readonly status?: 'tentative' | 'confirmed' | 'completed' | 'no-show' | 'cancelled' | 'active' | 'held' | 'released';
  readonly policyRevision?: number;
  readonly reasonPresent?: boolean;
  readonly visitMode?: 'in-person' | 'video' | 'phone';
  readonly visitChanged?: boolean;
}

/** Call only inside an accepted mutation's callback; receipt replay and domain no-ops never reach this seam. */
export function appendCalendarSemanticAudit(context: DatabaseWriteCommandContext, operation: CalendarCommandReceipt['operation'] | 'hold.confirmed',
  change: Change | null, metadata: CalendarAuditMetadata): void {
  if (!change) throw new CalendarError('CALENDAR_STATE_INVALID');
  const values: Record<string, LoggingScalar> = { sequence: change.seq, revision: metadata.revision };
  if (metadata.resourceCount !== undefined) values.resourceCount = metadata.resourceCount;
  if (metadata.locationCount !== undefined) values.locationCount = metadata.locationCount;
  if (metadata.typeCount !== undefined) values.typeCount = metadata.typeCount;
  if (metadata.mode !== undefined) values.mode = metadata.mode;
  if (metadata.active !== undefined) values.active = metadata.active;
  if (metadata.status !== undefined) values.status = metadata.status;
  if (metadata.policyRevision !== undefined) values.policyRevision = metadata.policyRevision;
  if (metadata.reasonPresent !== undefined) values.reasonPresent = metadata.reasonPresent;
  if (metadata.visitMode !== undefined) values.visitMode = metadata.visitMode;
  if (metadata.visitChanged !== undefined) values.visitChanged = metadata.visitChanged;
  const action = 'calendar.' + operation;
  appendDatabaseCommandSourceAudit(context, {
    // A real mutation sequence identifies A -> B -> A transitions independently of transport retries.
    id: 'calendar:' + calendarHash([action, change.table, change.rowId, change.seq]),
    family: 'workflow', action, outcome: 'succeeded', occurredAt: change.ts,
    target: { type: operation.startsWith('lifecycle.') ? 'calendar.lifecycle-policy' : operation.startsWith('type.') ? 'calendar.appointment-type' : operation.startsWith('location.') ? 'calendar.location' : operation.startsWith('resource.') ? 'calendar.resource' : operation.startsWith('block.') ? 'calendar.block'
      : operation.startsWith('hold.') ? 'calendar.hold' : 'calendar.appointment', id: change.rowId },
    metadata: values,
  });
}
