/** Source policy writes freeze bounded UTC windows. Booking reads only the indexed current generation. */
import type { CalendarReadContext } from './calendar-read-store';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarAvailabilityInput } from './contracts';
import type { CalendarAvailabilityPolicyInput, CalendarAvailabilityPolicyView } from './working-hours-contracts';
import { normalizeCalendarAvailabilityPolicy } from './working-hours-model';
import { materializeCalendarWorkingHours } from './working-hours-time';
import { currentLegacyCalendarAvailability, readCalendarAvailabilityPolicy } from './availability-model';
import { CalendarError, calendarCommand } from './error';
import { calendarActor, calendarBudget, calendarIntent, calendarResource, calendarRevision, eq, grantId, hasCalendarRight,
  nextCalendarRevision, requireCalendarRight, type CalendarResourceRow } from './realm-model';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { normalizeCalendarInstant, type CalendarTimedInterval } from './time';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';

interface PolicyPointer extends Row { id: string; scope_id: string; resource_id: string; resource_revision: number; source_kind: 'legacy' | 'policy'; history_id: string | null }
interface PolicyHistory extends Row { id: string; scope_id: string; resource_id: string; resource_revision: number; kind: CalendarAvailabilityPolicyInput['kind']; source_json: string;
  mode: 'unrestricted' | 'windows'; window_count: number; coverage_start_ms: number | null; coverage_end_ms: number | null; engine_json: string | null; skipped_json: string }
