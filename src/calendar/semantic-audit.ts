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
  readonly status?: 'confirmed' | 'cancelled' | 'active';
}

/** Call only inside an accepted mutation's callback; receipt replay and domain no-ops never reach this seam. */
export function appendCalendarSemanticAudit(context: DatabaseWriteCommandContext, operation: CalendarCommandReceipt['operation'],
  change: Change | null, metadata: CalendarAuditMetadata): void {
  if (!change) throw new CalendarError('CALENDAR_STATE_INVALID');
  const values: Record<string, LoggingScalar> = { sequence: change.seq, revision: metadata.revision };
  if (metadata.resourceCount !== undefined) values.resourceCount = metadata.resourceCount;
  if (metadata.status !== undefined) values.status = metadata.status;
  const action = 'calendar.' + operation;
  appendDatabaseCommandSourceAudit(context, {
    // A real mutation sequence identifies A -> B -> A transitions independently of transport retries.
    id: 'calendar:' + calendarHash([action, change.table, change.rowId, change.seq]),
    family: 'workflow', action, outcome: 'succeeded', occurredAt: change.ts,
    target: { type: operation.startsWith('resource.') ? 'calendar.resource' : operation.startsWith('block.') ? 'calendar.block' : 'calendar.appointment', id: change.rowId },
    metadata: values,
  });
}
