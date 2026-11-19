/** Canonical018 effective assignments; directory visibility and booking coverage are separate facts. */
import type { CalendarReadContext } from './calendar-read-store';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarVisitInput } from './contracts';
import type { CalendarResourceLocationPolicyInput, CalendarResourceLocationPolicyView } from './location-policy-contracts';
import { CALENDAR_LOCATION_POLICY_CURRENT as CURRENT, CALENDAR_LOCATION_POLICY_HISTORY as HISTORY, CALENDAR_LOCATION_POLICY_WINDOWS as WINDOWS,
  CALENDAR_LOCATION_POLICY_STATE as STATE, CALENDAR_LOCATION_POLICY_LIMITS as LIMITS, calendarLocationPolicyIds, normalizeCalendarResourceLocationPolicy } from './location-policy-model';
import { CalendarError, calendarCommand } from './error';
import { calendarActor, assertCalendarOwner, calendarBudget, calendarIntent, calendarResource, calendarRevision, eq, grantId, hasCalendarRight, nextCalendarRevision,
  requireCalendarRight, type CalendarResourceRow } from './realm-model';
import { currentCalendarResourceLocations, calendarLocationWitnesses, parseCalendarLocationIds } from './locations-model';
import { assertCalendarLocationAssignmentSelection, writeCalendarResourceLocationDirectory } from './locations';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarScope } from './validation';