function checkedPointer(pointer: PolicyPointer | null, scopeId: string, resourceId: string): PolicyPointer | null {
  if (!pointer) return null;
  if (pointer.scope_id !== scopeId || pointer.resource_id !== resourceId || pointer.id !== resourceId
    || !Number.isSafeInteger(pointer.resource_revision) || pointer.resource_revision < 2
    || !['legacy', 'policy'].includes(pointer.source_kind) || (pointer.source_kind === 'policy') !== (typeof pointer.history_id === 'string')) throw new CalendarError('CALENDAR_STATE_INVALID');
  return pointer;
}
function checkedHistory(row: PolicyHistory | null, pointer: PolicyPointer): PolicyHistory {
  if (!row || row.id !== pointer.history_id || row.scope_id !== pointer.scope_id || row.resource_id !== pointer.resource_id
    || row.resource_revision !== pointer.resource_revision) throw new CalendarError('CALENDAR_STATE_INVALID');
  return row;
}
function assertPointerResource(pointer: PolicyPointer, resource: Row | null): void {
  // Grant/catalog changes may legitimately advance the resource beyond its
  // availability generation. A selector from a future or different resource
  // is never a reason to fall back to old unrestricted state.
  if (!resource || resource.id !== pointer.resource_id || resource.scope_id !== pointer.scope_id
    || !Number.isSafeInteger(resource.revision) || Number(resource.revision) < pointer.resource_revision) throw new CalendarError('CALENDAR_STATE_INVALID');
}
function assertLegacyPointer(pointer: PolicyPointer, legacy: Row | null): void {
  if (!legacy || legacy.id !== pointer.resource_id || legacy.scope_id !== pointer.scope_id || legacy.resource_id !== pointer.resource_id
    || legacy.policy_revision !== pointer.resource_revision) throw new CalendarError('CALENDAR_STATE_INVALID');
}
function source(row: PolicyHistory): CalendarAvailabilityPolicyInput {
  try {
    const policy = normalizeCalendarAvailabilityPolicy(JSON.parse(row.source_json));
    if (calendarJson(policy) !== row.source_json || policy.kind !== row.kind || !Number.isSafeInteger(row.window_count) || row.window_count < 0 || row.window_count > 1024
      || row.mode !== (policy.kind === 'explicit-utc-v1' ? policy.mode : 'windows')) throw new Error();
    return policy;
  } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
}
function writerPointer(context: CalendarReadContext, scopeId: string, resourceId: string): PolicyPointer | null {
  if (!context.db.hasTable('_calendar_availability_policy_current')) return null;
  const pointer = checkedPointer(context.db.get('_calendar_availability_policy_current', resourceId) as PolicyPointer | null, scopeId, resourceId);
  if (pointer) {
    assertPointerResource(pointer, context.db.get('calendar_resources', resourceId));
    if (pointer.source_kind === 'legacy') assertLegacyPointer(pointer, context.db.get('_calendar_availability', resourceId));
  } else if (context.db.find('_calendar_availability_policy_history', { select: ['id'], filters: [eq('scope_id', scopeId), eq('resource_id', resourceId)], limit: 1 }).length) {
    // Genuine pre-009/never-selected resources have no new history. Retained
    // new history without its selector is damage, not unrestricted legacy.
    throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  return pointer;
}
function writerHistory(context: CalendarReadContext, pointer: PolicyPointer): PolicyHistory {
  return checkedHistory(context.db.get('_calendar_availability_policy_history', pointer.history_id!) as PolicyHistory | null, pointer);
}
function queryPointer(context: DatabaseReadQueryContext, scopeId: string, resourceId: string): PolicyPointer | null {
  // Historical populated-upgrade queries may deliberately run before 009 is installed.
  if (!context.database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_calendar_availability_policy_current'").get()) return null;
  const pointer = checkedPointer(context.database.query<PolicyPointer>('SELECT * FROM _calendar_availability_policy_current WHERE id=?').get(resourceId), scopeId, resourceId);
  if (pointer) {
    assertPointerResource(pointer, context.database.query<Row>('SELECT id,scope_id,revision FROM calendar_resources WHERE id=?').get(resourceId));
    if (pointer.source_kind === 'legacy') assertLegacyPointer(pointer, context.database.query<Row>('SELECT id,scope_id,resource_id,policy_revision FROM _calendar_availability WHERE id=?').get(resourceId));
  } else if (context.database.query('SELECT id FROM _calendar_availability_policy_history WHERE scope_id=? AND resource_id=? LIMIT 1').get(scopeId, resourceId)) {
    throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  return pointer;
}
function queryHistory(context: DatabaseReadQueryContext, pointer: PolicyPointer): PolicyHistory {
  return checkedHistory(context.database.query<PolicyHistory>('SELECT * FROM _calendar_availability_policy_history WHERE id=? AND scope_id=?').get(pointer.history_id, pointer.scope_id), pointer);
}
export function currentCalendarAvailabilityPolicy(context: CalendarReadContext, scopeId: string, resourceId: string): CalendarAvailabilityPolicyInput | null {
  const pointer = writerPointer(context, scopeId, resourceId);
  return pointer?.source_kind === 'policy' ? source(writerHistory(context, pointer)) : null;
}
export function readCurrentCalendarAvailabilityPolicy(context: DatabaseReadQueryContext, scopeId: string, resourceId: string): CalendarAvailabilityPolicyInput | null {
  const pointer = queryPointer(context, scopeId, resourceId);
  return pointer?.source_kind === 'policy' ? source(queryHistory(context, pointer)) : null;
}
export function assertLegacyCalendarAvailabilityWritable(context: CalendarReadContext, scopeId: string, resourceId: string): void {
  if (currentCalendarAvailabilityPolicy(context, scopeId, resourceId)?.kind === 'weekly-local-v1') throw new CalendarError('CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED');
}
export function activateLegacyCalendarAvailability(context: DatabaseWriteCommandContext, scopeId: string, resourceId: string, revision: number): void {
  if (!context.db.hasTable('_calendar_availability_policy_current')) return;
  // New admission checked the old selector before mutation. The legacy writer
  // has now advanced its own pointer, so old/new pointer inequality is an
  // expected intermediate state inside this same source transaction.
  const pointer = checkedPointer(context.db.get('_calendar_availability_policy_current', resourceId) as PolicyPointer | null, scopeId, resourceId);
  if (pointer) assertPointerResource(pointer, context.db.get('calendar_resources', resourceId));
  const fields = { resource_revision: revision, source_kind: 'legacy', history_id: null };
  if (pointer) context.db.update('_calendar_availability_policy_current', resourceId, fields);
  else context.db.createStrict('_calendar_availability_policy_current', { id: resourceId, scope_id: scopeId, resource_id: resourceId, ...fields });
}
function legacyQuery(context: DatabaseReadQueryContext, scopeId: string, resourceId: string): CalendarAvailabilityInput {
  const pointer = context.database.query<{ policy_revision: number }>('SELECT policy_revision FROM _calendar_availability WHERE scope_id=? AND resource_id=?').get(scopeId, resourceId);
  if (!pointer) return { mode: 'unrestricted', windows: [] };
  const row = context.database.query<{ mode: string; windows_json: string }>('SELECT mode,windows_json FROM _calendar_availability_history WHERE scope_id=? AND resource_id=? AND policy_revision=?').get(scopeId, resourceId, pointer.policy_revision);
  if (!row) throw new CalendarError('CALENDAR_STATE_INVALID');
  return readCalendarAvailabilityPolicy(row);
}
function materialization(row: PolicyHistory): CalendarAvailabilityPolicyView['materialization'] {
  if (row.kind === 'explicit-utc-v1') {
    if (row.coverage_start_ms !== null || row.coverage_end_ms !== null || row.engine_json !== null || row.skipped_json !== '[]') throw new CalendarError('CALENDAR_STATE_INVALID');
    return null;
  }
  try {
    if (!Number.isSafeInteger(row.coverage_start_ms) || !Number.isSafeInteger(row.coverage_end_ms) || row.coverage_end_ms! <= row.coverage_start_ms!) throw new Error();
    const engine = calendarRecord(JSON.parse(row.engine_json!), ['name', 'runtime', 'icu']), skipped = JSON.parse(row.skipped_json);
    if (engine.name !== 'temporal-working-hours-v1' || typeof engine.runtime !== 'string' || !engine.runtime || engine.runtime.length > 128
      || typeof engine.icu !== 'string' || !engine.icu || engine.icu.length > 128 || !Array.isArray(skipped) || skipped.length > 366
      || skipped.some((value, index) => typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || index > 0 && value <= skipped[index - 1])) throw new Error();
    return { coverage: { startAt: normalizeCalendarInstant(new Date(row.coverage_start_ms!).toISOString()), endAt: normalizeCalendarInstant(new Date(row.coverage_end_ms!).toISOString()) },
      engine: { name: 'temporal-working-hours-v1', runtime: engine.runtime, icu: engine.icu }, skippedDates: skipped, windowCount: row.window_count };
  } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
}
export function readCalendarAvailabilityPolicyView(context: DatabaseReadQueryContext, input: unknown): CalendarAvailabilityPolicyView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor), id = calendarKey(r.id);
  if (context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get()?.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const resource = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!resource) throw new CalendarError('CALENDAR_NOT_FOUND');
  const grant = context.database.query<Row>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?').get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
  if (!hasCalendarRight(actor, resource, grant, 'book') && !hasCalendarRight(actor, resource, grant, 'details')) throw new CalendarError('CALENDAR_NOT_FOUND');
  const pointer = queryPointer(context, actor.scopeId, id), row = pointer?.source_kind === 'policy' ? queryHistory(context, pointer) : null;
  return { resourceId: id, resourceRevision: resource.revision, timeZone: resource.time_zone,
    policy: row ? source(row) : { kind: 'explicit-utc-v1', ...legacyQuery(context, actor.scopeId, id) }, materialization: row ? materialization(row) : null };
}
export function replaceCalendarAvailabilityPolicy(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input), { actor: actorInput, id, requestId: request, expectedRevision: expected, ...policyInput } = r, actor = calendarActor(actorInput);
    if (context.db.get('_calendar_owner', 'application')?.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
    const resource = calendarResource(context, actor, id); requireCalendarRight(context, actor, resource, 'manage');
    const expectedRevision = calendarInteger(expected, 1), policy = normalizeCalendarAvailabilityPolicy(policyInput);
    return calendarIntent(context, actor, request, ['resource.availability-policy.v1', resource.id, expectedRevision, policy], 'resource', 'manage', requestId => {
      calendarRevision(resource, expectedRevision);
      // Capture selection before appending history. An absent selector after
      // history exists is rejected on retained reads, but is expected only in
      // the middle of this atomic first-generation publication.
      const priorPointer = writerPointer(context, actor.scopeId, resource.id);
      const prior = priorPointer?.source_kind === 'policy' ? source(writerHistory(context, priorPointer))
        : { kind: 'explicit-utc-v1', ...currentLegacyCalendarAvailability(context, actor.scopeId, resource.id) };
      if (calendarJson(prior) === calendarJson(policy)) return { requestId, operation: 'resource.availability-policy-changed', id: resource.id, revision: resource.revision, changed: false };
      const expanded = policy.kind === 'weekly-local-v1' ? materializeCalendarWorkingHours(policy, resource.time_zone) : null;
      const windows = expanded?.windows ?? (policy.kind === 'explicit-utc-v1' ? policy.windows : []);
      if (windows.length > 1024) throw new CalendarError('CALENDAR_INPUT_INVALID');
      calendarBudget(context, 'availabilityPolicyHistory');
      if (windows.length) calendarBudget(context, 'availabilityPolicyWindows', windows.length);
      const revision = nextCalendarRevision(resource.revision), change = context.db.update('calendar_resources', resource.id, { revision });
      const historyId = calendarHash(['availability.policy.v1', actor.scopeId, resource.id, revision]);
      context.db.createStrict('_calendar_availability_policy_history', { id: historyId, scope_id: actor.scopeId, resource_id: resource.id, resource_revision: revision,
        kind: policy.kind, source_json: calendarJson(policy), mode: policy.kind === 'explicit-utc-v1' ? policy.mode : 'windows', window_count: windows.length,
        coverage_start_ms: expanded ? Date.parse(expanded.coverage.startAt) : null, coverage_end_ms: expanded ? Date.parse(expanded.coverage.endAt) : null,
        engine_json: expanded ? calendarJson(expanded.engine) : null, skipped_json: calendarJson(expanded?.skippedDates ?? []) });
      for (const [ordinal, window] of windows.entries()) context.db.createStrict('_calendar_availability_policy_windows', { id: historyId + ':' + ordinal,
        scope_id: actor.scopeId, resource_id: resource.id, history_id: historyId, ordinal, start_ms: Date.parse(window.startAt), end_ms: Date.parse(window.endAt) });
      const fields = { resource_revision: revision, source_kind: 'policy', history_id: historyId };
      if (priorPointer) context.db.update('_calendar_availability_policy_current', resource.id, fields);
      else context.db.createStrict('_calendar_availability_policy_current', { id: resource.id, scope_id: actor.scopeId, resource_id: resource.id, ...fields });
      appendCalendarSemanticAudit(context, 'resource.availability-policy-changed', change, { revision, availabilityKind: policy.kind, windowCount: windows.length });
      return { requestId, operation: 'resource.availability-policy-changed', id: resource.id, revision, changed: true };
    });
  });
}
/** True means the new selector handled admission. False delegates to unchanged pre-009 legacy policy. */
export function assertCalendarAvailabilityPolicy(context: CalendarReadContext, scopeId: string, resourceId: string, interval: CalendarTimedInterval): boolean {
  const pointer = writerPointer(context, scopeId, resourceId);
  if (pointer?.source_kind !== 'policy') return false;
  const row = writerHistory(context, pointer);
  if (row.kind === 'weekly-local-v1') {
    if (!Number.isSafeInteger(row.coverage_start_ms) || !Number.isSafeInteger(row.coverage_end_ms)) throw new CalendarError('CALENDAR_STATE_INVALID');
    if (interval.occupiedStartMs < row.coverage_start_ms! || interval.occupiedEndMs > row.coverage_end_ms!) throw new CalendarError('CALENDAR_AVAILABILITY_COVERAGE_REQUIRED');
  } else if (row.kind !== 'explicit-utc-v1') throw new CalendarError('CALENDAR_STATE_INVALID');
  if (row.mode === 'unrestricted' && row.kind === 'explicit-utc-v1') return true;
  if (row.mode !== 'windows') throw new CalendarError('CALENDAR_STATE_INVALID');
  // Seek to the immediate preceding normalized window. All earlier disjoint
  // windows necessarily end sooner; at most one candidate reaches JavaScript.
  const candidate = context.db.find('_calendar_availability_policy_windows', { select: ['start_ms', 'end_ms'], filters: [eq('scope_id', scopeId), eq('history_id', row.id),
    { type: 'field', field: 'start_ms', operator: 'lte', value: interval.occupiedStartMs }], order: [{ field: 'start_ms', direction: 'desc' }], limit: 1 })[0];
  if (!candidate || Number(candidate.end_ms) < interval.occupiedEndMs) throw new CalendarError('CALENDAR_AVAILABILITY_CONFLICT');
  return true;
}
