/** Private selected-child reads. Selection and complete resource admission
 * precede pagination; accepted snapshots are never re-resolved through today's
 * catalogs or timezone engine. Nothing here grants mutation authority. */
import type { DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarAppointmentPage, CalendarAppointmentTypeSnapshot, CalendarAppointmentView, CalendarBusyPage,
  CalendarGrant, CalendarParticipantReference, CalendarVisitSnapshot } from './contracts';
import type { CalendarBookingCandidate } from './booking-admission';
import type { CalendarTimedInterval } from './time';
import { CalendarError } from './error';
import { calendarActor, calendarSelection, CALENDAR_LIMITS, type CalendarAppointmentRow } from './realm-model';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarScope, calendarText } from './validation';
import { calendarParticipantReferences } from './participants-validation';
import { calendarOverlapSearchStart, normalizeCalendarInstant } from './time';
import { admitCalendarReadRange, findCalendarOrdinaryAppointmentTarget, readCalendarAppointmentResourceIds, readCalendarOrdinaryAppointmentRange,
  readCalendarOrdinaryAppointmentView, readCalendarOrdinaryBusyRange, readCalendarResourceForRight, type CalendarBusyReadRow } from './realm-queries';
import { readCalendarResourceMembershipTable } from './appointment-resource-bindings';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as native } from './realm-series-materialization-migration';
import { CALENDAR_SERIES_CHILD_TABLES as t, CALENDAR_SERIES_CHILD_LIMITS } from './realm-series-children-migration';
import { readCalendarAppointmentParticipants } from './participant-bindings';
import { calendarSeriesCurrentChildHeadSql, calendarSeriesQualifiedChildViewSql } from './series-child-selection-sql';

export const CALENDAR_SERIES_CHILD_TARGET_QUERY = 'calendar.series.childTarget';
export const CALENDAR_SERIES_CHILD_QUERY = 'calendar.series.child';
export const CALENDAR_SERIES_CHILDREN_QUERY = 'calendar.series.children';
export const CALENDAR_SERIES_CHILD_BUSY_QUERY = 'calendar.series.childBusy';
export const CALENDAR_SERIES_CHILD_PARTICIPANTS_QUERY = 'calendar.series.childParticipants';
export const CALENDAR_SERIES_CHILD_MANAGE_TARGET_QUERY = 'calendar.series.childManageTarget';
/** An explicit private work budget, not a silent partial-result limit. */
export const CALENDAR_SERIES_READ_PARTITION_LIMIT = CALENDAR_SERIES_CHILD_LIMITS.selectedPartitionsPerRead;

export interface CalendarSelectedSeriesChild {
  readonly kind: 'series-child'; readonly scopeId: string; readonly ownerId: string; readonly seriesId: string; readonly appointmentId: string;
  readonly viewId: string; readonly viewPointerRevision: number; readonly viewContentRevision: number; readonly viewExceptionRevision: number;
  readonly childRevision: number; readonly selectionRevision: number; readonly childExceptionRevision: number;
  readonly versionId: string; readonly nativeVersionId: string | null; readonly variantVersionId: string | null; readonly versionDigest: string;
  readonly occurrenceId: string; readonly logicalSegmentId: string; readonly nominalKey: string; readonly sourceGeneration: number;
  readonly status: 'confirmed' | 'cancelled'; readonly createdBy: string; readonly authorityResourceIds: readonly string[]; readonly resourceDigest: string;
  readonly booking: CalendarBookingCandidate; readonly title: string; readonly participants: readonly CalendarParticipantReference[];
  readonly admittedType: CalendarAppointmentTypeSnapshot | null; readonly admittedVisit: CalendarVisitSnapshot | null;
}
export type CalendarAppointmentReadTarget =
  | { readonly kind: 'ordinary'; readonly row: CalendarAppointmentRow; readonly ids: readonly string[] }
  | CalendarSelectedSeriesChild;
