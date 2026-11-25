/** Private series reconciliation. A plan acceptance is never proof of booking publication.
 * Not registered in the public Calendar realm until the full series family is ready. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor } from './contracts';
import { CALENDAR_REJECTIONS, CalendarError } from './error';
import { calendarNow } from './hold-time';
import { calendarActor, grantId, hasCalendarRight, type CalendarResourceRow } from './realm-model';
import { normalizeCalendarTimedSeriesAuthoring, type CalendarTimedSeriesAuthoring } from './series-authoring';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';

export interface CalendarSeriesPlanAcceptance {
  readonly operation: 'series.plan.accepted';
  readonly requestId: string;
  readonly seriesId: string;
  readonly controlRevision: number;
  readonly preparationId: string;
  readonly basePublicationId: string | null;
}
export interface CalendarSeriesPublicationView {
  readonly operation: 'series.publication.applied';
  readonly id: string;
  readonly generationId: string;
  readonly manifestDigest: string;
  readonly publishedAtMs: number;
}
export interface CalendarSeriesPlanStatus {
  readonly acceptance: CalendarSeriesPlanAcceptance;
  /** Expiry is a preparation deadline, not proof that old reservations were removed. */
  readonly state: 'preparing' | 'blocked' | 'expired' | 'aborted' | 'published' | 'retired';
  readonly blockedCode: string | null;
  readonly publication: CalendarSeriesPublicationView | null;
}
export interface CalendarTimedSeriesSourceView {
  readonly id: string;
  readonly controlRevision: number;
  readonly lifecycle: 'active' | 'retired';
  readonly authoring: CalendarTimedSeriesAuthoring;
  /** Desired source and current published source are independently identified. */
  readonly generationId: string;
  readonly generation: number;
  readonly publishedGenerationId: string | null;
  readonly publishedPublicationId: string | null;
  readonly plan: CalendarSeriesPlanStatus;
}

