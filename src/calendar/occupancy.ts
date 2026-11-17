/** Shared appointment/block/live-hold capacity-one checks inside one short writer decision. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseFindFilter } from '../databases/database-operations';
import { CalendarError } from './error';
import { eq } from './realm-model';
import { calendarOverlapSearchStart, type CalendarTimedInterval } from './time';
import { calendarNow } from './hold-time';

export function assertCalendarResourcesAvailable(context: DatabaseWriteCommandContext, scopeId: string,
  resourceIds: readonly string[], interval: CalendarTimedInterval, except?: { kind: 'appointment' | 'block' | 'hold'; id: string }, now = calendarNow()): void {
  for (const resourceId of resourceIds) for (const [table, kind, parent] of [
    ['_calendar_reservations', 'appointment', 'appointment_id'],
    ['_calendar_block_reservations', 'block', 'block_id'],
    ['_calendar_hold_reservations', 'hold', 'hold_id'],
  ] as const) {
    const filters: DatabaseFindFilter[] = [eq('scope_id', scopeId), eq('resource_id', resourceId), eq('active', 1),
      { type: 'field', field: 'occupied_start_ms', operator: 'gte', value: calendarOverlapSearchStart(interval.occupiedStartMs) },
      { type: 'field', field: 'occupied_start_ms', operator: 'lt', value: interval.occupiedEndMs },
      { type: 'field', field: 'occupied_end_ms', operator: 'gt', value: interval.occupiedStartMs }];
    if (except?.kind === kind) filters.push({ type: 'field', field: parent, operator: 'ne', value: except.id });
    if (kind === 'hold') filters.push({ type: 'field', field: 'expires_ms', operator: 'gt', value: now });
    // Expired holds remain immutable history. Use their expiry-first live index,
    // not an occupied-start scan across repeated reservations of the same future slot.
    if (context.db.find(table, { select: ['id'], filters,
      ...(kind === 'hold' ? { order: [{ field: 'expires_ms', direction: 'asc' as const }] } : {}), limit: 1 }).length) throw new CalendarError('CALENDAR_BOOKING_CONFLICT');
  }
}