function state(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function notFound(): never { throw new CalendarError('CALENDAR_NOT_FOUND'); }
function stored<T>(read: () => T): T { try { return read(); } catch { return state(); } }
function frozen<T>(value: T): T { return cloneDatabaseSerializableValue(value) as T; }
function key(value: unknown): string { return stored(() => calendarKey(value)); }
function integer(value: unknown, min = 1): number { return stored(() => calendarInteger(value, min)); }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return state(); return value; }
function keys(value: unknown): string[] {
  const ids = stored(() => calendarSelection(value));
  if (!ids.length || ids.length > CALENDAR_LIMITS.selection) return state(); return ids;
}
function json(value: unknown): unknown { if (typeof value !== 'string') return state(); return stored(() => JSON.parse(value)); }
function interval(input: unknown): CalendarTimedInterval {
  const r = stored(() => calendarRecord(input, ['startAt', 'endAt', 'startMs', 'endMs', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'occupiedStartMs', 'occupiedEndMs']));
  const startAt = stored(() => normalizeCalendarInstant(r.startAt)), endAt = stored(() => normalizeCalendarInstant(r.endAt));
  const startMs = Date.parse(startAt), endMs = Date.parse(endAt), before = stored(() => calendarInteger(r.bufferBeforeMinutes, 0, 1440)), after = stored(() => calendarInteger(r.bufferAfterMinutes, 0, 1440));
  if (endMs <= startMs || endMs - startMs > 31 * 86400000 || r.startMs !== startMs || r.endMs !== endMs
    || r.occupiedStartMs !== startMs - before * 60000 || r.occupiedEndMs !== endMs + after * 60000) return state();
  return { startAt, endAt, startMs, endMs, timeZone: stored(() => calendarText(r.timeZone, 128)), bufferBeforeMinutes: before,
    bufferAfterMinutes: after, occupiedStartMs: Number(r.occupiedStartMs), occupiedEndMs: Number(r.occupiedEndMs) };
}
function typeSnapshot(value: unknown): CalendarAppointmentTypeSnapshot | null {
  if (value === null) return null;
  const r = stored(() => calendarRecord(value, ['id', 'revision', 'label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey']));
  return { id: key(r.id), revision: integer(r.revision), label: stored(() => calendarText(r.label)), durationMinutes: stored(() => calendarInteger(r.durationMinutes, 1, 44640)),
    bufferBeforeMinutes: stored(() => calendarInteger(r.bufferBeforeMinutes, 0, 1440)), bufferAfterMinutes: stored(() => calendarInteger(r.bufferAfterMinutes, 0, 1440)),
    colorKey: r.colorKey === null ? null : key(r.colorKey) };
}
function visitSnapshot(value: unknown): CalendarVisitSnapshot | null {
  if (value === null) return null;
  const r = stored(() => calendarRecord(value, ['mode', 'location']));
  if (r.mode === 'video' || r.mode === 'phone') { if (r.location !== undefined) return state(); return { mode: r.mode }; }
  if (r.mode !== 'in-person') return state();
  const l = stored(() => calendarRecord(r.location, ['id', 'revision', 'label', 'region']));
  return { mode: 'in-person', location: { id: key(l.id), revision: integer(l.revision), label: stored(() => calendarText(l.label)),
    region: l.region === null ? null : stored(() => calendarText(l.region, 128)) } };
}
function acceptedFacts(input: unknown) {
  const r = stored(() => calendarRecord(input, ['booking', 'title', 'participants', 'admittedType', 'admittedVisit']));
  const b = stored(() => calendarRecord(r.booking, ['resourceIds', 'interval', 'appointmentType', 'visit'])), acceptedType = typeSnapshot(r.admittedType), acceptedVisit = visitSnapshot(r.admittedVisit);
  const resourceIds = keys(b.resourceIds), fact = interval(b.interval);
  // Keep the authored references in the internal native target. Public DTOs use
  // only the immutable admitted snapshots, never a fresh mutable catalog read.
  const booking: CalendarBookingCandidate = { resourceIds, interval: fact,
    ...(b.appointmentType === undefined ? {} : { appointmentType: stored(() => {
      const t = calendarRecord(b.appointmentType, ['id', 'revision']); return { id: calendarKey(t.id), revision: calendarInteger(t.revision, 1) };
    }) }), ...(b.visit === undefined ? {} : { visit: stored(() => {
      const v = calendarRecord(b.visit, ['mode', 'location']);
      if (v.mode === 'video' || v.mode === 'phone') return { mode: v.mode };
      if (v.mode !== 'in-person') return state(); const l = calendarRecord(v.location, ['id', 'revision']);
      return { mode: 'in-person' as const, location: { id: calendarKey(l.id), revision: calendarInteger(l.revision, 1) } };
    }) }) };
  if (booking.appointmentType === undefined ? acceptedType !== null : acceptedType === null
    || acceptedType.id !== booking.appointmentType.id || acceptedType.revision !== booking.appointmentType.revision) return state();
  if (booking.visit === undefined ? acceptedVisit !== null : acceptedVisit === null || acceptedVisit.mode !== booking.visit.mode
    || booking.visit.mode === 'in-person' && (acceptedVisit.mode !== 'in-person'
      || acceptedVisit.location.id !== booking.visit.location.id || acceptedVisit.location.revision !== booking.visit.location.revision)) return state();
  return { booking, title: stored(() => calendarText(r.title)), participants: stored(() => calendarParticipantReferences(r.participants)), admittedType: acceptedType, admittedVisit: acceptedVisit };
}