type Reader = DatabaseReadQueryContext['database'];
function invalid(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function stored<T>(read: () => T): T {
  try { return read(); } catch (error) {
    if (error instanceof CalendarError && error.code === 'CALENDAR_STATE_INVALID') throw error;
    return invalid();
  }
}
function key(value: unknown): string { return stored(() => calendarKey(value)); }
function digest(value: unknown): string {
  const valueKey = key(value);
  if (!/^[a-f0-9]{64}$/.test(valueKey)) return invalid();
  return valueKey;
}
function integer(value: unknown, min = 1): number { return stored(() => calendarInteger(value, min)); }
function nullableKey(value: unknown): string | null { return value === null ? null : key(value); }
function get(database: Reader, table: 'calendar_series' | '_calendar_series_generations' | '_calendar_series_grants'
  | '_calendar_series_preparations' | '_calendar_series_publications' | '_calendar_series_native_receipts', scopeId: string, id: string): Row {
  const row = database.query<Row>(`SELECT * FROM ${table} WHERE scope_id=? AND id=? LIMIT 1`).get(scopeId, id);
  if (!row) return invalid();
  return row;
}
/** SYSTEM authority and object admission precede private source/receipt disclosure. */
function owner(context: DatabaseReadQueryContext, actor: CalendarActor): string {
  if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
  const value = context.database.query<Row>("SELECT * FROM _calendar_owner WHERE id='application'").get();
  if (!value || value.scope_id !== actor.scopeId) return invalid();
  const schema = context.database.query<Row>("SELECT version FROM _calendar_series_state WHERE id='application'").get();
  if (!schema || schema.version !== 20) return invalid();
  return key(value.owner_id);
}
function source(database: Reader, actor: CalendarActor, ownerId: string, id: string): Row {
  const value = database.query<Row>('SELECT * FROM calendar_series WHERE scope_id=? AND id=? LIMIT 1').get(actor.scopeId, id);
  if (!value) throw new CalendarError('CALENDAR_NOT_FOUND');
  if (value.owner_id !== ownerId || !['active', 'retired'].includes(String(value.lifecycle))) return invalid();
  integer(value.control_revision); integer(value.grant_epoch);
  key(value.created_by); key(value.source_id); digest(value.initial_acceptance_receipt_id);
  const publishedGeneration = nullableKey(value.published_generation_id), publication = nullableKey(value.published_publication_id);
  if ((publishedGeneration === null) !== (publication === null)) return invalid();
  if (publication !== null) {
    const published = get(database, '_calendar_series_publications', actor.scopeId, publication);
    if (published.series_id !== id || published.owner_id !== ownerId || published.source_id !== value.source_id
      || published.generation_id !== publishedGeneration || published.operation !== 'series.publication.applied') return invalid();
  }
  const selected = get(database, '_calendar_series_grants', actor.scopeId, key(value.current_grant_id));
  if (selected.series_id !== id || selected.owner_id !== ownerId || selected.source_id !== value.source_id
    || integer(selected.issued_epoch) > integer(value.grant_epoch)) return invalid();
  // A retired source keeps its immutable last grant as evidence, not live native authority.
  if (value.lifecycle === 'active' && selected.issued_epoch !== value.grant_epoch) return invalid();
  const ids = stored(() => JSON.parse(String(selected.resource_ids_json))) as unknown;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 16) return invalid();
  const normalized = ids.map(key).sort();
  if (new Set(normalized).size !== normalized.length || calendarJson(normalized) !== selected.resource_ids_json
    || calendarHash(normalized) !== digest(selected.resource_digest)) return invalid();
  for (const id of normalized) {
    const resource = database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE scope_id=? AND id=? LIMIT 1').get(actor.scopeId, id);
    const grant = database.query<Row>('SELECT * FROM _calendar_grants WHERE scope_id=? AND id=? LIMIT 1')
      .get(actor.scopeId, grantId(actor.scopeId, id, actor.userId));
    if (!resource || !hasCalendarRight(actor, resource, grant, 'book')) throw new CalendarError('CALENDAR_NOT_FOUND');
  }
  return value;
}
function acceptance(receipt: Row): CalendarSeriesPlanAcceptance {
  if (receipt.operation !== 'series.plan.accepted'
    || receipt.id !== calendarHash([receipt.scope_id, receipt.principal, receipt.request_id])) return invalid();
  return Object.freeze({ operation: 'series.plan.accepted', requestId: key(receipt.request_id), seriesId: key(receipt.series_id),
    controlRevision: integer(receipt.control_revision), preparationId: key(receipt.preparation_id), basePublicationId: nullableKey(receipt.base_publication_id) });
}
function status(database: Reader, actor: CalendarActor, current: Row, receipt: Row, now: number): CalendarSeriesPlanStatus {
  const accepted = acceptance(receipt), preparation = get(database, '_calendar_series_preparations', actor.scopeId, accepted.preparationId);
  digest(receipt.digest);
  if (receipt.scope_id !== actor.scopeId || accepted.seriesId !== current.id || accepted.controlRevision > integer(current.control_revision)
    || preparation.series_id !== current.id || preparation.generation_id !== receipt.generation_id
    || preparation.acceptance_receipt_id !== receipt.id || preparation.base_publication_id !== accepted.basePublicationId) return invalid();
  const generation = get(database, '_calendar_series_generations', actor.scopeId, key(receipt.generation_id));
  if (generation.series_id !== current.id || generation.acceptance_receipt_id !== receipt.id
    || generation.base_publication_id !== accepted.basePublicationId) return invalid();
  integer(preparation.revision); integer(preparation.created_ms, 0);
  const expiry = integer(preparation.expires_ms, 0);
  if (expiry <= integer(preparation.created_ms, 0) || integer(receipt.accepted_ms, 0) < integer(preparation.created_ms, 0)
    || integer(receipt.accepted_ms, 0) >= expiry) return invalid();
  const phase = preparation.state;
  if (!['preparing', 'blocked', 'aborted', 'published'].includes(String(phase))) return invalid();
  if ((phase === 'preparing' || phase === 'blocked') && current.lifecycle === 'active'
    && (current.active_preparation_id !== preparation.id || current.control_revision !== receipt.control_revision
      || current.current_grant_id !== preparation.grant_id || current.grant_epoch !== preparation.grant_epoch)) return invalid();
  if ((phase === 'blocked') !== (preparation.blocked_code !== null)) return invalid();
  const blockedCode = preparation.blocked_code === null ? null : key(preparation.blocked_code);
  if (blockedCode !== null && !(CALENDAR_REJECTIONS as readonly string[]).includes(blockedCode)
    && !['CALENDAR_NOT_READY', 'CALENDAR_TIME_RULES_UNAVAILABLE'].includes(blockedCode)) return invalid();
  let publication: CalendarSeriesPublicationView | null = null;
  if (phase === 'published') {
    const published = get(database, '_calendar_series_publications', actor.scopeId, key(preparation.publication_id));
    const native = get(database, '_calendar_series_native_receipts', actor.scopeId, digest(published.native_receipt_id));
    if (published.operation !== 'series.publication.applied' || published.preparation_id !== preparation.id
      || published.series_id !== current.id || published.generation_id !== receipt.generation_id
      || published.base_publication_id !== accepted.basePublicationId || published.owner_id !== current.owner_id
      || published.source_id !== current.source_id || published.grant_id !== preparation.grant_id
      || published.grant_epoch !== preparation.grant_epoch || published.manifest_digest !== preparation.manifest_digest
      || native.domain !== 'calendar-series-native-v1' || native.phase !== 'commit' || native.outcome !== 'publication.ready'
      || native.owner_id !== published.owner_id || native.source_id !== published.source_id || native.series_id !== current.id
      || native.preparation_id !== preparation.id || native.generation_id !== published.generation_id
      || native.source_generation !== generation.generation || published.source_generation !== generation.generation
      || native.grant_id !== published.grant_id || native.grant_epoch !== published.grant_epoch
      || native.candidate_digest !== published.manifest_digest || native.policy_digest !== generation.policy_generation
      || native.id !== calendarHash(['calendar-series-native-v1', actor.scopeId, native.owner_id, native.source_id, native.source_generation, native.phase, native.logical_key])) return invalid();
    digest(native.cursor_digest); digest(generation.policy_generation);
    const publishedAtMs = integer(published.published_ms, 0);
    const nativeAcceptedAtMs = integer(native.accepted_ms, 0);
    if (nativeAcceptedAtMs < integer(receipt.accepted_ms, 0) || nativeAcceptedAtMs < integer(preparation.created_ms, 0)
      || publishedAtMs < nativeAcceptedAtMs || publishedAtMs >= expiry) return invalid();
    publication = Object.freeze({ operation: 'series.publication.applied', id: key(published.id), generationId: key(published.generation_id),
      manifestDigest: digest(published.manifest_digest), publishedAtMs });
  } else if (preparation.publication_id !== null) return invalid();
  // Historical publication remains publication after supersession or retirement.
  const state = phase === 'published' ? 'published' : phase === 'aborted' ? 'aborted'
    : current.lifecycle === 'retired' ? 'retired' : now >= expiry ? 'expired' : phase as 'preparing' | 'blocked';
  return Object.freeze({ acceptance: accepted, state, blockedCode, publication });
}

