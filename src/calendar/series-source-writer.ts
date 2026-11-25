/** Private initial-source acceptance only. No registry, reservations, coverage or automatic native authority is enabled.
 * The managed broker MUST install command.assertCommitCurrent under its actual DatabaseCommitAuthority.
 * Calling run() alone is not evidence of cross-file/SYSTEM commit qualification. */
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { appendDatabaseCommandSourceAudit } from '../databases/database-command-source-audit';
import type { CalendarRequestAuthority } from './authority';
import type { CalendarParticipantDirectory } from './participants-directory';
import type { CalendarOwnerRecord } from './owner-schema';
import type { ResolvedCalendarConfig } from './config';
import type { CalendarTimedInterval } from './time';
import type { CalendarTimedSeriesAuthoring } from './series-authoring';
import { admitCalendarTimedSeriesAuthoring, normalizeCalendarTimedSeriesAuthoring } from './series-authoring';
import { calendarRecurrenceTraversal } from './recurrence-engine';
import { admitCalendarBookingHardCandidate } from './booking-admission';
import { calendarResource, requireCalendarRight } from './realm-model';
import { calendarHumanRequestId, readCalendarHumanKeyClaim } from './human-request-key';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarScope, calendarText } from './validation';
import { CALENDAR_SERIES_CAPACITY } from './realm-series-migration';
import { CalendarError } from './error';