export function calendarSelectedSeriesChildView(target: CalendarSelectedSeriesChild): CalendarAppointmentView {
  const i = target.booking.interval;
  return frozen({ id: target.appointmentId, revision: target.childRevision, resourceIds: target.authorityResourceIds, title: target.title,
    startAt: i.startAt, endAt: i.endAt, timeZone: i.timeZone, bufferBeforeMinutes: i.bufferBeforeMinutes, bufferAfterMinutes: i.bufferAfterMinutes,
    status: target.status, createdBy: target.createdBy, ...(target.admittedType === null ? {} : { appointmentType: target.admittedType }),
    ...(target.admittedVisit === null ? {} : { visit: target.admittedVisit }), series: { kind: 'series-child-v1', seriesId: target.seriesId,
      logicalSegmentId: target.logicalSegmentId, nominalKey: target.nominalKey, sourceGeneration: target.sourceGeneration,
      exceptionRevision: target.childExceptionRevision, editPolicy: 'canonical-series-action' } });
}

interface Selection { readonly source: Row; readonly occurrence: Row; readonly pointer: Row; readonly head: Row; readonly ids: readonly string[] }
function scopedOwner(context: DatabaseReadQueryContext, scopeId: string, expectedOwner?: string): Row {
  const owner = context.database.query<Row>("SELECT * FROM _calendar_owner WHERE id='application' LIMIT 1").get();
  if (!owner || owner.scope_id !== scopeId || expectedOwner !== undefined && owner.owner_id !== expectedOwner) {
    if (expectedOwner !== undefined) throw new CalendarError('CALENDAR_FORBIDDEN'); return state();
  }
  return owner;
}
function selection(context: DatabaseReadQueryContext, scopeId: string, appointmentId: string, seriesId?: string): Selection | null {
  const db = context.database, occurrence = db.query<Row>(`SELECT * FROM ${native.occurrences} WHERE scope_id=? AND appointment_id=? LIMIT 1`).get(scopeId, appointmentId);
  if (!occurrence || seriesId !== undefined && occurrence.series_id !== seriesId) return null;
  const source = db.query<Row>('SELECT * FROM calendar_series WHERE scope_id=? AND id=? LIMIT 1').get(scopeId, key(occurrence.series_id)); if (!source) return state();
  const pointer = db.query<Row>(`SELECT * FROM ${t.current} WHERE scope_id=? AND series_id=? LIMIT 1`).get(scopeId, key(source.id));
  if (!pointer || pointer.current_view_id === null) return { source, occurrence, pointer: {}, head: {}, ids: [] };
  const head = db.query<Row>(`SELECT h.* FROM ${t.heads} h WHERE h.scope_id=? AND h.view_id=? AND h.appointment_id=?
    AND ${calendarSeriesCurrentChildHeadSql(t)} LIMIT 1`).get(scopeId, key(pointer.current_view_id), appointmentId);
  if (!head) return null;
  if (head.series_id !== source.id || head.occurrence_id !== occurrence.id || head.logical_segment_id !== occurrence.logical_segment_id || head.nominal_key !== occurrence.nominal_key) return state();
  const ids = keys(json(head.authority_resource_ids_json));
  if (head.resource_digest !== calendarHash(ids) || head.authority_resource_ids_json !== JSON.stringify(ids)) return state();
  return { source, occurrence, pointer, head, ids };
}
function unpromotedResources(context: DatabaseReadQueryContext, source: Row, occurrence: Row): readonly string[] {
  // Legacy021 has no exceptions/splits and every accepted child uses this exact
  // immutable source vector. This is permission admission ONLY, never a guessed
  // current effective child or a published details projection.
  if (source.published_generation_id === null || source.published_publication_id === null) return notFound();
  const accepted = context.database.query<Row>(`SELECT v.resource_ids_json FROM ${native.versions} v INDEXED BY calendar_series_child_native_occurrence
    CROSS JOIN ${native.runs} r CROSS JOIN ${native.runState} q
    WHERE r.id=v.run_id AND r.scope_id=v.scope_id AND r.series_id=v.series_id AND r.source_publication_id=?
      AND q.id=r.id AND q.scope_id=r.scope_id AND q.state='published'
      AND v.scope_id=? AND v.occurrence_id=? AND v.series_id=? LIMIT 1`)
    .get(key(source.published_publication_id), String(source.scope_id), key(occurrence.id), key(source.id));
  if (!accepted) return notFound();
  return keys(json(accepted.resource_ids_json));
}
function selectedFacts(context: DatabaseReadQueryContext, selected: Selection): CalendarSelectedSeriesChild {
  const { source, occurrence, pointer, head, ids } = selected, db = context.database;
  if (!ids.length) throw new CalendarError('CALENDAR_NOT_READY');
  const viewId = key(pointer.current_view_id), versionId = key(head.version_id);
  let version: Row | null, sourceGeneration: number, nativeVersionId: string | null = null, variantVersionId: string | null = null;
  if (head.origin_kind === 'native21') {
    nativeVersionId = key(head.native_version_id);
    if (nativeVersionId !== versionId || head.variant_version_id !== null) return state();
    version = db.query<Row>(`SELECT * FROM ${native.versions} WHERE scope_id=? AND id=? AND occurrence_id=? AND series_id=? LIMIT 1`)
      .get(String(source.scope_id), versionId, key(occurrence.id), key(source.id));
    if (!version || head.native_run_id !== version.run_id) return state();
    const provenance = db.query<Row>(`SELECT g.generation FROM ${native.runs} r JOIN ${native.runState} q ON q.id=r.id AND q.scope_id=r.scope_id AND q.state='published'
      JOIN _calendar_series_generations g ON g.id=r.generation_id AND g.scope_id=r.scope_id AND g.series_id=r.series_id
      WHERE r.scope_id=? AND r.id=? AND r.series_id=? LIMIT 1`).get(String(source.scope_id), key(version.run_id), key(source.id));
    if (!provenance) return state(); sourceGeneration = integer(provenance.generation);
  } else if (head.origin_kind === 'variant22') {
    variantVersionId = key(head.variant_version_id);
    if (variantVersionId !== versionId || head.native_version_id !== null || head.native_run_id !== null) return state();
    version = db.query<Row>(`SELECT * FROM ${t.variants} WHERE scope_id=? AND id=? AND occurrence_id=? AND series_id=? LIMIT 1`)
      .get(String(source.scope_id), versionId, key(head.occurrence_id), key(source.id));
    if (!version || version.status !== head.status || version.child_revision !== head.child_revision || version.child_exception_revision !== head.child_exception_revision) return state();
    sourceGeneration = integer(version.source_generation);
  } else return state();
  const facts = acceptedFacts(json(version.booking_json)), i = facts.booking.interval;
  if (head.resource_digest !== version.resource_digest || head.binding_digest !== version.binding_digest
    || calendarHash(facts.booking.resourceIds) !== calendarHash(ids) || head.start_ms !== i.startMs || head.end_ms !== i.endMs
    || head.occupied_from_ms !== i.occupiedStartMs || head.occupied_until_ms !== i.occupiedEndMs
    || version.start_ms !== i.startMs || version.end_ms !== i.endMs || version.occupied_from_ms !== i.occupiedStartMs || version.occupied_until_ms !== i.occupiedEndMs) return state();
  if (head.status !== 'confirmed' && head.status !== 'cancelled') return state();
  const resources = db.query<Row>(`SELECT resource_id,version_id,selection_revision,occupies,occupied_from_ms,occupied_until_ms FROM ${t.resources}
    WHERE scope_id=? AND view_id=? AND appointment_id=? AND selection_revision=? ORDER BY resource_id LIMIT ?`)
    .all(String(source.scope_id), viewId, key(head.appointment_id), integer(head.selection_revision), CALENDAR_LIMITS.selection + 1);
  if (resources.length !== ids.length || resources.some((r, n) => r.resource_id !== ids[n] || r.version_id !== versionId
    || r.selection_revision !== head.selection_revision || r.occupies !== (head.status === 'confirmed' ? 1 : 0) || r.occupied_from_ms !== i.occupiedStartMs || r.occupied_until_ms !== i.occupiedEndMs)) return state();
  return frozen({ kind: 'series-child', scopeId: String(source.scope_id), ownerId: key(source.owner_id), seriesId: key(source.id), appointmentId: key(head.appointment_id),
    viewId, viewPointerRevision: integer(pointer.pointer_revision), viewContentRevision: integer(pointer.content_revision, 0), viewExceptionRevision: integer(pointer.exception_revision, 0),
    childRevision: integer(head.child_revision), selectionRevision: integer(head.selection_revision), childExceptionRevision: integer(head.child_exception_revision, 0),
    versionId, nativeVersionId, variantVersionId, versionDigest: hash(version.version_digest), occurrenceId: key(occurrence.id), logicalSegmentId: key(head.logical_segment_id),
    nominalKey: stored(() => calendarText(head.nominal_key, 64)), sourceGeneration, status: head.status, createdBy: key(head.created_by), authorityResourceIds: ids,
    resourceDigest: hash(head.resource_digest), ...facts });
}
/** Fixed trusted-owner point reader. JSON owner fields are scope assertions,
 * not authority: only the managed native wrapper may invoke this private query. */
