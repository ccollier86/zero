/** Private canonical initial acceptance. Facts are NOT authority: only a real
 * parent request or a verified native signed wrapper may construct this command.
 * Actual DatabaseCommitAuthority must install assertCommitCurrent; calling run
 * alone does not establish Guardian/SYSTEM/physical-owner commit qualification. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { appendDatabaseCommandSourceAudit } from '../databases/database-command-source-audit';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { CalendarOwnerRecord } from './owner-schema';
import type { CalendarResourceRow } from './realm-model';
import { admitCalendarBookingHardCandidate } from './booking-admission';
import { calendarHumanRequestId, readCalendarHumanKeyClaim } from './human-request-key';
import { normalizeCalendarTimedSeriesAuthoring, type CalendarTimedSeriesAuthoring } from './series-authoring';
import { normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarScope, calendarText, calendarValue } from './validation';
import { CALENDAR_SERIES_CAPACITY } from './realm-series-migration';
import { CalendarError } from './error';

export interface CalendarInitialSeriesRequestFacts {
  readonly scopeId: string; readonly principal: string; readonly userId: string; readonly requestId: string; readonly seriesId: string;
  readonly digest: string; readonly authoring: CalendarTimedSeriesAuthoring;
}
export interface CalendarInitialSeriesCompilationFrame {
  readonly request: CalendarInitialSeriesRequestFacts;
  readonly interval: Readonly<CalendarTimedInterval>;
  readonly engineGeneration: string;
}
export interface CalendarInitialSeriesSourceAcceptance {
  readonly operation: 'series.plan.accepted'; readonly requestId: string; readonly seriesId: string;
  readonly controlRevision: 1; readonly preparationId: string; readonly basePublicationId: null;
}
export interface CalendarInitialSeriesSourceAdmissionDependencies {
  readonly owner: CalendarOwnerRecord;
  readonly policyGeneration: string;
  readonly preparationTtlMs: number;
  readonly maximumResources: number;
  readonly maximumParticipants: number;
  /** Fixed native owner/current-policy or REAL parent Guardian/SYSTEM guard.
   * fresh=false replay must not newly resolve Temporal/policy/participants. */
  guard(fresh: boolean): void;
  /** Lazy: original receipt replay precedes proof/engine admission. */
  compilation(): CalendarInitialSeriesCompilationFrame;
  /** Parent injects real current human book admission. Verified native wrappers
   * use the default scope-only read; they never synthesize CalendarActor. */
  resource?(context: DatabaseWriteCommandContext, id: string): CalendarResourceRow;
}
export interface CalendarInitialSeriesSourceAdmission {
  run(context: DatabaseWriteCommandContext): CalendarInitialSeriesSourceAcceptance;
  assertCommitCurrent(): void;
}
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function forbidden(): never { throw new CalendarError('CALENDAR_FORBIDDEN'); }
function state(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function hash(value: unknown): string { const result = calendarText(value, 64); if (!/^[a-f0-9]{64}$/.test(result)) return invalid(); return result; }
function synchronous(run: () => unknown): void {
  const result = invokeSynchronousAuthCallback(run, { component: 'calendar-series', invariant: 'native-series-guard-is-synchronous', message: 'Calendar series guards must not yield.' });
  if (result !== undefined) forbidden();
}
/** Closed detached facts only; normalization does no Temporal expansion. This
 * validates signed data shape/equations, NOT the signature or initiating user. */
export function normalizeCalendarInitialSeriesRequestFacts(input: unknown): CalendarInitialSeriesRequestFacts {
  const r = calendarRecord(calendarValue(input), ['scopeId', 'principal', 'userId', 'requestId', 'seriesId', 'digest', 'authoring']);
  const scopeId = calendarScope(r.scopeId), principal = calendarText(r.principal, 256), userId = calendarKey(r.userId), requestId = calendarKey(r.requestId);
  const seriesId = hash(r.seriesId), digest = hash(r.digest), authoring = normalizeCalendarTimedSeriesAuthoring(r.authoring, { maxResources: 16, maxParticipants: 100 });
  if (seriesId !== calendarHash(['calendar.series.v1', scopeId, principal, requestId]) || digest !== calendarHash(['series.create.v1', seriesId, authoring])
    || calendarJson(authoring) !== calendarJson(r.authoring)) return invalid();
  return Object.freeze({ scopeId, principal, userId, requestId, seriesId, digest, authoring });
}
function compilationFrame(input: unknown, request: CalendarInitialSeriesRequestFacts): CalendarInitialSeriesCompilationFrame {
  const r = calendarRecord(calendarValue(input), ['request', 'interval', 'engineGeneration']);
  if (calendarJson(normalizeCalendarInitialSeriesRequestFacts(r.request)) !== calendarJson(request)) return forbidden();
  const i = calendarRecord(r.interval, ['startAt', 'endAt', 'startMs', 'endMs', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'occupiedStartMs', 'occupiedEndMs']);
  const interval = normalizeCalendarTimedInterval({ startAt: i.startAt, endAt: i.endAt, timeZone: i.timeZone,
    bufferBeforeMinutes: i.bufferBeforeMinutes, bufferAfterMinutes: i.bufferAfterMinutes });
  if (calendarJson(interval) !== calendarJson(i) || interval.endMs - interval.startMs !== request.authoring.recurrence.durationMilliseconds
    || interval.timeZone !== request.authoring.recurrence.timeZone || interval.bufferBeforeMinutes !== request.authoring.template.bufferBeforeMinutes
    || interval.bufferAfterMinutes !== request.authoring.template.bufferAfterMinutes) return invalid();
  return Object.freeze({ request, interval, engineGeneration: hash(r.engineGeneration) });
}

/** One canonical implementation serves parent-local and actor-native admission.
 * A caller must first prove signed-frame provenance and real request authority;
 * neither this factory nor normalized facts confer a write grant. */
export function createCalendarInitialSeriesSourceAdmission(dependencies: CalendarInitialSeriesSourceAdmissionDependencies,
  requestFacts: CalendarInitialSeriesRequestFacts): CalendarInitialSeriesSourceAdmission {
  const value = normalizeCalendarInitialSeriesRequestFacts(requestFacts), scopeId = value.scopeId;
  const owner = Object.freeze({ ...dependencies.owner }), policyGeneration = hash(dependencies.policyGeneration);
  const ttl = calendarInteger(dependencies.preparationTtlMs, 1_000, 86_400_000);
  const maximumResources = calendarInteger(dependencies.maximumResources, 1, 16), maximumParticipants = calendarInteger(dependencies.maximumParticipants, 1, 100);
  if (owner.established !== 1 || owner.scope_id !== scopeId || owner.id !== 'calendar:' + calendarHash(scopeId)
    || !/^[a-f0-9]{64}$/.test(owner.root_hash) || !/^sha256:[a-f0-9]{64}$/.test(owner.realm_fingerprint)) return state();
  const check = dependencies.guard.bind(dependencies), compile = dependencies.compilation.bind(dependencies), resource = dependencies.resource?.bind(dependencies);
  let ran = false, fresh = false;
  const guard = () => synchronous(() => check(fresh));
  const accepted = (): CalendarInitialSeriesSourceAcceptance => Object.freeze({ operation: 'series.plan.accepted', requestId: value.requestId, seriesId: value.seriesId,
    controlRevision: 1, preparationId: calendarHash(['calendar.series.preparation.v1', scopeId, value.seriesId, 1]), basePublicationId: null });
  const run = (context: DatabaseWriteCommandContext) => context.db.transaction(() => {
    if (ran) return forbidden(); ran = true; guard();
    if (context.db.get('_calendar_series_state', 'application')?.version !== 20) throw new CalendarError('CALENDAR_NOT_READY');
    const storedOwner = context.db.get('_calendar_owner', 'application');
    if (storedOwner?.scope_id !== scopeId || storedOwner.owner_id !== owner.owner_id) return state();
    const resources = value.authoring.template.resourceIds.map(id => {
      const row = resource ? resource(context, id) : context.db.get('calendar_resources', id) as CalendarResourceRow | null;
      if (!row || row.scope_id !== scopeId || row.id !== id) throw new CalendarError('CALENDAR_NOT_FOUND'); return row;
    });
    const receiptId = calendarHumanRequestId(scopeId, value.principal, value.requestId), claim = readCalendarHumanKeyClaim(context.db, scopeId, value.principal, value.requestId);
    if (claim) {
      if (claim.family !== 'series' || claim.row.digest !== value.digest || claim.row.series_id !== value.seriesId) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      const result = accepted(), receipt = claim.row, generation = context.db.get('_calendar_series_generations', String(receipt.generation_id));
      const source = context.db.get('calendar_series', value.seriesId), preparation = context.db.get('_calendar_series_preparations', result.preparationId);
      const originalGrant = context.db.get('_calendar_series_grants', String(preparation?.grant_id)), effect = context.db.get('_calendar_series_effect_intents', receiptId);
      if (receipt.id !== receiptId || receipt.scope_id !== scopeId || receipt.principal !== value.principal || receipt.request_id !== value.requestId || receipt.control_revision !== 1
        || receipt.operation !== result.operation || receipt.preparation_id !== result.preparationId || receipt.base_publication_id !== null
        || source?.scope_id !== scopeId || source.owner_id !== owner.owner_id || source.initial_acceptance_receipt_id !== receiptId || source.created_by !== value.userId
        || generation?.scope_id !== scopeId || generation.series_id !== value.seriesId || generation.generation !== 1 || generation.acceptance_receipt_id !== receiptId
        || generation.id !== calendarHash(['calendar.series.generation.v1', scopeId, value.seriesId, 1]) || generation.predecessor_id !== null || generation.base_publication_id !== null
        || generation.authoring_json !== calendarJson(value.authoring) || generation.authoring_digest !== calendarHash(value.authoring)
        || preparation?.scope_id !== scopeId || preparation.series_id !== value.seriesId || preparation.acceptance_receipt_id !== receiptId || preparation.generation_id !== generation.id || preparation.base_publication_id !== null || preparation.grant_epoch !== 1
        || originalGrant?.id !== calendarHash(['calendar.series.grant.v1', scopeId, value.seriesId, 1]) || originalGrant.scope_id !== scopeId || originalGrant.series_id !== value.seriesId
        || originalGrant.generation_id !== generation.id || originalGrant.owner_id !== owner.owner_id || originalGrant.source_id !== source.source_id || originalGrant.source_generation !== 1
        || originalGrant.issued_epoch !== 1 || originalGrant.issuance_receipt_id !== receiptId || originalGrant.resource_ids_json !== calendarJson(value.authoring.template.resourceIds) || originalGrant.resource_digest !== calendarHash(value.authoring.template.resourceIds)
        || effect?.scope_id !== scopeId || effect.series_id !== value.seriesId || effect.generation_id !== generation.id || effect.preparation_id !== preparation.id || effect.receipt_family !== 'human'
        || effect.receipt_id !== receiptId || effect.operation !== result.operation || effect.publication_id !== null || effect.child_version_id !== null || effect.child_binding_digest !== null) return state();
      guard(); return result;
    }
    fresh = true; guard();
    if (value.authoring.template.resourceIds.length > maximumResources || value.authoring.template.participants.length > maximumParticipants) return invalid();
    const proof = compilationFrame(compile(), value); guard();
    if (resources.some(row => row.active !== 1)) return forbidden();
    if (context.db.get('calendar_series', value.seriesId)) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
    const template = value.authoring.template;
    admitCalendarBookingHardCandidate(context, scopeId, { resourceIds: template.resourceIds, interval: proof.interval,
      ...(template.appointmentType ? { appointmentType: template.appointmentType } : {}), ...(template.visit ? { visit: template.visit } : {}) },
    { type: true, visit: true, availabilityResourceIds: template.resourceIds, occupancy: false });
    for (const table of ['calendar_series', '_calendar_series_generations', '_calendar_series_segments', '_calendar_series_grants', '_calendar_series_preparations', '_calendar_series_receipts', '_calendar_series_effect_intents'] as const) {
      const capacity = context.db.get('_calendar_series_capacity', table);
      if (!capacity || !Number.isSafeInteger(capacity.count) || Number(capacity.count) < 0 || capacity.ceiling !== CALENDAR_SERIES_CAPACITY[table] || Number(capacity.count) > Number(capacity.ceiling)) return state();
      if (capacity.count === capacity.ceiling) throw new CalendarError('CALENDAR_CAPACITY');
    }
    guard();
    const result = accepted(), generationId = calendarHash(['calendar.series.generation.v1', scopeId, value.seriesId, 1]);
    const grantId = calendarHash(['calendar.series.grant.v1', scopeId, value.seriesId, 1]), segmentId = calendarHash(['calendar.series.segment.v1', scopeId, value.seriesId, 'original']);
    const sourceId = 'series-source:' + calendarHash([scopeId, owner.owner_id, value.seriesId]);
    const created = calendarInteger(Date.now(), 0, Number.MAX_SAFE_INTEGER - ttl), expires = created + ttl;
    const authoringDigest = calendarHash(value.authoring), manifestDigest = calendarHash(['calendar.series.initial-manifest.v1', value.digest, generationId, grantId, proof.engineGeneration, policyGeneration]);
    context.db.createStrict('calendar_series', { id: value.seriesId, scope_id: scopeId, owner_id: owner.owner_id, source_id: sourceId, created_by: value.userId, control_revision: 1,
      initial_acceptance_receipt_id: receiptId, lifecycle: 'active', grant_epoch: 1, current_grant_id: grantId, published_generation_id: null, published_publication_id: null, active_preparation_id: result.preparationId });
    context.db.createStrict('_calendar_series_generations', { id: generationId, scope_id: scopeId, series_id: value.seriesId, generation: 1, predecessor_id: null, base_publication_id: null,
      kind: value.authoring.kind, authoring_json: calendarJson(value.authoring), authoring_digest: authoringDigest, engine_generation: proof.engineGeneration, policy_generation: policyGeneration, acceptance_receipt_id: receiptId });
    context.db.createStrict('_calendar_series_segments', { id: segmentId, scope_id: scopeId, series_id: value.seriesId, generation_id: generationId, segment_key: 'original', predecessor_segment_id: null, nominal_cut: null,
      local_from: value.authoring.recurrence.localStart.slice(0, 10), local_until: null, start_json: calendarJson({ localStart: value.authoring.recurrence.localStart, timeZone: value.authoring.recurrence.timeZone,
        fold: value.authoring.recurrence.fold, durationMilliseconds: value.authoring.recurrence.durationMilliseconds }), rule_json: calendarJson(value.authoring.recurrence.rule), template_json: calendarJson(template), source_digest: authoringDigest });
    context.db.createStrict('_calendar_series_grants', { id: grantId, scope_id: scopeId, series_id: value.seriesId, generation_id: generationId, grant_revision: 1, issued_epoch: 1, owner_id: owner.owner_id,
      source_id: sourceId, source_generation: 1, operations_json: calendarJson(['series.coverage.commit', 'series.coverage.prepare', 'series.coverage.reconcile']), resource_ids_json: calendarJson(template.resourceIds),
      authority_digest: calendarHash(['calendar.series.authority.v1', owner, policyGeneration]), resource_digest: calendarHash(template.resourceIds), issuance_receipt_id: receiptId, issued_ms: created });
    context.db.createStrict('_calendar_series_preparations', { id: result.preparationId, scope_id: scopeId, series_id: value.seriesId, generation_id: generationId, grant_id: grantId, grant_epoch: 1,
      acceptance_receipt_id: receiptId, base_publication_id: null, manifest_digest: manifestDigest, revision: 1, state: 'preparing', created_ms: created, expires_ms: expires,
      claim_generation: 0, claim_nonce: null, claim_until_ms: null, blocked_code: null, publication_id: null });
    context.db.createStrict('_calendar_series_receipts', { id: receiptId, scope_id: scopeId, principal: value.principal, request_id: value.requestId, digest: value.digest, series_id: value.seriesId,
      generation_id: generationId, control_revision: 1, preparation_id: result.preparationId, base_publication_id: null, accepted_ms: created, operation: result.operation });
    const effect = context.db.createStrict('_calendar_series_effect_intents', { id: receiptId, scope_id: scopeId, series_id: value.seriesId, generation_id: generationId, preparation_id: result.preparationId,
      receipt_family: 'human', receipt_id: receiptId, operation: result.operation, publication_id: null, child_version_id: null, child_binding_digest: null });
    appendDatabaseCommandSourceAudit(context, { id: 'calendar:' + calendarHash(['calendar.series.plan.accepted', effect.table, effect.rowId, effect.seq]), family: 'workflow', action: 'calendar.series.plan.accepted',
      outcome: 'succeeded', occurredAt: effect.ts, target: { type: 'calendar.series', id: value.seriesId }, metadata: { sequence: effect.seq, controlRevision: 1, generation: 1, resourceCount: resources.length, participantCount: template.participants.length } });
    guard(); return result;
  });
  return Object.freeze({ run, assertCommitCurrent() { if (!ran) return forbidden(); guard(); } });
}