/** Original-key reconciliation returns an immutable acceptance plus its separate
 * current preparation outcome. It never recompiles, retries a mutation or issues a new grant. */
export function readCalendarSeriesPlan(context: DatabaseReadQueryContext, input: unknown): CalendarSeriesPlanStatus | null {
  const r = calendarRecord(input, ['actor', 'requestId']), actor = calendarActor(r.actor), requestId = calendarKey(r.requestId);
  const ownerId = owner(context, actor), id = calendarHash([actor.scopeId, actor.principal, requestId]);
  const receipt = context.database.query<Row>('SELECT * FROM _calendar_series_receipts WHERE scope_id=? AND id=? LIMIT 1').get(actor.scopeId, id);
  if (!receipt) return null;
  if (receipt.principal !== actor.principal || receipt.request_id !== requestId) return invalid();
  const current = source(context.database, actor, ownerId, key(receipt.series_id));
  return status(context.database, actor, current, receipt, calendarNow());
}

/** Authorized desired-source projection; the published selection is explicit.
 * At most one indexed current receipt/preparation and sixteen resource checks. */
export function readCalendarTimedSeriesSource(context: DatabaseReadQueryContext, input: unknown): CalendarTimedSeriesSourceView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor), id = calendarKey(r.id), ownerId = owner(context, actor);
  const current = source(context.database, actor, ownerId, id);
  const receipt = context.database.query<Row>('SELECT * FROM _calendar_series_receipts WHERE scope_id=? AND series_id=? ORDER BY control_revision DESC LIMIT 1')
    .get(actor.scopeId, id);
  if (!receipt) return invalid();
  const generation = get(context.database, '_calendar_series_generations', actor.scopeId, key(receipt.generation_id));
  const authoring = stored(() => normalizeCalendarTimedSeriesAuthoring(JSON.parse(String(generation.authoring_json)), { maxResources: 16, maxParticipants: 100 }));
  if (generation.kind !== authoring.kind || calendarJson(authoring) !== generation.authoring_json
    || calendarHash(authoring) !== digest(generation.authoring_digest)) return invalid();
  const currentGrant = get(context.database, '_calendar_series_grants', actor.scopeId, key(current.current_grant_id));
  if (currentGrant.generation_id !== generation.id || currentGrant.source_generation !== generation.generation
    || currentGrant.resource_ids_json !== calendarJson(authoring.template.resourceIds)) return invalid();
  return Object.freeze({ id, controlRevision: integer(current.control_revision), lifecycle: current.lifecycle as 'active' | 'retired',
    authoring, generationId: key(generation.id), generation: integer(generation.generation),
    publishedGenerationId: nullableKey(current.published_generation_id), publishedPublicationId: nullableKey(current.published_publication_id),
    plan: status(context.database, actor, current, receipt, calendarNow()) });
}
