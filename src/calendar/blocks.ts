/** Canonical private one-off blocks. Manage is required on every resource; conflicts never cancel other records. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarCommandReceipt } from './contracts';
import { blockReservationId, blockView, calendarBlock, readCalendarBlockResource, readCalendarBlockResourceIds,
  readCalendarBlockTarget, type CalendarBlockRow } from './blocks-model';
import { CalendarError, calendarCommand } from './error';
import { assertCalendarResourcesAvailable } from './occupancy';
import { assertCalendarOwner, calendarActor, calendarBudget, calendarIntent, calendarResource, calendarRevision,
  calendarSelection, CALENDAR_LIMITS, nextCalendarRevision, requireCalendarRight } from './realm-model';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { calendarOverlapSearchStart, normalizeCalendarInstant, normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarInteger, calendarKey, calendarRecord, calendarText } from './validation';

function receipt(requestId: string, operation: CalendarCommandReceipt['operation'], id: string, revision: number, changed = true): CalendarCommandReceipt {
  return { requestId, operation, id, revision, changed };
}
function intervalFields(interval: CalendarTimedInterval) {
  return { start_at: interval.startAt, end_at: interval.endAt, start_ms: interval.startMs, end_ms: interval.endMs, time_zone: interval.timeZone };
}
function interval(r: Record<string, unknown>): CalendarTimedInterval {
  // Block inputs deliberately have no buffers. The same positive <=31-day admission bounds the shared overlap index.
  return normalizeCalendarTimedInterval({ startAt: r.startAt, endAt: r.endAt, timeZone: r.timeZone, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
}

export function createCalendarBlock(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'resourceIds', 'title', 'startAt', 'endAt', 'timeZone']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const id = calendarKey(r.id), title = calendarText(r.title, 512), resourceIds = calendarSelection(r.resourceIds), timed = interval(r);
    if (!resourceIds.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
    for (const resourceId of resourceIds) {
      const resource = calendarResource(context, actor, resourceId); requireCalendarRight(context, actor, resource, 'manage');
      if (!resource.active) throw new CalendarError('CALENDAR_FORBIDDEN');
    }
    return calendarIntent(context, actor, r.requestId, ['block.create', id, resourceIds, title, timed], 'block', 'manage', requestId => {
      if (context.db.get('calendar_blocks', id)) {
        calendarBlock(context, actor, id, 'manage');
        throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      }
      assertCalendarResourcesAvailable(context, actor.scopeId, resourceIds, timed); calendarBudget(context, 'blocks');
      const change = context.db.createStrict('calendar_blocks', { id, scope_id: actor.scopeId, title, ...intervalFields(timed), status: 'active', revision: 1, created_by: actor.userId });
      for (const resourceId of resourceIds) context.db.createStrict('_calendar_block_reservations', { id: blockReservationId(actor.scopeId, id, resourceId),
        scope_id: actor.scopeId, block_id: id, resource_id: resourceId, occupied_start_ms: timed.startMs, occupied_end_ms: timed.endMs, active: 1 });
      appendCalendarSemanticAudit(context, 'block.created', change, { revision: 1, resourceCount: resourceIds.length, status: 'active' });
      return receipt(requestId, 'block.created', id, 1);
    });
  });
}

export function rescheduleCalendarBlock(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'startAt', 'endAt', 'timeZone']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const { row, resourceIds } = calendarBlock(context, actor, r.id, 'manage'), expectedRevision = calendarInteger(r.expectedRevision, 1), timed = interval(r);
    return calendarIntent(context, actor, r.requestId, ['block.reschedule', row.id, expectedRevision, timed], 'block', 'manage', requestId => {
      calendarRevision(row, expectedRevision);
      if (row.status !== 'active') throw new CalendarError('CALENDAR_REVISION_CONFLICT');
      if (Object.entries(intervalFields(timed)).every(([key, value]) => row[key] === value)) return receipt(requestId, 'block.rescheduled', row.id, row.revision, false);
      for (const id of resourceIds) if (!calendarResource(context, actor, id).active) throw new CalendarError('CALENDAR_FORBIDDEN');
      assertCalendarResourcesAvailable(context, actor.scopeId, resourceIds, timed, { kind: 'block', id: row.id });
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_blocks', row.id, { ...intervalFields(timed), revision });
      for (const id of resourceIds) context.db.update('_calendar_block_reservations', blockReservationId(actor.scopeId, row.id, id), {
        occupied_start_ms: timed.startMs, occupied_end_ms: timed.endMs });
      appendCalendarSemanticAudit(context, 'block.rescheduled', change, { revision, resourceCount: resourceIds.length, status: 'active' });
      return receipt(requestId, 'block.rescheduled', row.id, revision);
    });
  });
}

export function cancelCalendarBlock(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'confirmed']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const { row, resourceIds } = calendarBlock(context, actor, r.id, 'manage'), expectedRevision = calendarInteger(r.expectedRevision, 1);
    if (r.confirmed !== true) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return calendarIntent(context, actor, r.requestId, ['block.cancel', row.id, expectedRevision], 'block', 'manage', requestId => {
      calendarRevision(row, expectedRevision);
      if (row.status === 'cancelled') return receipt(requestId, 'block.cancelled', row.id, row.revision, false);
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_blocks', row.id, { status: 'cancelled', revision });
      for (const id of resourceIds) context.db.update('_calendar_block_reservations', blockReservationId(actor.scopeId, row.id, id), { active: 0 });
      appendCalendarSemanticAudit(context, 'block.cancelled', change, { revision, resourceCount: resourceIds.length, status: 'cancelled' });
      return receipt(requestId, 'block.cancelled', row.id, revision);
    });
  });
}

function readOwner(context: DatabaseReadQueryContext, scopeId: string): void {
  const owner = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get();
  if (!owner || owner.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}

export function readCalendarBlock(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); readOwner(context, actor.scopeId);
  const { row, resourceIds } = readCalendarBlockTarget(context, actor, calendarKey(r.id), 'details');
  return blockView(row, resourceIds);
}

export function queryCalendarBlocks(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'resourceIds', 'startAt', 'endAt', 'limit']), actor = calendarActor(r.actor), ids = calendarSelection(r.resourceIds);
  const startMs = Date.parse(normalizeCalendarInstant(r.startAt)), endMs = Date.parse(normalizeCalendarInstant(r.endAt));
  calendarInteger(endMs - startMs, 1, CALENDAR_LIMITS.rangeMs);
  const limit = calendarInteger(r.limit ?? 100, 1, CALENDAR_LIMITS.page); readOwner(context, actor.scopeId);
  for (const id of ids) readCalendarBlockResource(context, actor, id, 'details');
  if (!ids.length) return { items: [], truncated: false };
  const placeholders = ids.map(() => '?').join(',');
  const right = actor.manageAll ? { sql: '1=1', params: [] as string[] } : {
    sql: '(resource.owner_id IS ? OR EXISTS(SELECT 1 FROM _calendar_grants g WHERE g.scope_id=resource.scope_id AND g.resource_id=resource.id AND g.user_id=? AND (g.manage=1 OR g.details=1)))',
    params: [actor.userId, actor.userId],
  };
  // All co-resources are authorized before LIMIT: private IDs never affect visible membership or truncation.
  const rows = context.database.query<CalendarBlockRow>(`SELECT b.* FROM calendar_blocks b WHERE b.scope_id=? AND b.status='active' AND b.start_ms>=? AND b.start_ms<? AND b.end_ms>?
    AND EXISTS(SELECT 1 FROM _calendar_block_reservations selected WHERE selected.scope_id=b.scope_id AND selected.block_id=b.id AND selected.resource_id IN (${placeholders}))
    AND NOT EXISTS(SELECT 1 FROM _calendar_block_reservations rr LEFT JOIN calendar_resources resource ON resource.id=rr.resource_id AND resource.scope_id=rr.scope_id WHERE rr.scope_id=b.scope_id AND rr.block_id=b.id AND (resource.id IS NULL OR NOT ${right.sql}))
    ORDER BY b.start_ms,b.id LIMIT ?`).all(actor.scopeId, calendarOverlapSearchStart(startMs), endMs, startMs, ...ids, ...right.params, limit + 1);
  return { items: rows.slice(0, limit).map(row => blockView(row, readCalendarBlockResourceIds(context, actor.scopeId, row.id))), truncated: rows.length > limit };
}