export function resolveNativeSeriesChild(context: DatabaseReadQueryContext, input: unknown): CalendarSelectedSeriesChild {
  const r = calendarRecord(input, ['scopeId', 'ownerId', 'seriesId', 'appointmentId']), scopeId = calendarScope(r.scopeId), ownerId = calendarKey(r.ownerId);
  scopedOwner(context, scopeId, ownerId);
  const selected = selection(context, scopeId, calendarKey(r.appointmentId), calendarKey(r.seriesId)); if (!selected) return notFound();
  if (selected.source.owner_id !== ownerId) throw new CalendarError('CALENDAR_FORBIDDEN');
  if (!selected.ids.length) { unpromotedResources(context, selected.source, selected.occurrence); throw new CalendarError('CALENDAR_NOT_READY'); }
  return selectedFacts(context, selected);
}
export function readCalendarSeriesChildTarget(context: DatabaseReadQueryContext, actor: CalendarActor, appointmentId: string, right: CalendarGrant): CalendarSelectedSeriesChild {
  const owner = scopedOwner(context, actor.scopeId), selected = selection(context, actor.scopeId, appointmentId); if (!selected) return notFound();
  if (selected.source.owner_id !== owner.owner_id) return state();
  const ids = selected.ids.length ? selected.ids : unpromotedResources(context, selected.source, selected.occurrence);
  for (const id of ids) readCalendarResourceForRight(context, actor, id, right);
  if (!selected.ids.length) throw new CalendarError('CALENDAR_NOT_READY');
  return selectedFacts(context, selected);
}
export function resolveCalendarAppointmentReadTarget(context: DatabaseReadQueryContext, actor: CalendarActor, appointmentId: string, right: CalendarGrant): CalendarAppointmentReadTarget {
  const ordinary = findCalendarOrdinaryAppointmentTarget(context, actor, appointmentId, right);
  if (ordinary !== null) return { kind: 'ordinary', ...ordinary };
  return readCalendarSeriesChildTarget(context, actor, appointmentId, right);
}
export function readCalendarAppointmentWithSeries(context: DatabaseReadQueryContext, input: unknown): CalendarAppointmentView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); scopedOwner(context, actor.scopeId);
  const target = resolveCalendarAppointmentReadTarget(context, actor, calendarKey(r.id), 'details');
  return target.kind === 'ordinary' ? readCalendarOrdinaryAppointmentView(context, target.row, [...target.ids]) : calendarSelectedSeriesChildView(target);
}
export function readCalendarSeriesChild(context: DatabaseReadQueryContext, input: unknown): CalendarAppointmentView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor);
  return calendarSelectedSeriesChildView(readCalendarSeriesChildTarget(context, actor, calendarKey(r.id), 'details'));
}
/** The registered legacy-writer bridge has one code-owned right. Caller input
 * cannot weaken it or obtain the native target's private participant facts. */
