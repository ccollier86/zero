/** Private native source projection. No session reconstruction, compiler work,
 * grant issuance, writes, coverage or public query is supplied by this module. */
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarOwnerRecord } from './owner-schema';
import type { CalendarSeriesCompilationSnapshot } from './series-compilation';
import { normalizeCalendarTimedSeriesAuthoring } from './series-authoring';
import { CalendarError } from './error';
import { calendarNow } from './hold-time';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarScope, calendarValue } from './validation';

export interface CalendarSeriesNativeSourceDependencies {
  readonly owner: CalendarOwnerRecord;
  readonly policyGeneration: string;
  readonly signal: AbortSignal;
  /** Actual managed physical owner/root/realm/lifetime admission, never request JSON. */
  assertOwnerCurrent(owner: CalendarOwnerRecord): void;
  /** Current configured fixed series service authority, not the initiating user. */
  assertSeriesAuthorityCurrent(policyGeneration: string): void;
}
function invalid(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function stored<T>(read: () => T): T {
  try { return read(); } catch { return invalid(); }
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}
function key(value: unknown): string { return stored(() => calendarKey(value)); }
function integer(value: unknown, minimum = 1): number { return stored(() => calendarInteger(value, minimum)); }
function synchronous(check: () => unknown): void {
  const value = invokeSynchronousAuthCallback(check, { component: 'calendar-series', invariant: 'native-series-source-guard-is-synchronous',
    message: 'Calendar series source guards must not yield.' });
  if (value !== undefined) throw new CalendarError('CALENDAR_FORBIDDEN');
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Trusted composition only. Reading persisted facts cannot authenticate an
 * owner supplied by an HTTP caller. The managed owner must supply these fixed
 * callbacks and the later writer must repeat them under DatabaseCommitAuthority.
 * The returned read performs no Temporal work; capture/compile its detached
 * snapshot only AFTER the native query session and all leases have ended. */
export function createCalendarSeriesNativeSourceReader(dependencies: CalendarSeriesNativeSourceDependencies):
  (context: DatabaseReadQueryContext, seriesId: string) => CalendarSeriesCompilationSnapshot {
  const r = calendarRecord(calendarValue(dependencies.owner), ['id', 'scope_id', 'owner_id', 'root_hash', 'realm_fingerprint', 'established']);
  const scopeId = stored(() => calendarScope(r.scope_id)), ownerId = key(r.owner_id), policyGeneration = hash(dependencies.policyGeneration);
  if (r.established !== 1 || r.id !== 'calendar:' + calendarHash(scopeId) || typeof r.realm_fingerprint !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(r.realm_fingerprint)) return invalid();
  const owner = Object.freeze({ id: String(r.id), scope_id: scopeId, owner_id: ownerId, root_hash: hash(r.root_hash), realm_fingerprint: r.realm_fingerprint, established: 1 });
  const checkOwner = dependencies.assertOwnerCurrent.bind(dependencies), checkPolicy = dependencies.assertSeriesAuthorityCurrent.bind(dependencies), signal = dependencies.signal;
  if (!(signal instanceof AbortSignal)) throw new CalendarError('CALENDAR_CONFIG_INVALID');
  const guard = () => {
    signal.throwIfAborted(); synchronous(() => checkOwner(owner)); synchronous(() => checkPolicy(policyGeneration)); signal.throwIfAborted();
  };
  return (context, requestedId) => {
    guard(); const seriesId = calendarKey(requestedId), db = context.database, now = calendarNow();
    const physical = db.query<Row>("SELECT * FROM _calendar_owner WHERE id='application'").get();
    const marker = db.query<Row>("SELECT version FROM _calendar_series_state WHERE id='application'").get();
    if (physical?.scope_id !== scopeId || physical.owner_id !== ownerId || marker?.version !== 20) return invalid();
    const source = db.query<Row>('SELECT * FROM calendar_series WHERE scope_id=? AND id=? LIMIT 1').get(scopeId, seriesId);
    if (!source) throw new CalendarError('CALENDAR_NOT_FOUND');
    if (source.owner_id !== ownerId || source.lifecycle !== 'active') throw new CalendarError('CALENDAR_NOT_READY');
    const sourceId = key(source.source_id), controlRevision = integer(source.control_revision), grantEpoch = integer(source.grant_epoch);
    if (sourceId !== 'series-source:' + calendarHash([scopeId, ownerId, seriesId])) return invalid();
    if (source.active_preparation_id === null) throw new CalendarError('CALENDAR_NOT_READY');
    const preparationId = key(source.active_preparation_id);
    const preparation = db.query<Row>('SELECT * FROM _calendar_series_preparations WHERE scope_id=? AND id=? LIMIT 1').get(scopeId, preparationId);
    if (!preparation || preparation.series_id !== seriesId || !['preparing', 'blocked'].includes(String(preparation.state))) throw new CalendarError('CALENDAR_NOT_READY');
    const basePublicationId = source.published_publication_id === null ? null : key(source.published_publication_id);
    if (preparation.base_publication_id !== basePublicationId || preparation.grant_id !== source.current_grant_id || preparation.grant_epoch !== grantEpoch) return invalid();
    const createdAt = integer(preparation.created_ms, 0), expiresAt = integer(preparation.expires_ms, 0);
    if (expiresAt <= createdAt) return invalid();
    if (now >= expiresAt) throw new CalendarError('CALENDAR_NOT_READY');
    const generationId = key(preparation.generation_id);
    const generation = db.query<Row>('SELECT * FROM _calendar_series_generations WHERE scope_id=? AND id=? LIMIT 1').get(scopeId, generationId);
    const grant = db.query<Row>('SELECT * FROM _calendar_series_grants WHERE scope_id=? AND id=? LIMIT 1').get(scopeId, key(source.current_grant_id));
    const receipt = db.query<Row>('SELECT * FROM _calendar_series_receipts WHERE scope_id=? AND id=? LIMIT 1').get(scopeId, hash(preparation.acceptance_receipt_id));
    if (!generation || !grant || !receipt || generation.series_id !== seriesId || grant.series_id !== seriesId || receipt.series_id !== seriesId
      || generation.kind !== 'timed-series-v1' || generation.base_publication_id !== basePublicationId
      || generation.acceptance_receipt_id !== receipt.id || receipt.generation_id !== generationId || receipt.control_revision !== controlRevision
      || source.initial_acceptance_receipt_id !== receipt.id
      || receipt.preparation_id !== preparationId || receipt.operation !== 'series.plan.accepted' || receipt.base_publication_id !== basePublicationId
      || receipt.id !== calendarHash([scopeId, receipt.principal, receipt.request_id])
      || grant.owner_id !== ownerId || grant.source_id !== sourceId || grant.generation_id !== generationId || grant.source_generation !== generation.generation
      || grant.issuance_receipt_id !== receipt.id || grant.issued_epoch !== grantEpoch) return invalid();
    if (generation.policy_generation !== policyGeneration) throw new CalendarError('CALENDAR_POLICY_STALE');
    if (controlRevision !== 1 || generation.generation !== 1 || generation.predecessor_id !== null || basePublicationId !== null
      || source.published_generation_id !== null) throw new CalendarError('CALENDAR_NOT_READY');
    const acceptedAt = integer(receipt.accepted_ms, 0);
    if (acceptedAt < createdAt || acceptedAt >= expiresAt || acceptedAt > now || integer(grant.issued_ms, 0) < createdAt || integer(grant.issued_ms, 0) > acceptedAt
      || grant.authority_digest !== calendarHash(['calendar.series.authority.v1', owner, policyGeneration])) return invalid();
    // This first private family has exactly one un-split timed segment and no
    // exceptions. Later families must explicitly replace this contract, not
    // silently treat multiple segments/exception revisions as zero.
    const segments = db.query<Row>('SELECT * FROM _calendar_series_segments WHERE scope_id=? AND series_id=? AND generation_id=? ORDER BY segment_key LIMIT 2')
      .all(scopeId, seriesId, generationId);
    const segment = segments[0];
    if (segments.length !== 1 || !segment || segment.segment_key !== 'original' || segment.predecessor_segment_id !== null || segment.nominal_cut !== null) {
      throw new CalendarError('CALENDAR_NOT_READY');
    }
    const authoring = stored(() => normalizeCalendarTimedSeriesAuthoring(JSON.parse(String(generation.authoring_json)), { maxResources: 16, maxParticipants: 100 }));
    const authoringDigest = calendarHash(authoring);
    if (calendarJson(authoring) !== generation.authoring_json || authoringDigest !== hash(generation.authoring_digest)
      || segment.source_digest !== authoringDigest || segment.local_from !== authoring.recurrence.localStart.slice(0, 10) || segment.local_until !== null
      || segment.start_json !== calendarJson({ localStart: authoring.recurrence.localStart, timeZone: authoring.recurrence.timeZone,
        fold: authoring.recurrence.fold, durationMilliseconds: authoring.recurrence.durationMilliseconds })
      || segment.rule_json !== calendarJson(authoring.recurrence.rule) || segment.template_json !== calendarJson(authoring.template)
      || grant.resource_ids_json !== calendarJson(authoring.template.resourceIds) || grant.resource_digest !== calendarHash(authoring.template.resourceIds)) return invalid();
    const operations = stored(() => JSON.parse(String(grant.operations_json))) as unknown;
    if (!Array.isArray(operations) || calendarJson(operations) !== calendarJson(['series.coverage.commit', 'series.coverage.prepare', 'series.coverage.reconcile'])) return invalid();
    const resourceRevisions = authoring.template.resourceIds.map(id => {
      const resource = db.query<Row>('SELECT id,revision,active FROM calendar_resources WHERE scope_id=? AND id=? LIMIT 1').get(scopeId, id);
      if (!resource || resource.active !== 1) throw new CalendarError('CALENDAR_NOT_READY');
      return { id, revision: integer(resource.revision) };
    });
    const result: CalendarSeriesCompilationSnapshot = freeze({ kind: 'calendar-series-source-snapshot-v1', scopeId, ownerId, sourceId, seriesId,
      segmentId: key(segment.id), generationId, sourceGeneration: integer(generation.generation), controlRevision, exceptionRevision: 0,
      preparationId, basePublicationId, planManifestDigest: hash(preparation.manifest_digest), preparationExpiresAtMs: expiresAt,
      intentDigest: hash(receipt.digest), authoringDigest, engineGeneration: hash(generation.engine_generation), policyGeneration, authoring,
      grant: { grantId: key(grant.id), grantEpoch, authorityDigest: hash(grant.authority_digest), resourceDigest: hash(grant.resource_digest) }, resourceRevisions });
    guard();
    if (calendarNow() >= expiresAt) throw new CalendarError('CALENDAR_NOT_READY');
    return result;
  };
}