export interface CalendarSeriesPlanAcceptance {
  readonly operation: 'series.plan.accepted'; readonly requestId: string; readonly seriesId: string;
  readonly controlRevision: 1; readonly preparationId: string; readonly basePublicationId: null;
}
declare const requestBrand: unique symbol, compilationBrand: unique symbol;
export interface CalendarInitialSeriesRequest { readonly [requestBrand]: true }
export interface CalendarInitialSeriesCompilation { readonly [compilationBrand]: true }
interface Request {
  readonly scopeId: string; readonly principal: string; readonly userId: string; readonly requestId: string; readonly seriesId: string;
  readonly digest: string; readonly authoring: CalendarTimedSeriesAuthoring;
}
interface Compilation {
  readonly request: Request; readonly interval: Readonly<CalendarTimedInterval>;
  readonly engineGeneration: string; readonly assertEngineCurrent: () => void;
}
const requests = new WeakMap<object, Request>(), compilations = new WeakMap<object, Compilation>();
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function forbidden(): never { throw new CalendarError('CALENDAR_FORBIDDEN'); }
function state(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function synchronous(run: () => unknown): void {
  const result = invokeSynchronousAuthCallback(run, { component: 'calendar-series', invariant: 'native-series-guard-is-synchronous', message: 'Calendar series guards must not yield.' });
  if (result !== undefined) forbidden();
}
function request(handle: CalendarInitialSeriesRequest): Request {
  const result = handle && typeof handle === 'object' ? requests.get(handle) : undefined;
  if (!result) return forbidden(); return result;
}
function hash(value: unknown): string { const result = calendarText(value, 64); if (!/^[a-f0-9]{64}$/.test(result)) return invalid(); return result; }
function opaque<T>(map: WeakMap<object, T>, value: T): object { const handle = Object.freeze({}); map.set(handle, value); return handle; }

/** Structural normalization only: exact replay can be resolved before touching Temporal or current selected catalogs. */
export function prepareCalendarInitialSeriesRequest(authority: CalendarRequestAuthority, requestInput: string, input: unknown,
  limits: Pick<ResolvedCalendarConfig, 'maxResources' | 'maxParticipants'>): CalendarInitialSeriesRequest {
  synchronous(authority.guard);
  const actor = authority.actor, scopeId = calendarScope(serviceDataScopeKey(authority.scope));
  if (!actor.manageAll || actor.scopeId !== scopeId) return forbidden();
  const principal = calendarText(actor.principal, 256), userId = calendarKey(actor.userId), requestId = calendarKey(requestInput);
  const seriesId = calendarHash(['calendar.series.v1', scopeId, principal, requestId]), authoring = normalizeCalendarTimedSeriesAuthoring(input, { maxResources: limits.maxResources, maxParticipants: limits.maxParticipants });
  const value = Object.freeze({ scopeId, principal, userId, requestId, seriesId, authoring, digest: calendarHash(['series.create.v1', seriesId, authoring]) });
  synchronous(authority.guard); return opaque(requests, value) as CalendarInitialSeriesRequest;
}

/** Fixed native DTSTART compilation, outside all SQL/Guardian leases. Caller JSON cannot reconstruct this proof. */
export function compileCalendarInitialSeriesRequest(handle: CalendarInitialSeriesRequest): CalendarInitialSeriesCompilation {
  const value = request(handle), admitted = admitCalendarTimedSeriesAuthoring(value.authoring, { maxResources: 16, maxParticipants: 100 });
  const traversal = calendarRecurrenceTraversal(value.authoring.recurrence);
  if (calendarHash(traversal.original) !== calendarHash(admitted.original)) throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  traversal.assertCurrent();
  return opaque(compilations, Object.freeze({ request: value, interval: admitted.interval, engineGeneration: calendarHash(traversal.engine), assertEngineCurrent: traversal.assertCurrent })) as CalendarInitialSeriesCompilation;
}

export interface CalendarInitialSeriesManagedDependencies {
  readonly owner: CalendarOwnerRecord; readonly scope: ServiceDataScope;
  readonly config: Pick<ResolvedCalendarConfig, 'maxResources' | 'maxParticipants' | 'participants'>;
  readonly policyGeneration: string; readonly preparationTtlMs: number;
  readonly participants?: Pick<CalendarParticipantDirectory, 'assertBindable'>;
  /** Native physical owner/root/realm/lifetime equality, not an authored source claim. */
  assertOwnerCurrent(owner: CalendarOwnerRecord): void;
  /** Explicit configured service authority; this does not impersonate the initiating human on later work. */
  assertSeriesAuthorityCurrent(policyGeneration: string): void;
}
export interface CalendarInitialSeriesCommand {
  /** Call inside the broker's tracked native writer. The capability is never an IPC/browser payload. */
  run(context: DatabaseWriteCommandContext): CalendarSeriesPlanAcceptance;
  /** Mandatory actual-COMMIT callback, composed with the broker's Guardian revision/lease fence. */
  assertCommitCurrent(): void;
}

/** Constructs one private command from code-owned dependencies. No session, grant or ambient SYSTEM fallback is invented. */
export function createCalendarInitialSeriesCommand(dependencies: CalendarInitialSeriesManagedDependencies,
  authority: CalendarRequestAuthority, requestHandle: CalendarInitialSeriesRequest,
  compiled?: CalendarInitialSeriesCompilation): CalendarInitialSeriesCommand {
  const value = request(requestHandle), scopeId = calendarScope(serviceDataScopeKey(dependencies.scope));
  const owner = Object.freeze({ ...dependencies.owner }), policyGeneration = hash(dependencies.policyGeneration);
  const ttl = calendarInteger(dependencies.preparationTtlMs, 1_000, 86_400_000);
  if (owner.established !== 1 || owner.scope_id !== scopeId || owner.id !== 'calendar:' + calendarHash(scopeId)
    || !/^[a-f0-9]{64}$/.test(owner.root_hash) || !/^sha256:[a-f0-9]{64}$/.test(owner.realm_fingerprint)) return state();
  if (scopeId !== value.scopeId || serviceDataScopeKey(authority.scope) !== scopeId || authority.actor.scopeId !== scopeId
    || authority.actor.principal !== value.principal || authority.actor.userId !== value.userId || !authority.actor.manageAll) return forbidden();
  const checkOwner = dependencies.assertOwnerCurrent.bind(dependencies), checkPolicy = dependencies.assertSeriesAuthorityCurrent.bind(dependencies);
  const directory = dependencies.participants, config = dependencies.config;
  const maximumResources = calendarInteger(config.maxResources, 1, 16), maximumParticipants = calendarInteger(config.maxParticipants, 1, 100);
  const participantPolicy = calendarHash(config.participants), participantMethod = directory?.assertBindable;
  const assertParticipants = participantMethod?.bind(directory), assertAuthority = authority.guard.bind(authority);
  const assertConfiguration = () => {
    if (dependencies.config !== config || config.maxResources !== maximumResources || config.maxParticipants !== maximumParticipants || calendarHash(config.participants) !== participantPolicy
      || dependencies.participants !== directory || directory?.assertBindable !== participantMethod) throw new CalendarError('CALENDAR_POLICY_STALE');
  };
  let ran = false, fresh = false, assertEngineCurrent: (() => void) | undefined;
  const guard = () => {
    if (!(authority.signal instanceof AbortSignal)) return forbidden(); authority.signal.throwIfAborted();
    synchronous(assertAuthority); synchronous(() => checkOwner(owner));
    if (serviceDataScopeKey(authority.scope) !== scopeId || authority.actor.scopeId !== scopeId || authority.actor.principal !== value.principal
      || authority.actor.userId !== value.userId || !authority.actor.manageAll) return forbidden();
    if (fresh) {
      assertConfiguration();
      if (assertEngineCurrent) synchronous(assertEngineCurrent);
      synchronous(() => checkPolicy(policyGeneration));
      if (value.authoring.template.participants.length) {
        if (!config.participants || !assertParticipants) throw new CalendarError('CALENDAR_NOT_READY');
        synchronous(() => assertParticipants(authority.scope, value.authoring.template.participants));
      }
      if (assertEngineCurrent) synchronous(assertEngineCurrent);
      assertConfiguration();
    }
    synchronous(assertAuthority);
  };
  const accepted = (): CalendarSeriesPlanAcceptance => Object.freeze({ operation: 'series.plan.accepted', requestId: value.requestId, seriesId: value.seriesId,
    controlRevision: 1, preparationId: calendarHash(['calendar.series.preparation.v1', scopeId, value.seriesId, 1]), basePublicationId: null });
  const run = (context: DatabaseWriteCommandContext) => context.db.transaction(() => {
    if (ran) return forbidden(); ran = true; guard();
    if (context.db.get('_calendar_series_state', 'application')?.version !== 20) throw new CalendarError('CALENDAR_NOT_READY');
    const storedOwner = context.db.get('_calendar_owner', 'application');
    if (storedOwner?.scope_id !== scopeId || storedOwner.owner_id !== owner.owner_id) return state();
    const resources = value.authoring.template.resourceIds.map(id => {
      const row = calendarResource(context, authority.actor, id); requireCalendarRight(context, authority.actor, row, 'book'); return row;
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
    const proof = compiled && typeof compiled === 'object' ? compilations.get(compiled) : undefined;
    if (!proof || proof.request !== value) return forbidden();
    assertEngineCurrent = proof.assertEngineCurrent; synchronous(assertEngineCurrent);
    if (resources.some(row => row.active !== 1)) return forbidden();
    if (context.db.get('calendar_series', value.seriesId)) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
    const template = value.authoring.template;
    // Preparation checks hard policy only. It does not reserve DTSTART or
    // promise subsequent occurrences are conflict-free/covered/published.
    admitCalendarBookingHardCandidate(context, scopeId, { resourceIds: template.resourceIds, interval: proof.interval,
      ...(template.appointmentType ? { appointmentType: template.appointmentType } : {}), ...(template.visit ? { visit: template.visit } : {}) },
    { type: true, visit: true, availabilityResourceIds: template.resourceIds, occupancy: false });
    for (const table of ['calendar_series', '_calendar_series_generations', '_calendar_series_segments', '_calendar_series_grants', '_calendar_series_preparations', '_calendar_series_receipts', '_calendar_series_effect_intents'] as const) {
      const capacity = context.db.get('_calendar_series_capacity', table);
      if (!capacity || !Number.isSafeInteger(capacity.count) || Number(capacity.count) < 0 || capacity.ceiling !== CALENDAR_SERIES_CAPACITY[table] || Number(capacity.count) > Number(capacity.ceiling)) return state();
      if (capacity.count === capacity.ceiling) throw new CalendarError('CALENDAR_CAPACITY');
    }
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