export function readCalendarSeriesChildManageTarget(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor), target = readCalendarSeriesChildTarget(context, actor, calendarKey(r.id), 'manage');
  return frozen({ kind: 'series-child', id: target.appointmentId, revision: target.childRevision });
}
/** SYSTEM presentation remains exclusively in calendarParticipantBroker. */
export function readCalendarSeriesChildParticipants(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor);
  if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
  const target = readCalendarSeriesChildTarget(context, actor, calendarKey(r.id), 'details');
  return frozen({ id: target.appointmentId, revision: target.childRevision, references: target.participants });
}
export function readCalendarAppointmentParticipantsWithSeries(context: DatabaseReadQueryContext, input: unknown) {
  try { return readCalendarAppointmentParticipants(context, input); }
  catch (error) { if (!(error instanceof CalendarError) || error.code !== 'CALENDAR_NOT_FOUND') throw error; }
  return readCalendarSeriesChildParticipants(context, input);
}

interface Partition { readonly viewId: string; readonly seriesId: string; readonly resourceId: string }
function partitions(context: DatabaseReadQueryContext, scopeId: string, resourceIds: readonly string[]): Partition[] {
  if (!resourceIds.length) return [];
  // This is only022 adoption readiness. It is NOT a sparse UTC coverage
  // certificate and an empty busy page never proves an unmaterialized slab free.
  let marker: Row | null;
  try { marker = context.database.query<Row>(`SELECT version,ranges_ready FROM ${t.state} WHERE id='application' LIMIT 1`).get(); }
  catch { throw new CalendarError('CALENDAR_NOT_READY'); }
  if (!marker || marker.version !== 22 || marker.ranges_ready !== 1) throw new CalendarError('CALENDAR_NOT_READY');
  // The bounded WORKING directory is visited before any interval index. Neither
  // superseded immutable versions nor UTC day cells participate in this read.
  const rows = context.database.query<Row>(`SELECT d.view_id,d.series_id,d.resource_id FROM ${t.directory} d
    CROSS JOIN ${t.current} p CROSS JOIN ${t.views} v CROSS JOIN calendar_series s
    WHERE d.scope_id=? AND d.resource_id IN (${resourceIds.map(() => '?').join(',')})
      AND p.scope_id=d.scope_id AND p.series_id=d.series_id AND p.current_view_id=d.view_id
      AND v.id=d.view_id AND v.scope_id=d.scope_id AND v.series_id=d.series_id AND v.phase='current'
      AND s.id=d.series_id AND s.scope_id=d.scope_id AND s.published_publication_id=v.source_publication_id
      AND ${calendarSeriesQualifiedChildViewSql(t, 's')}
    ORDER BY d.resource_id,d.view_id LIMIT ?`).all(scopeId, ...resourceIds, CALENDAR_SERIES_READ_PARTITION_LIMIT + 1);
  if (rows.length > CALENDAR_SERIES_READ_PARTITION_LIMIT) throw new CalendarError('CALENDAR_CAPACITY');
  return rows.map(row => ({ viewId: key(row.view_id), seriesId: key(row.series_id), resourceId: key(row.resource_id) }));
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
/** Initial one-row head per partition; only the winning partition advances.
 * At most P+L candidates cross the query boundary, not P*(L+1). */
function merge<T>(parts: readonly Partition[], next: (part: Partition, previous?: T) => T | null, compare: (a: T, b: T) => number, count: number): T[] {
  const heads = parts.map(part => ({ part, value: next(part) })), result: T[] = [];
  while (result.length < count) {
    let winner = -1;
    for (let n = 0; n < heads.length; n++) if (heads[n]!.value !== null && (winner < 0 || compare(heads[n]!.value!, heads[winner]!.value!) < 0)) winner = n;
    if (winner < 0) break;
    const selected = heads[winner]!; result.push(selected.value!);
    if (result.length < count) selected.value = next(selected.part, selected.value!);
  }
  return result;
}
function detailRight(actor: CalendarActor) {
  return actor.manageAll ? { sql: '1=1', params: [] as string[] } : {
    sql: `(resource.owner_id IS ? OR EXISTS(SELECT 1 FROM _calendar_grants g WHERE g.scope_id=resource.scope_id AND g.resource_id=resource.id
      AND g.user_id=? AND (g.manage=1 OR g.details=1)))`, params: [actor.userId, actor.userId],
  };
}
function childRangeRows(context: DatabaseReadQueryContext, r: ReturnType<typeof admitCalendarReadRange>): Row[] {
  const directory = partitions(context, r.actor.scopeId, r.ids), distinct = [...new Map(directory.map(part => [part.viewId, part])).values()], right = detailRight(r.actor);
  return merge(distinct, (part, previous?: Row) => {
    const seek = previous === undefined ? 'h.occupied_from_ms>=?' : '(h.occupied_from_ms,h.appointment_id)>(?,?)';
    return context.database.query<Row>(`SELECT h.* FROM ${t.heads} h WHERE h.scope_id=? AND h.view_id=? AND h.series_id=? AND h.status='confirmed'
      AND ${seek} AND h.occupied_from_ms<? AND h.occupied_until_ms>? AND ${calendarSeriesCurrentChildHeadSql(t)}
      AND EXISTS(SELECT 1 FROM ${t.resources} selected WHERE selected.scope_id=h.scope_id AND selected.view_id=h.view_id
        AND selected.appointment_id=h.appointment_id AND selected.selection_revision=h.selection_revision AND selected.version_id=h.version_id
        AND selected.occupies=1 AND selected.resource_id IN (${r.ids.map(() => '?').join(',')}))
      AND NOT EXISTS(SELECT 1 FROM json_each(h.authority_resource_ids_json) rr LEFT JOIN calendar_resources resource
        ON resource.scope_id=h.scope_id AND resource.id=rr.value WHERE resource.id IS NULL OR NOT ${right.sql})
      ORDER BY h.occupied_from_ms,h.appointment_id LIMIT 1`).get(r.actor.scopeId, part.viewId, part.seriesId,
        ...(previous === undefined ? [calendarOverlapSearchStart(r.startMs)] : [Number(previous.occupied_from_ms), String(previous.appointment_id)]), r.endMs, r.startMs, ...r.ids, ...right.params);
  }, (a, b) => Number(a.occupied_from_ms) - Number(b.occupied_from_ms) || compareText(String(a.appointment_id), String(b.appointment_id)), r.limit + 1);
}
function viewForHead(context: DatabaseReadQueryContext, actor: CalendarActor, head: Row): CalendarAppointmentView {
  const target = readCalendarSeriesChildTarget(context, actor, key(head.appointment_id), 'details');
  if (target.versionId !== head.version_id || target.selectionRevision !== head.selection_revision || target.viewId !== head.view_id) return state();
  return calendarSelectedSeriesChildView(target);
}
export function queryCalendarSeriesChildren(context: DatabaseReadQueryContext, input: unknown): CalendarAppointmentPage {
  const r = admitCalendarReadRange(context, input, 'details'); if (!r.ids.length) return { items: [], truncated: false };
  const rows = childRangeRows(context, r);
  return frozen({ items: rows.slice(0, r.limit).map(row => viewForHead(context, r.actor, row)), truncated: rows.length > r.limit });
}
export function queryCalendarAppointmentsWithSeries(context: DatabaseReadQueryContext, input: unknown): CalendarAppointmentPage {
  const r = admitCalendarReadRange(context, input, 'details'); if (!r.ids.length) return { items: [], truncated: false };
  const membership = readCalendarResourceMembershipTable(context), ordinary = readCalendarOrdinaryAppointmentRange(context, r, membership), children = childRangeRows(context, r);
  const rows = [...ordinary.map(row => ({ kind: 'ordinary' as const, row, start: row.occupied_start_ms, id: row.id })),
    ...children.map(row => ({ kind: 'child' as const, row, start: Number(row.occupied_from_ms), id: String(row.appointment_id) }))];
  rows.sort((a, b) => a.start - b.start || compareText(a.id, b.id));
  return frozen({ items: rows.slice(0, r.limit).map(entry => entry.kind === 'ordinary'
    ? readCalendarOrdinaryAppointmentView(context, entry.row as CalendarAppointmentRow, readCalendarAppointmentResourceIds(context, r.actor.scopeId, entry.id, membership))
    : viewForHead(context, r.actor, entry.row)), truncated: rows.length > r.limit });
}
function childBusyRows(context: DatabaseReadQueryContext, r: ReturnType<typeof admitCalendarReadRange>): CalendarBusyReadRow[] {
  const directory = partitions(context, r.actor.scopeId, r.ids);
  return merge(directory, (part, previous?: CalendarBusyReadRow) => {
    const seek = previous === undefined ? 'm.occupied_from_ms>=?' : '(m.occupied_from_ms,m.appointment_id)>(?,?)';
    const row = context.database.query<Row>(`SELECT m.appointment_id AS id,m.resource_id,m.occupied_from_ms AS occupied_start_ms,m.occupied_until_ms AS occupied_end_ms
      FROM ${t.resources} m CROSS JOIN ${t.heads} h WHERE m.scope_id=? AND m.view_id=? AND m.resource_id=? AND m.occupies=1
        AND ${seek} AND m.occupied_from_ms<? AND m.occupied_until_ms>?
        AND h.id=m.head_id AND h.scope_id=m.scope_id AND h.view_id=m.view_id AND h.appointment_id=m.appointment_id AND h.status='confirmed'
        AND h.selection_revision=m.selection_revision AND h.version_id=m.version_id AND ${calendarSeriesCurrentChildHeadSql(t, 'h', 'm')}
      ORDER BY m.occupied_from_ms,m.appointment_id LIMIT 1`).get(r.actor.scopeId, part.viewId, part.resourceId,
        ...(previous === undefined ? [calendarOverlapSearchStart(r.startMs)] : [previous.occupied_start_ms, previous.id]), r.endMs, r.startMs);
    return row === null ? null : { id: key(row.id), resource_id: key(row.resource_id), occupied_start_ms: Number(row.occupied_start_ms), occupied_end_ms: Number(row.occupied_end_ms), kind: 3 };
  }, busyCompare, r.limit + 1);
}
function busyCompare(a: CalendarBusyReadRow, b: CalendarBusyReadRow): number {
  return a.occupied_start_ms - b.occupied_start_ms || compareText(a.resource_id, b.resource_id) || a.kind - b.kind || compareText(a.id, b.id);
}
function busyPage(rows: readonly CalendarBusyReadRow[], limit: number): CalendarBusyPage {
  return frozen({ items: rows.slice(0, limit).map(row => ({ resourceId: row.resource_id, startAt: new Date(row.occupied_start_ms).toISOString(), endAt: new Date(row.occupied_end_ms).toISOString() })), truncated: rows.length > limit });
}
export function queryCalendarSeriesChildBusy(context: DatabaseReadQueryContext, input: unknown): CalendarBusyPage {
  const r = admitCalendarReadRange(context, input, 'busy'); if (!r.ids.length) return { items: [], truncated: false };
  return busyPage(childBusyRows(context, r), r.limit);
}
export function queryCalendarBusyWithSeries(context: DatabaseReadQueryContext, input: unknown): CalendarBusyPage {
  const r = admitCalendarReadRange(context, input, 'busy'); if (!r.ids.length) return { items: [], truncated: false };
  const rows = [...readCalendarOrdinaryBusyRange(context, r), ...childBusyRows(context, r)].sort(busyCompare);
  return busyPage(rows, r.limit);
}