interface PolicyState { readonly resource: Row; readonly pointer: Row | null; readonly policy: CalendarResourceLocationPolicyInput; readonly rows: readonly Row[] }
const TABLES = [STATE, CURRENT, HISTORY, WINDOWS];
const MARKER = 'locationPolicyVersion';
const invalid = (): never => { throw new CalendarError('CALENDAR_STATE_INVALID'); };
function cells(policy: CalendarResourceLocationPolicyInput) {
  return policy.kind === 'static-v1' ? [] : policy.assignments.flatMap(assignment => assignment.windows.map((window, ordinal) => ({
    location_id: assignment.locationId, ordinal, start_ms: Date.parse(window.startAt), end_ms: Date.parse(window.endAt) })));
}
function checked(resource: Row | null, pointer: Row | null, history: Row | null, rows: readonly Row[], ids: readonly string[], scopeId: string, resourceId: string): PolicyState {
  try {
    if (!resource || resource.id !== resourceId || resource.scope_id !== scopeId) return invalid();
    const resourceRevision = calendarInteger(resource.revision, 1);
    if (!pointer || pointer.id !== resourceId || pointer.resource_id !== resourceId || pointer.scope_id !== scopeId
      || calendarInteger(pointer.resource_revision, 1) > resourceRevision) return invalid();
    let policy: CalendarResourceLocationPolicyInput;
    if (pointer.source_kind === 'legacy') {
      if (pointer.history_id !== null || history || rows.length) return invalid();
      policy = normalizeCalendarResourceLocationPolicy({ kind: 'static-v1', locationIds: ids });
    } else {
      if (pointer.source_kind !== 'policy' || !history || history.id !== pointer.history_id || history.scope_id !== scopeId
        || history.resource_id !== resourceId || history.resource_revision !== pointer.resource_revision || typeof history.source_json !== 'string') return invalid();
      policy = normalizeCalendarResourceLocationPolicy(JSON.parse(history.source_json));
      if (calendarJson(policy) !== history.source_json || policy.kind !== history.kind || history.window_count !== rows.length
        || calendarJson(calendarLocationPolicyIds(policy)) !== calendarJson(ids)) return invalid();
      const expected = cells(policy);
      if (expected.length !== rows.length || rows.some((row, index) => row.history_id !== history.id || row.scope_id !== scopeId || row.resource_id !== resourceId
        || row.resource_revision !== history.resource_revision || Object.entries(expected[index]!).some(([key, value]) => row[key] !== value))) return invalid();
    }
    return { resource, pointer, policy, rows };
  } catch { return invalid(); }
}
function writerState(context: CalendarReadContext, scopeId: string, resourceId: string): PolicyState {
  try {
    const present = TABLES.map(table => context.db.hasTable(table)), marker = context.db.get('_calendar_usage', MARKER);
    if (present.every(value => !value) && !marker) return { resource: context.db.get('calendar_resources', resourceId)!, pointer: null,
      policy: normalizeCalendarResourceLocationPolicy({ kind: 'static-v1', locationIds: currentCalendarResourceLocations(context, scopeId, resourceId) }), rows: [] };
    if (!present.every(Boolean) || marker?.count !== 18) return invalid();
    if (context.db.get(STATE, 'application')?.version !== 18) return invalid();
    const pointer = context.db.get(CURRENT, resourceId), history = pointer?.source_kind === 'policy' ? context.db.get(HISTORY, String(pointer.history_id)) : null;
    const rows = history ? context.db.find(WINDOWS, { filters: [eq('history_id', String(history.id))],
      order: [{ field: 'location_id', direction: 'asc' }, { field: 'ordinal', direction: 'asc' }], limit: LIMITS.windows + 1 }) : [];
    const latest = context.db.find(HISTORY, { filters: [eq('scope_id', scopeId), eq('resource_id', resourceId)], order: [{ field: 'resource_revision', direction: 'desc' }], limit: 1 })[0];
    if ((latest?.id ?? null) !== (history?.id ?? null)) return invalid();
    const directory = context.db.get('_calendar_resource_locations', resourceId);
    const ids = currentCalendarResourceLocations(context, scopeId, resourceId), members = context.db.find('_calendar_resource_location_current', {
      filters: [eq('scope_id', scopeId), eq('resource_id', resourceId)], order: [{ field: 'location_id', direction: 'asc' }], limit: 17 });
    if (directory && (directory.resource_revision !== pointer?.resource_revision || directory.scope_id !== scopeId)
      || !directory && pointer?.resource_revision !== 1 || calendarJson(members.map(row => row.location_id)) !== calendarJson(ids)
      || members.some(row => row.resource_revision !== directory?.resource_revision)) return invalid();
    return checked(context.db.get('calendar_resources', resourceId), pointer, history, rows, ids, scopeId, resourceId);
  } catch { return invalid(); }
}
function readerState(context: DatabaseReadQueryContext, scopeId: string, resourceId: string): PolicyState {
  try {
    const resource = context.database.query<Row>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(resourceId, scopeId);
    const legacyPointer = context.database.query<Row>('SELECT * FROM _calendar_resource_locations WHERE id=? AND scope_id=?').get(resourceId, scopeId);
    const legacy = legacyPointer ? context.database.query<Row>('SELECT * FROM _calendar_resource_location_history WHERE scope_id=? AND resource_id=? AND resource_revision=?').get(scopeId, resourceId, calendarInteger(legacyPointer.resource_revision, 1)) : null;
    if (legacyPointer && (!legacy || legacyPointer.resource_id !== resourceId || legacyPointer.resource_revision !== legacy.resource_revision)) return invalid();
    const ids = legacy ? parseCalendarLocationIds(legacy.location_ids_json) : [];
    if (!context.database.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(STATE)) {
      if (context.database.query("SELECT 1 FROM sqlite_schema WHERE name IN (?,?,?) LIMIT 1").get(CURRENT, HISTORY, WINDOWS)
        || context.database.query("SELECT 1 FROM _calendar_usage WHERE id=?").get(MARKER)
        || context.database.query("SELECT 1 FROM sqlite_schema WHERE name='_zero_migrations'").get()
        && context.database.query("SELECT 1 FROM _zero_migrations WHERE version='018' AND status='applied' AND direction='up' LIMIT 1").get()
        || context.database.query("SELECT 1 FROM sqlite_schema WHERE name='_migrations'").get()
        && context.database.query("SELECT 1 FROM _migrations WHERE version='018' LIMIT 1").get()) return invalid();
      if (!resource) return invalid();
      return { resource, pointer: null, policy: normalizeCalendarResourceLocationPolicy({ kind: 'static-v1', locationIds: ids }), rows: [] };
    }
    if (context.database.query<Row>(`SELECT * FROM ${STATE} WHERE id='application'`).get()?.version !== 18
      || context.database.query<Row>('SELECT * FROM _calendar_usage WHERE id=?').get(MARKER)?.count !== 18) return invalid();
    const pointer = context.database.query<Row>(`SELECT * FROM ${CURRENT} WHERE id=?`).get(resourceId);
    const history = pointer?.source_kind === 'policy' ? context.database.query<Row>(`SELECT * FROM ${HISTORY} WHERE id=?`).get(calendarKey(pointer.history_id)) : null;
    const rows = history ? context.database.query<Row>(`SELECT * FROM ${WINDOWS} WHERE history_id=? ORDER BY location_id,ordinal LIMIT ?`).all(calendarKey(history.id), LIMITS.windows + 1) : [];
    const latest = context.database.query<Row>(`SELECT id FROM ${HISTORY} WHERE scope_id=? AND resource_id=? ORDER BY resource_revision DESC LIMIT 1`).get(scopeId, resourceId);
    const members = context.database.query<Row>('SELECT * FROM _calendar_resource_location_current WHERE scope_id=? AND resource_id=? ORDER BY location_id LIMIT 17').all(scopeId, resourceId);
    if ((latest?.id ?? null) !== (history?.id ?? null) || legacyPointer && legacyPointer.resource_revision !== pointer?.resource_revision
      || !legacyPointer && pointer?.resource_revision !== 1 || calendarJson(members.map(row => row.location_id)) !== calendarJson(ids)
      || members.some(row => row.resource_revision !== legacyPointer?.resource_revision)) return invalid();
    return checked(resource, pointer, history, rows, ids, scopeId, resourceId);
  } catch { return invalid(); }
}
export function readCurrentCalendarResourceLocationPolicy(context: DatabaseReadQueryContext, scopeId: string, resourceId: string): CalendarResourceLocationPolicyInput | null {
  const state = readerState(context, scopeId, resourceId); return state.pointer?.source_kind === 'policy' ? state.policy : null;
}
/** Local native closure only. Nothing executable crosses IPC or public config. */
export function readCalendarResourceLocationCoverage(context: DatabaseReadQueryContext, scopeId: string, resourceId: string) {
  const state = readerState(context, scopeId, resourceId);
  return Object.freeze({ policy: state.policy, resourceRevision: Number(state.resource.revision), allows(locationId: string, startMs: number, endMs: number): boolean {
    calendarInteger(startMs, -8_640_000_000_000_000, 8_640_000_000_000_000); calendarInteger(endMs, startMs + 1, 8_640_000_000_000_000);
    if (state.policy.kind === 'static-v1') return state.policy.locationIds.includes(locationId);
    return !!context.database.query(`SELECT id FROM ${WINDOWS} INDEXED BY calendar_location_policy_coverage
      WHERE scope_id=? AND resource_id=? AND resource_revision=? AND location_id=? AND start_ms<=? AND end_ms>=? LIMIT 1`)
      .get(scopeId, resourceId, calendarInteger(state.pointer!.resource_revision, 1), locationId, startMs, endMs);
  } });
}
export function assertCalendarResourceLocationCoverage(context: CalendarReadContext, scopeId: string, resourceIds: readonly string[], visit: CalendarVisitInput | undefined,
  interval: { readonly occupiedStartMs: number; readonly occupiedEndMs: number }): void {
  if (visit?.mode !== 'in-person') return;
  for (const id of resourceIds) {
    const state = writerState(context, scopeId, id);
    const allowed = state.policy.kind === 'static-v1' ? state.policy.locationIds.includes(visit.location.id)
      : context.db.find(WINDOWS, { select: ['id'], filters: [eq('scope_id', scopeId), eq('resource_id', id), eq('resource_revision', Number(state.pointer!.resource_revision)),
        eq('location_id', visit.location.id), { type: 'field', field: 'start_ms', operator: 'lte', value: interval.occupiedStartMs },
        { type: 'field', field: 'end_ms', operator: 'gte', value: interval.occupiedEndMs }], limit: 1 }).length > 0;
    if (!allowed) throw new CalendarError('CALENDAR_VISIT_CONFLICT');
  }
}
export function initializeCalendarResourceLocationPolicy(context: DatabaseWriteCommandContext, scopeId: string, resourceId: string): void {
  if (!context.db.hasTable(STATE)) return;
  if (context.db.get(STATE, 'application')?.version !== 18 || context.db.get(CURRENT, resourceId)) return invalid();
  context.db.createStrict(CURRENT, { id: resourceId, scope_id: scopeId, resource_id: resourceId, resource_revision: 1, source_kind: 'legacy', history_id: null });
}
export function assertCalendarResourceLocationPolicyCurrent(context: CalendarReadContext, scopeId: string, resourceId: string): void {
  writerState(context, scopeId, resourceId);
}
export function assertLegacyCalendarResourceLocationsWritable(context: CalendarReadContext, scopeId: string, resourceId: string): void {
  if (writerState(context, scopeId, resourceId).policy.kind === 'effective-utc-v1') throw new CalendarError('CALENDAR_LOCATION_FORMAT_UNSUPPORTED');
}
function budget(context: DatabaseWriteCommandContext, key: 'locationPolicyHistory' | 'locationPolicyWindows', amount: number): void {
  const prior = context.db.get('_calendar_usage', key), count = prior ? calendarInteger(prior.count) : 0;
  if (count > (key === 'locationPolicyHistory' ? LIMITS.history : LIMITS.retainedWindows) - amount) throw new CalendarError('CALENDAR_CAPACITY');
  if (!amount) return;
  if (prior) context.db.update('_calendar_usage', key, { count: count + amount }); else context.db.createStrict('_calendar_usage', { id: key, count: amount });
}
function bind(context: DatabaseWriteCommandContext, scopeId: string, resourceId: string, revision: number, policy: CalendarResourceLocationPolicyInput): void {
  const historyId = calendarHash(['location.policy.v1', scopeId, resourceId, revision]), windows = cells(policy);
  budget(context, 'locationPolicyHistory', 1); budget(context, 'locationPolicyWindows', windows.length);
  context.db.createStrict(HISTORY, { id: historyId, scope_id: scopeId, resource_id: resourceId, resource_revision: revision, kind: policy.kind,
    source_json: calendarJson(policy), window_count: windows.length });
  for (const row of windows) context.db.createStrict(WINDOWS, { id: calendarHash([historyId, row.location_id, row.ordinal]), scope_id: scopeId,
    resource_id: resourceId, resource_revision: revision, history_id: historyId, ...row });
  context.db.update(CURRENT, resourceId, { resource_revision: revision, source_kind: 'policy', history_id: historyId });
}
/** Called by the unchanged flat API after its real directory update; richer policies were refused first. */
export function bindLegacyCalendarResourceLocations(context: DatabaseWriteCommandContext, scopeId: string, resourceId: string, revision: number, ids: readonly string[]): void {
  if (!context.db.hasTable(STATE)) return;
  const prior = context.db.get(CURRENT, resourceId); if (!prior) return invalid();
  if (prior.source_kind === 'policy') bind(context, scopeId, resourceId, revision, normalizeCalendarResourceLocationPolicy({ kind: 'static-v1', locationIds: ids }));
  else context.db.update(CURRENT, resourceId, { resource_revision: revision });
}
export function replaceCalendarResourceLocationPolicy(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'requestId', 'expectedRevision', 'kind', 'locationIds', 'assignments', 'locationWitnesses']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId); const resource = calendarResource(context, actor, r.id); requireCalendarRight(context, actor, resource, 'manage');
    const revision = calendarInteger(r.expectedRevision, 1), policy = normalizeCalendarResourceLocationPolicy(Object.fromEntries(Object.entries(r)
      .filter(([key]) => !['actor', 'id', 'requestId', 'expectedRevision', 'locationWitnesses'].includes(key)))), ids = [...calendarLocationPolicyIds(policy)];
    const witnesses = calendarLocationWitnesses(r.locationWitnesses ?? []);
    if (witnesses.some(witness => !ids.includes(witness.locationId))) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return calendarIntent(context, actor, r.requestId, ['resource.location-policy.v1', resource.id, revision, policy], 'resource', 'manage', requestId => {
      calendarRevision(resource, revision); if (!context.db.hasTable(STATE)) throw new CalendarError('CALENDAR_NOT_READY');
      const state = writerState(context, actor.scopeId, resource.id);
      if (calendarJson(state.policy) === calendarJson(policy)) return { requestId, operation: 'resource.location-policy-changed' as const, id: resource.id, revision: resource.revision, changed: false };
      const prior = currentCalendarResourceLocations(context, actor.scopeId, resource.id);
      assertCalendarLocationAssignmentSelection(context, actor, resource, ids, prior, witnesses);
      calendarBudget(context, 'resourceLocationHistory');
      const next = nextCalendarRevision(resource.revision), change = context.db.update('calendar_resources', resource.id, { revision: next });
      writeCalendarResourceLocationDirectory(context, actor.scopeId, resource.id, next, ids, prior);
      bind(context, actor.scopeId, resource.id, next, policy);
      appendCalendarSemanticAudit(context, 'resource.location-policy-changed', change, { revision: next, locationCount: ids.length, windowCount: cells(policy).length, locationPolicyKind: policy.kind });
      return { requestId, operation: 'resource.location-policy-changed' as const, id: resource.id, revision: next, changed: true };
    });
  });
}
export function readCalendarResourceLocationPolicy(context: DatabaseReadQueryContext, input: unknown): CalendarResourceLocationPolicyView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor), id = calendarKey(r.id);
  if (context.database.query<Row>("SELECT * FROM _calendar_owner WHERE id='application'").get()?.scope_id !== actor.scopeId) return invalid();
  const resource = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE scope_id=? AND id=?').get(actor.scopeId, id);
  if (!resource) throw new CalendarError('CALENDAR_NOT_FOUND');
  const grant = context.database.query<Row>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?').get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
  if (!hasCalendarRight(actor, resource, grant, 'book') && !hasCalendarRight(actor, resource, grant, 'details')) throw new CalendarError('CALENDAR_NOT_FOUND');
  const state = readerState(context, calendarScope(actor.scopeId), id);
  return { resourceId: id, resourceRevision: Number(resource.revision), policy: state.policy };
}
