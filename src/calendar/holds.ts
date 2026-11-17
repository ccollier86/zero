/** Authenticated short leases in the canonical appointment/block conflict transaction. No timers or external effects. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import { assertCalendarAvailability } from './availability-model';
import { CalendarError, calendarCommand } from './error';
import { calendarNow } from './hold-time';
import { calendarHold, CALENDAR_HOLD_LIMITS, holdReservationId, holdView, isCalendarHoldSubject,
  readCalendarHoldResourceIds, readCalendarHoldTarget, type CalendarHoldRow } from './holds-model';
import { assertCalendarResourcesAvailable } from './occupancy';
import { commitCalendarAppointment } from './realm-commands';
import { assertCalendarOwner, calendarActor, calendarBudget, calendarIntent, calendarResource, calendarRevision,
  calendarSelection, CALENDAR_LIMITS, eq, grantId, hasCalendarRight, nextCalendarRevision, requireCalendarRight, type CalendarResourceRow } from './realm-model';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { calendarOverlapSearchStart, normalizeCalendarInstant, normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarInteger, calendarKey, calendarRecord, calendarText } from './validation';
import { assertCalendarBookingType, bindCalendarHoldType, calendarAppointmentTypeReference, calendarHoldAppointmentType,
  normalizeCalendarTypedBooking, normalizeCalendarTypedIntentInterval, readCalendarHoldTypeSnapshot } from './appointment-type-bindings';

function receipt(requestId: string, operation: CalendarCommandReceipt['operation'], id: string, revision: number, changed = true): CalendarCommandReceipt {
  return { requestId, operation, id, revision, changed };
}
function timed(r: Record<string, unknown>): CalendarTimedInterval {
  return normalizeCalendarTimedInterval({ startAt: r.startAt, endAt: r.endAt, timeZone: r.timeZone,
    bufferBeforeMinutes: r.bufferBeforeMinutes, bufferAfterMinutes: r.bufferAfterMinutes });
}
function intervalFields(interval: CalendarTimedInterval) {
  return { start_at: interval.startAt, end_at: interval.endAt, start_ms: interval.startMs, end_ms: interval.endMs, time_zone: interval.timeZone,
    buffer_before: interval.bufferBeforeMinutes, buffer_after: interval.bufferAfterMinutes,
    occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs };
}
function assertLiveQuota(context: DatabaseWriteCommandContext, actor: CalendarActor, now: number): void {
  const filters = [eq('scope_id', actor.scopeId), eq('status', 'held'), { type: 'field' as const, field: 'expires_ms', operator: 'gt' as const, value: now }];
  const order = [{ field: 'expires_ms', direction: 'asc' as const }];
  // Indexed, bounded live probes: retained expired history never consumes active quota or requires a sweeping timer.
  if (context.db.find('calendar_holds', { select: ['id'], filters: [...filters, eq('principal', actor.principal)], order, limit: CALENDAR_HOLD_LIMITS.principal }).length >= CALENDAR_HOLD_LIMITS.principal
    || context.db.find('calendar_holds', { select: ['id'], filters, order, limit: CALENDAR_HOLD_LIMITS.scope }).length >= CALENDAR_HOLD_LIMITS.scope) throw new CalendarError('CALENDAR_CAPACITY');
}

export function acquireCalendarHold(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'ttlSeconds', 'appointmentType']);
    const actor = calendarActor(r.actor); assertCalendarOwner(context, actor.scopeId);
    const id = calendarKey(r.id), resourceIds = calendarSelection(r.resourceIds);
    const ttl = calendarInteger(r.ttlSeconds === undefined ? CALENDAR_HOLD_LIMITS.ttl : r.ttlSeconds, 1, CALENDAR_HOLD_LIMITS.maxTtl);
    if (!resourceIds.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
    for (const resourceId of resourceIds) {
      const resource = calendarResource(context, actor, resourceId); requireCalendarRight(context, actor, resource, 'book');
      if (!resource.active) throw new CalendarError('CALENDAR_FORBIDDEN');
    }
    const typeRef = calendarAppointmentTypeReference(r.appointmentType);
    const interval = typeRef ? undefined : timed(r);
    const intent: unknown[] = typeRef ? ['hold.acquire.typed.v1', id, resourceIds, normalizeCalendarTypedIntentInterval(r), ttl, typeRef]
      : ['hold.acquire', id, resourceIds, interval, ttl];
    return calendarIntent(context, actor, r.requestId, intent, 'hold', 'book', requestId => {
      if (context.db.get('calendar_holds', id)) {
        calendarHold(context, actor, id); throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      }
      const booking = typeRef ? normalizeCalendarTypedBooking(context, actor, resourceIds, r, typeRef) : { interval: interval!, appointmentType: undefined };
      const { interval: acceptedInterval, appointmentType } = booking;
      const now = calendarNow();
      if (acceptedInterval.startMs <= now) throw new CalendarError('CALENDAR_INPUT_INVALID');
      assertCalendarBookingType(context, actor, resourceIds, acceptedInterval, appointmentType);
      assertLiveQuota(context, actor, now);
      assertCalendarAvailability(context, actor.scopeId, resourceIds, acceptedInterval);
      assertCalendarResourcesAvailable(context, actor.scopeId, resourceIds, acceptedInterval, undefined, now);
      calendarBudget(context, 'holds');
      const expiresMs = Math.min(now + ttl * 1_000, acceptedInterval.startMs);
      const change = context.db.createStrict('calendar_holds', { id, scope_id: actor.scopeId, principal: actor.principal,
        created_by: actor.userId, created_ms: now, revision: 1, ...intervalFields(acceptedInterval), status: 'held', expires_ms: expiresMs, appointment_id: null });
      if (appointmentType) bindCalendarHoldType(context, actor.scopeId, id, appointmentType);
      for (const resourceId of resourceIds) context.db.createStrict('_calendar_hold_reservations', {
        id: holdReservationId(actor.scopeId, id, resourceId), scope_id: actor.scopeId, hold_id: id, resource_id: resourceId,
        resource_revision: calendarResource(context, actor, resourceId).revision,
        occupied_start_ms: acceptedInterval.occupiedStartMs, occupied_end_ms: acceptedInterval.occupiedEndMs, expires_ms: expiresMs, active: 1,
      });
      appendCalendarSemanticAudit(context, 'hold.acquired', change, { revision: 1, resourceCount: resourceIds.length, status: 'held' });
      return receipt(requestId, 'hold.acquired', id, 1);
    });
  });
}

export function releaseCalendarHold(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'confirmed']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const { row, resourceIds, reservations } = calendarHold(context, actor, r.id), expectedRevision = calendarInteger(r.expectedRevision, 1);
    if (r.confirmed !== true) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return calendarIntent(context, actor, r.requestId, ['hold.release', row.id, expectedRevision], 'hold', 'book', requestId => {
      calendarRevision(row, expectedRevision);
      if (row.status === 'confirmed') throw new CalendarError('CALENDAR_HOLD_STALE');
      if (row.status === 'released') return receipt(requestId, 'hold.released', row.id, row.revision, false);
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_holds', row.id, { status: 'released', revision });
      for (const reservation of reservations) context.db.update('_calendar_hold_reservations', reservation.id, { active: 0 });
      appendCalendarSemanticAudit(context, 'hold.released', change, { revision, resourceCount: resourceIds.length, status: 'released' });
      return receipt(requestId, 'hold.released', row.id, revision);
    });
  });
}

export function confirmCalendarHold(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'appointmentId', 'expectedRevision', 'title']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const { row, resourceIds, reservations } = calendarHold(context, actor, r.id), expectedRevision = calendarInteger(r.expectedRevision, 1);
    const appointmentId = calendarKey(r.appointmentId), title = calendarText(r.title, 512);
    if (!isCalendarHoldSubject(actor, row)) throw new CalendarError('CALENDAR_NOT_FOUND');
    for (const resourceId of resourceIds) requireCalendarRight(context, actor, calendarResource(context, actor, resourceId), 'book');
    return calendarIntent(context, actor, r.requestId, ['hold.confirm', row.id, appointmentId, expectedRevision, title], 'appointment', 'book', requestId => {
      calendarRevision(row, expectedRevision);
      if (row.status !== 'held') throw new CalendarError('CALENDAR_HOLD_STALE');
      const now = calendarNow();
      if (row.expires_ms <= now) throw new CalendarError('CALENDAR_HOLD_EXPIRED');
      for (const reservation of reservations) {
        if (calendarResource(context, actor, reservation.resource_id).revision !== reservation.resource_revision) throw new CalendarError('CALENDAR_HOLD_STALE');
      }
      const interval = timed({ startAt: row.start_at, endAt: row.end_at, timeZone: row.time_zone,
        bufferBeforeMinutes: row.buffer_before, bufferAfterMinutes: row.buffer_after });
      // The trusted exception is only this hold. The appointment helper still freshly checks every book/active/policy/conflict boundary.
      commitCalendarAppointment(context, actor, appointmentId, title, resourceIds, interval,
        { now, exceptHoldId: row.id, appointmentType: calendarHoldAppointmentType(context, actor.scopeId, row.id) });
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_holds', row.id, { status: 'confirmed', revision, appointment_id: appointmentId });
      for (const reservation of reservations) context.db.update('_calendar_hold_reservations', reservation.id, { active: 0 });
      appendCalendarSemanticAudit(context, 'hold.confirmed', change, { revision, resourceCount: resourceIds.length, status: 'confirmed' });
      return receipt(requestId, 'appointment.created', appointmentId, 1);
    });
  });
}

function readOwner(context: DatabaseReadQueryContext, scopeId: string): void {
  const owner = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get();
  if (!owner || owner.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
export function readCalendarHold(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); readOwner(context, actor.scopeId);
  const { row, resourceIds } = readCalendarHoldTarget(context, actor, calendarKey(r.id));
  return holdView(row, resourceIds, calendarNow(), readCalendarHoldTypeSnapshot(context, actor.scopeId, row.id));
}
function rightSql(actor: CalendarActor, right: 'book' | 'manage'): { sql: string; params: string[] } {
  if (actor.manageAll) return { sql: '1=1', params: [] };
  return { sql: `(resource.owner_id IS ? OR EXISTS(SELECT 1 FROM _calendar_grants g WHERE g.scope_id=resource.scope_id AND g.resource_id=resource.id AND g.user_id=? AND (g.manage=1${right === 'book' ? ' OR g.book=1' : ''})))`,
    params: [actor.userId, actor.userId] };
}
export function queryCalendarHolds(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'resourceIds', 'startAt', 'endAt', 'limit']), actor = calendarActor(r.actor), ids = calendarSelection(r.resourceIds);
  const startMs = Date.parse(normalizeCalendarInstant(r.startAt)), endMs = Date.parse(normalizeCalendarInstant(r.endAt));
  calendarInteger(endMs - startMs, 1, CALENDAR_LIMITS.rangeMs);
  const limit = calendarInteger(r.limit ?? 100, 1, CALENDAR_LIMITS.page); readOwner(context, actor.scopeId);
  for (const id of ids) {
    const resource = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(id, actor.scopeId);
    if (!resource) throw new CalendarError('CALENDAR_NOT_FOUND');
    const grant = context.database.query<Row>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?').get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
    if (!hasCalendarRight(actor, resource, grant, 'book') && !hasCalendarRight(actor, resource, grant, 'details')) throw new CalendarError('CALENDAR_NOT_FOUND');
  }
  if (!ids.length) return { items: [], truncated: false };
  const now = calendarNow(), book = rightSql(actor, 'book'), manage = rightSql(actor, 'manage'), placeholders = ids.map(() => '?').join(',');
  const unauthorized = (sql: string) => `EXISTS(SELECT 1 FROM _calendar_hold_reservations rr LEFT JOIN calendar_resources resource ON resource.id=rr.resource_id AND resource.scope_id=rr.scope_id WHERE rr.scope_id=h.scope_id AND rr.hold_id=h.id AND (resource.id IS NULL OR NOT ${sql}))`;
  // Subject binding and all-co-resource rights are filtered before LIMIT, so private IDs cannot affect membership or truncation.
  const rows = context.database.query<CalendarHoldRow>(`SELECT h.* FROM calendar_holds h WHERE h.scope_id=? AND h.status='held' AND h.expires_ms>?
    AND h.occupied_start_ms>=? AND h.occupied_start_ms<? AND h.occupied_end_ms>?
    AND EXISTS(SELECT 1 FROM _calendar_hold_reservations selected WHERE selected.scope_id=h.scope_id AND selected.hold_id=h.id AND selected.resource_id IN (${placeholders}))
    AND ((h.principal=? AND h.created_by=? AND NOT ${unauthorized(book.sql)}) OR NOT ${unauthorized(manage.sql)})
    ORDER BY h.occupied_start_ms,h.id LIMIT ?`).all(actor.scopeId, now, calendarOverlapSearchStart(startMs), endMs, startMs,
    ...ids, actor.principal, actor.userId, ...book.params, ...manage.params, limit + 1);
  return { items: rows.slice(0, limit).map(row => holdView(row, readCalendarHoldResourceIds(context, actor.scopeId, row.id), now,
    readCalendarHoldTypeSnapshot(context, actor.scopeId, row.id))), truncated: rows.length > limit };
}
