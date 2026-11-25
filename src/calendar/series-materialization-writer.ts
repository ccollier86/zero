/** Private native021 begin/stage/abort. This module supplies actor-local DB
 * admission, not SYSTEM participant authority. Its managed broker MUST retain
 * the real DatabaseCommitAuthority/Guardian final fence for every physical step. */
import { createHash } from 'node:crypto';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import { cloneDatabaseSerializableValue, type DatabaseSerializableValue } from '../databases/database-operations';
import { stableStringify } from '../migrations/schema-snapshot';
import type { Row } from '../sync/types';
import { CalendarError, calendarCommand } from './error';
import { calendarNow } from './hold-time';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarScope } from './validation';
import { normalizeCalendarTimedSeriesAuthoring } from './series-authoring';
import { normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { admitCalendarBookingCandidate, type CalendarBookingCandidate } from './booking-admission';
import { CALENDAR_SERIES_OCCUPANCY_QUERY } from './series-occupancy';
import { CALENDAR_SERIES_PUBLICATION_QUERY } from './series-publication-query';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as t } from './realm-series-materialization-migration';
import { verifyCalendarSeriesNativeEnvelope, calendarSeriesNativeSemanticDigest, type CalendarSeriesNativeEnvelope } from './series-native-transport';
import type { CalendarSeriesCompilationBinding } from './series-compilation';
import type { CalendarSeriesProjectionCheckpoint, CalendarSeriesProjectionInstruction } from './series-projection';
import type { CalendarRecurrenceCheckpoint } from './recurrence-cursor';
import { compareCalendarRecurrenceDates } from './recurrence-engine';
import { assertCalendarSeriesSelectedDerivationCurrent, deriveCalendarSeriesSelectedMaterialization,
  calendarSeriesSelectedMaterializationCleanupPending, CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT } from './series-materialization-derivation';

export interface CalendarSeriesMaterializationReceipt {
  readonly kind: 'calendar-series-native-receipt-v1'; readonly operation: string; readonly runId: string;
  readonly receiptId: string; readonly revision: number; readonly progressDigest: string;
  readonly projectionDigest: string; readonly semanticDigest: string;
}
type Source = CalendarSeriesCompilationBinding;
type Deltas = Record<'candidate_delta' | 'resource_delta' | 'claim_delta' | 'cell_delta' | 'member_delta' | 'selector_delta' | 'working_member_delta', number>;
const EMPTY_DELTAS: Deltas = { candidate_delta: 0, resource_delta: 0, claim_delta: 0, cell_delta: 0, member_delta: 0, selector_delta: 0, working_member_delta: 0 };
const COUNTERS = { candidate_count: 'candidate_delta', resource_count: 'resource_delta', claim_count: 'claim_delta', cell_count: 'cell_delta', member_count: 'member_delta', selector_count: 'selector_delta', working_member_count: 'working_member_delta' } as const;
const LIMIT = 256, DAY = 86_400_000;
function reject(code: 'CALENDAR_STATE_INVALID' | 'CALENDAR_REVISION_CONFLICT' | 'CALENDAR_INTENT_CONFLICT' | 'CALENDAR_NOT_READY' | 'CALENDAR_FORBIDDEN' | 'CALENDAR_INPUT_INVALID' = 'CALENDAR_STATE_INVALID'): never { throw new CalendarError(code); }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return reject('CALENDAR_INPUT_INVALID'); return value; }
function same(left: unknown, right: unknown): boolean { return stableStringify(left) === stableStringify(right); }
function digest(value: unknown): string { return createHash('sha256').update('calendar-series-native-writer-v1\0').update(stableStringify(value)).digest('hex'); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> { return calendarRecord(cloneDatabaseSerializableValue(value), fields); }
function required(row: Row | null, scope: string): Row { if (!row || row.scope_id !== scope) return reject(); return row; }
function number(value: unknown): number { return calendarInteger(value, 0); }
function projectionDigest(value: unknown): string { return calendarHash(['calendar-series-projection-progress-v1', value]); }
function root(domain: string, runId: string): string { return calendarHash([domain, runId]); }

export function calendarSeriesMaterializationReceiptId(source: Pick<Source, 'scopeId' | 'ownerId' | 'sourceId' | 'sourceGeneration'>,
  runId: string, phase: 'batch' | 'publish' | 'reconcile', logicalKey: string): string {
  return calendarHash(['calendar-series-native-v1', source.scopeId, source.ownerId, source.sourceId, source.sourceGeneration, runId, phase, logicalKey]);
}
function outcome(frame: CalendarSeriesNativeEnvelope, receipt: Row): CalendarSeriesMaterializationReceipt {
  return Object.freeze({ kind: 'calendar-series-native-receipt-v1', operation: frame.command, runId: String(receipt.run_id), receiptId: String(receipt.id),
    revision: number(receipt.revision), progressDigest: hash(receipt.after_digest), projectionDigest: hash(receipt.projection_after_digest), semanticDigest: hash(receipt.candidate_digest) });
}
/** Signature authenticates code-owned compilation provenance, not live authority. */
function owner(context: DatabaseWriteCommandContext, frame: CalendarSeriesNativeEnvelope): Source {
  const s = frame.source;
  if (context.db.get(t.state, 'application')?.version !== 21 || context.db.get('_calendar_series_state', 'application')?.version !== 20) return reject('CALENDAR_NOT_READY');
  const physical = context.db.get('_calendar_owner', 'application');
  if (!physical || physical.scope_id !== s.scopeId || physical.owner_id !== s.ownerId) return reject('CALENDAR_FORBIDDEN');
  const series = required(context.db.get('calendar_series', s.seriesId), s.scopeId);
  if (series.owner_id !== s.ownerId || series.source_id !== s.sourceId) return reject('CALENDAR_FORBIDDEN');
  return s;
}
function prior(context: DatabaseWriteCommandContext, frame: CalendarSeriesNativeEnvelope, runId: string, phase: 'batch' | 'publish' | 'reconcile') {
  const id = calendarSeriesMaterializationReceiptId(frame.source, runId, phase, frame.logicalKey), semantic = calendarSeriesNativeSemanticDigest(frame);
  const row = context.db.get(t.receipts, id);
  if (row && (row.scope_id !== frame.source.scopeId || row.run_id !== runId || row.phase !== phase || row.logical_key !== frame.logicalKey || row.candidate_digest !== semantic)) return reject('CALENDAR_INTENT_CONFLICT');
  return { id, semantic, row };
}
/** No Temporal expansion or session reconstruction occurs in this transaction. */
function current(context: DatabaseWriteCommandContext, s: Source, run?: Row, operation: 'prepare' | 'commit' = 'prepare'): ReturnType<typeof normalizeCalendarTimedSeriesAuthoring> {
  const now = calendarNow(), series = required(context.db.get('calendar_series', s.seriesId), s.scopeId);
  const generation = required(context.db.get('_calendar_series_generations', s.generationId), s.scopeId);
  const grant = required(context.db.get('_calendar_series_grants', s.grant.grantId), s.scopeId);
  const acceptance = required(context.db.get('_calendar_series_receipts', String(generation.acceptance_receipt_id)), s.scopeId);
  if (series.lifecycle !== 'active' || series.owner_id !== s.ownerId || series.source_id !== s.sourceId || series.control_revision !== s.controlRevision
    || series.current_grant_id !== s.grant.grantId || series.grant_epoch !== s.grant.grantEpoch
    || generation.series_id !== s.seriesId || generation.generation !== s.sourceGeneration || generation.authoring_digest !== s.authoringDigest
    || generation.engine_generation !== s.engineGeneration || generation.policy_generation !== s.policyGeneration
    || grant.series_id !== s.seriesId || grant.generation_id !== s.generationId || grant.owner_id !== s.ownerId || grant.source_id !== s.sourceId
    || grant.source_generation !== s.sourceGeneration || grant.issued_epoch !== s.grant.grantEpoch || grant.authority_digest !== s.grant.authorityDigest
    || grant.resource_digest !== s.grant.resourceDigest || grant.resource_ids_json !== calendarJson(s.selections.resourceIds)
    || acceptance.series_id !== s.seriesId || acceptance.generation_id !== s.generationId || acceptance.digest !== s.intentDigest || grant.issuance_receipt_id !== acceptance.id
    || !JSON.parse(String(grant.operations_json)).includes('series.coverage.' + operation) || s.exceptionRevision !== 0) return reject('CALENDAR_FORBIDDEN');
  const authoring = normalizeCalendarTimedSeriesAuthoring(JSON.parse(String(generation.authoring_json)), { maxResources: 16, maxParticipants: 100 });
  if (calendarHash(authoring) !== s.authoringDigest || !same({ resourceIds: authoring.template.resourceIds, appointmentType: authoring.template.appointmentType,
    visit: authoring.template.visit, participants: authoring.template.participants }, s.selections)) return reject();
  const segment = required(context.db.get('_calendar_series_segments', s.segmentRecordId), s.scopeId);
  if (segment.generation_id !== s.generationId || segment.series_id !== s.seriesId || segment.source_digest !== s.authoringDigest
    || s.segmentId !== calendarHash(['calendar.series.segment.v1', s.scopeId, s.seriesId, segment.segment_key])) return reject();
  if (s.preparationExpiresAtMs <= now || run && (number(run.expires_ms) <= now || run.generation_id !== s.generationId || run.grant_id !== s.grant.grantId
    || run.grant_epoch !== s.grant.grantEpoch || run.root_hash !== s.rootHash || run.realm_fingerprint !== s.realmFingerprint
    || run.policy_generation !== s.policyGeneration || run.engine_generation !== s.engineGeneration || run.plan_digest !== s.planManifestDigest
    || run.resource_digest !== s.grant.resourceDigest || run.resource_vector_json !== calendarJson(s.resourceRevisions))) return reject('CALENDAR_NOT_READY');
  const cutover = run ? run.kind === 'cutover' : series.published_publication_id === null;
  if (cutover) {
    const p = required(context.db.get('_calendar_series_preparations', s.preparationId), s.scopeId);
    if (series.active_preparation_id !== p.id || !['preparing', 'blocked'].includes(String(p.state)) || p.generation_id !== s.generationId
      || p.grant_id !== s.grant.grantId || p.grant_epoch !== s.grant.grantEpoch || p.manifest_digest !== s.planManifestDigest
      || p.base_publication_id !== s.basePublicationId || series.published_publication_id !== s.basePublicationId || p.expires_ms !== s.preparationExpiresAtMs || p.expires_ms <= now) return reject('CALENDAR_NOT_READY');
  } else {
    const p = required(context.db.get('_calendar_series_publications', String(series.published_publication_id)), s.scopeId);
    if (series.active_preparation_id !== null || series.published_generation_id !== s.generationId || p.generation_id !== s.generationId
      || p.series_id !== s.seriesId || p.manifest_digest !== s.planManifestDigest || run && run.source_publication_id !== p.id) return reject('CALENDAR_NOT_READY');
  }
  if (s.resourceRevisions.length !== s.selections.resourceIds.length) return reject();
  for (let index = 0; index < s.resourceRevisions.length; index++) {
    const revision = s.resourceRevisions[index]!, resource = required(context.db.get('calendar_resources', revision.id), s.scopeId);
    if (revision.id !== s.selections.resourceIds[index] || resource.active !== 1 || resource.revision !== revision.revision) return reject('CALENDAR_REVISION_CONFLICT');
  }
  return authoring;
}
function receiptRow(frame: CalendarSeriesNativeEnvelope, run: Row, head: Row, claim: { id: string; semantic: string }, phase: 'batch' | 'publish' | 'reconcile',
  deltas: Deltas, rows: number, before: string, after: string, projectionBefore: string, projectionAfter: string): Row {
  return { id: claim.id, scope_id: frame.source.scopeId, run_id: run.id, phase, logical_key: frame.logicalKey, revision: head.revision,
    candidate_digest: claim.semantic, before_digest: before, after_digest: after, policy_digest: run.policy_generation,
    projection_before_digest: projectionBefore, projection_after_digest: projectionAfter, row_count: rows, ...deltas, accepted_ms: calendarNow() };
}
export function beginCalendarSeriesMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return beginMaterialization(context, input, false);
}
/** Fixed private022 entry. The strategy is code-owned, never command JSON. */
export function beginCalendarSeriesSelectedMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return beginMaterialization(context, input, true);
}
function beginMaterialization(context: DatabaseWriteCommandContext, input: unknown, selected: boolean) {
  return calendarCommand(() => context.db.transaction(() => {
    const frame = verifyCalendarSeriesNativeEnvelope(context.writerPolicy, input, 'calendar.series.run.begin'), s = owner(context, frame);
    const r = record(frame.payload, ['runId', 'kind', 'sourcePublicationId', 'windowFromMs', 'windowUntilMs', 'nominalFrom', 'nominalUntil', 'initialProgressDigest', 'initialProjectionCheckpoint']);
    const runId = calendarKey(r.runId), claim = prior(context, frame, runId, 'batch'); if (claim.row) return outcome(frame, claim.row);
    if (selected) assertCalendarSeriesSelectedDerivationCurrent(context, s);
    current(context, s);
    if (r.kind !== 'cutover' && r.kind !== 'horizon') return reject('CALENDAR_INPUT_INVALID');
    const series = required(context.db.get('calendar_series', s.seriesId), s.scopeId);
    if ((r.kind === 'cutover') !== (series.active_preparation_id === s.preparationId) || r.kind === 'horizon' && r.sourcePublicationId !== series.published_publication_id) return reject('CALENDAR_REVISION_CONFLICT');
    const checkpoint = record(r.initialProjectionCheckpoint, ['kind', 'bindingDigest', 'candidateOrdinal', 'phase', 'resourceOrdinal', 'cellOrdinal', 'instructionCount', 'rowCount', 'manifestRootDigest']);
    if (checkpoint.kind !== 'calendar-series-projection-checkpoint-v1' || checkpoint.candidateOrdinal !== 0 || checkpoint.resourceOrdinal !== 0 || checkpoint.cellOrdinal !== 0
      || checkpoint.instructionCount !== 0 || checkpoint.rowCount !== 0 || !['occurrence', 'complete'].includes(String(checkpoint.phase))) return reject('CALENDAR_INPUT_INVALID');
    hash(checkpoint.bindingDigest); hash(checkpoint.manifestRootDigest);
    if (context.db.get(t.runs, runId)) return reject('CALENDAR_INTENT_CONFLICT');
    const segment = required(context.db.get('_calendar_series_segments', s.segmentRecordId), s.scopeId), mappingId = calendarHash(['calendar-series-generation-segment-v1', s.scopeId, s.generationId, s.segmentRecordId]);
    const logical = context.db.get(t.logicalSegments, s.segmentId);
    if (!logical) context.db.createStrict(t.logicalSegments, { id: s.segmentId, scope_id: s.scopeId, series_id: s.seriesId, segment_key: segment.segment_key });
    else if (logical.scope_id !== s.scopeId || logical.series_id !== s.seriesId || logical.segment_key !== segment.segment_key) return reject();
    if (!context.db.get(t.generationSegments, mappingId)) context.db.createStrict(t.generationSegments, { id: mappingId, scope_id: s.scopeId, series_id: s.seriesId,
      generation_id: s.generationId, generation_segment_id: s.segmentRecordId, logical_segment_id: s.segmentId });
    const now = calendarNow(), from = calendarInteger(r.windowFromMs, -8640000000000000, 8640000000000000), until = calendarInteger(r.windowUntilMs, from + 1, 8640000000000000);
    const run: Row = { id: runId, scope_id: s.scopeId, series_id: s.seriesId, generation_id: s.generationId, grant_id: s.grant.grantId, grant_epoch: s.grant.grantEpoch,
      owner_id: s.ownerId, source_id: s.sourceId, initial_receipt_id: claim.id, source_binding_json: calendarJson(s), root_hash: s.rootHash, realm_fingerprint: s.realmFingerprint, resource_vector_json: calendarJson(s.resourceRevisions),
      kind: r.kind, source_preparation_id: r.kind === 'cutover' ? s.preparationId : null, source_publication_id: calendarKey(r.sourcePublicationId),
      base_source_publication_id: r.kind === 'cutover' ? s.basePublicationId : String(series.published_publication_id), plan_digest: s.planManifestDigest,
      engine_generation: s.engineGeneration, policy_generation: s.policyGeneration, resource_digest: s.grant.resourceDigest,
      window_from_ms: from, window_until_ms: until, nominal_from: String(r.nominalFrom), nominal_until: String(r.nominalUntil), initial_progress_digest: hash(r.initialProgressDigest), created_ms: now, expires_ms: s.preparationExpiresAtMs };
    const head: Row = { id: runId, scope_id: s.scopeId, revision: 1, state: 'preparing', phase: 'pending', progress_id: null, last_receipt_id: claim.id,
      projection_cursor_json: calendarJson(checkpoint), projection_complete: 0, candidate_count: 0, resource_count: 0, claim_count: 0, cell_count: 0, member_count: 0, selector_count: 0, working_member_count: 0,
      receipt_base_json: calendarJson(Object.fromEntries(Object.keys(COUNTERS).map(name => [name, 0]))),
      candidate_root: root('calendar-series-candidates-empty-v1', runId), projection_root: root('calendar-series-projection-empty-v1', runId), cell_root: root('calendar-series-cells-empty-v1', runId), publication_id: null, updated_ms: now };
    context.db.createStrict(t.runs, run); context.db.createStrict(t.runState, head);
    const extra = selected ? deriveCalendarSeriesSelectedMaterialization(context, { phase: 'begin', source: s, run, head, receiptId: claim.id, logicalKey: frame.logicalKey, semanticDigest: claim.semantic, budget: LIMIT }) : 0;
    const receipt = receiptRow(frame, run, head, claim, 'batch', { ...EMPTY_DELTAS }, extra, String(run.initial_progress_digest), String(run.initial_progress_digest), projectionDigest(checkpoint), projectionDigest(checkpoint));
    context.db.createStrict(t.receipts, receipt); return outcome(frame, receipt);
  }));
}

function ownedRun(context: DatabaseWriteCommandContext, s: Source, runId: string): { run: Row; head: Row } {
  const run = required(context.db.get(t.runs, runId), s.scopeId), head = required(context.db.get(t.runState, runId), s.scopeId);
  if (run.series_id !== s.seriesId || run.generation_id !== s.generationId || run.owner_id !== s.ownerId || run.source_id !== s.sourceId
    || run.source_binding_json !== calendarJson(s)) return reject('CALENDAR_FORBIDDEN');
  return { run, head };
}
function admit(context: DatabaseWriteCommandContext, s: Source, versionId: string, candidate: CalendarBookingCandidate) {
  // Exclude ONLY this exact retained child version while revalidating its next
  // physical step. All ordinary/peer/staged series reservations remain visible.
  const read = { db: context.db, query(name: string, input: DatabaseSerializableValue) {
    if (name !== CALENDAR_SERIES_OCCUPANCY_QUERY) return reject();
    return context.query(name, { ...(input as Record<string, DatabaseSerializableValue>), excludeVersionIds: [versionId] });
  } };
  return admitCalendarBookingCandidate(read, s.scopeId, candidate, { type: true, visit: true, availabilityResourceIds: candidate.resourceIds, occupancy: { now: calendarNow() } });
}
function versionBooking(row: Row): { booking: CalendarBookingCandidate; title: string; participants: unknown; admittedType: unknown; admittedVisit: unknown } {
  return JSON.parse(String(row.booking_json));
}
function qualifyCompilerProgress(context: DatabaseWriteCommandContext, s: Source, run: Row, previous: Row | null,
  compiler: { beforeDigest: string; afterDigest: string; checkpoint: CalendarRecurrenceCheckpoint; continuation?: {
    kind: string; previousDigest: string; previousCheckpoint: CalendarRecurrenceCheckpoint; initialDigest: string; initialCheckpoint: CalendarRecurrenceCheckpoint } }): void {
  const end = compiler.checkpoint, expected = previous ? String(previous.after_digest) : String(run.initial_progress_digest);
  if (end.range.from !== run.nominal_from || end.range.until !== run.nominal_until || end.binding.scopeId !== s.scopeId || end.binding.seriesId !== s.seriesId
    || end.binding.segmentId !== s.segmentId || end.binding.sourceGeneration !== s.sourceGeneration || end.sourceDigest !== s.recurrenceDigest
    || end.originalDigest !== s.originalDigest || calendarHash(end.engine) !== s.engineGeneration
    || calendarHash({ domain: 'calendar-recurrence-checkpoint-v1', checkpoint: end }) !== compiler.afterDigest) return reject('CALENDAR_FORBIDDEN');
  if (compiler.beforeDigest === expected) { if (compiler.continuation) return reject('CALENDAR_FORBIDDEN'); return; }
  const transition = compiler.continuation;
  if (previous || run.kind !== 'horizon' || !transition || transition.kind !== 'calendar-series-window-transition-v1') return reject('CALENDAR_REVISION_CONFLICT');
  const heads = context.db.find(t.continuationHeads, { filters: [
    { type: 'field', field: 'scope_id', operator: 'eq', value: s.scopeId }, { type: 'field', field: 'series_id', operator: 'eq', value: s.seriesId },
    { type: 'field', field: 'generation_id', operator: 'eq', value: s.generationId }, { type: 'field', field: 'logical_segment_id', operator: 'eq', value: s.segmentId },
    { type: 'field', field: 'source_publication_id', operator: 'eq', value: String(run.source_publication_id) }], limit: 1 });
  const retained = heads[0] && context.db.get(t.progress, String(heads[0].progress_id)), old = transition.previousCheckpoint, initial = transition.initialCheckpoint;
  if (!retained || retained.scope_id !== s.scopeId || retained.after_digest !== expected || transition.previousDigest !== expected
    || !same(JSON.parse(String(retained.checkpoint_json)), old) || calendarHash({ domain: 'calendar-recurrence-checkpoint-v1', checkpoint: old }) !== expected
    || transition.initialDigest !== compiler.beforeDigest || calendarHash({ domain: 'calendar-recurrence-checkpoint-v1', checkpoint: initial }) !== compiler.beforeDigest
    || old.status !== 'range-complete' || initial.status !== 'active' || compareCalendarRecurrenceDates(initial.range.from, old.range.until) < 0
    || !same(initial.range, end.range) || !same(old.binding, initial.binding) || !same(initial.binding, end.binding)
    || old.sourceDigest !== initial.sourceDigest || initial.sourceDigest !== end.sourceDigest || old.originalDigest !== initial.originalDigest
    || initial.originalDigest !== end.originalDigest || !same(old.engine, initial.engine) || !same(initial.engine, end.engine)) return reject('CALENDAR_REVISION_CONFLICT');
  if (old.rruleCount !== null) {
    if (initial.rruleCount !== old.rruleCount || initial.nextCandidate !== old.nextCandidate || initial.examinedCandidates !== old.examinedCandidates || !same(initial.skipped, old.skipped)) return reject('CALENDAR_FORBIDDEN');
  } else if (initial.rruleCount !== null || initial.examinedCandidates !== 0 || initial.skipped.invalidDates !== 0 || initial.skipped.nonexistentTimes !== 0) return reject('CALENDAR_FORBIDDEN');
}
export function stageCalendarSeriesMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return stageMaterialization(context, input, false);
}
export function stageCalendarSeriesSelectedMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return stageMaterialization(context, input, true);
}
function stageMaterialization(context: DatabaseWriteCommandContext, input: unknown, selected: boolean) {
  return calendarCommand(() => context.db.transaction(() => {
    const frame = verifyCalendarSeriesNativeEnvelope(context.writerPolicy, input, 'calendar.series.run.stage'), s = owner(context, frame);
    const p = record(frame.payload, ['kind', 'runId', 'binding', 'instructions', 'rowCount', 'originalStepKey', 'stepDigest', 'progress', 'compilationProgress', 'compilationWork']);
    const runId = calendarKey(p.runId), claim = prior(context, frame, runId, 'batch'); if (claim.row) return outcome(frame, claim.row);
    if (selected) assertCalendarSeriesSelectedDerivationCurrent(context, s);
    if (selected && calendarInteger(p.rowCount, 0, LIMIT) > CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT) throw new CalendarError('CALENDAR_CAPACITY');
    const { run, head } = ownedRun(context, s, runId), authoring = current(context, s, run);
    if (head.publication_cursor_json !== undefined && head.publication_cursor_json !== '{}') return reject('CALENDAR_NOT_READY');
    if (!['preparing', 'blocked'].includes(String(head.state)) || p.kind !== 'calendar-series-projection-step-v1' || p.originalStepKey !== frame.logicalKey) return reject('CALENDAR_NOT_READY');
    const binding = p.binding as Record<string, unknown>, progress = p.progress as { beforeDigest: string; afterDigest: string; checkpoint: CalendarSeriesProjectionCheckpoint };
    const compiler = p.compilationProgress as Parameters<typeof qualifyCompilerProgress>[4], work = p.compilationWork as { evaluatedCandidates: number; completion: string };
    if (!binding || binding.runId !== runId || !same(binding.source, s) || binding.resourceVectorDigest !== calendarHash(s.resourceRevisions)
      || binding.bindingDigest !== progress.checkpoint.bindingDigest || !Array.isArray(p.instructions) || p.instructions.length > LIMIT) return reject('CALENDAR_INPUT_INVALID');
    const oldCheckpoint = JSON.parse(String(head.projection_cursor_json));
    const previousCompiler = head.progress_id === null ? null : required(context.db.get(t.progress, String(head.progress_id)), s.scopeId);
    qualifyCompilerProgress(context, s, run, previousCompiler, compiler);
    let startCheckpoint = oldCheckpoint;
    if (oldCheckpoint.bindingDigest !== binding.bindingDigest) {
      // A completed compiler batch may be followed by another bounded batch
      // without restarting the authored source or replaying COUNT history.
      if (head.projection_complete !== 1 || !previousCompiler || previousCompiler.after_digest !== compiler.beforeDigest) return reject('CALENDAR_REVISION_CONFLICT');
      startCheckpoint = { kind: 'calendar-series-projection-checkpoint-v1', bindingDigest: binding.bindingDigest, candidateOrdinal: 0,
        phase: p.instructions.length === 0 && progress.checkpoint.phase === 'complete' && progress.checkpoint.candidateOrdinal === 0 ? 'complete' : 'occurrence',
        resourceOrdinal: 0, cellOrdinal: 0, instructionCount: 0, rowCount: 0,
        manifestRootDigest: calendarHash(['calendar-series-projection-empty-v1', binding.bindingDigest]) };
    }
    if (projectionDigest(startCheckpoint) !== progress.beforeDigest || projectionDigest(progress.checkpoint) !== progress.afterDigest) return reject('CALENDAR_REVISION_CONFLICT');
    const instructions = p.instructions as CalendarSeriesProjectionInstruction[], deltas = { ...EMPTY_DELTAS }, validated = new Set<string>();
    const builders = new Map<string, { row: Row; count: number; root: string; fresh: boolean }>();
    let facts = 0, writes = 0, candidateRoot = String(head.candidate_root), projectionRoot = String(head.projection_root), cellRoot = String(head.cell_root);
    let batchRoot = startCheckpoint.manifestRootDigest, declaredRows = 0, instructionOrdinal = number(startCheckpoint.instructionCount);
    const create = (table: string, row: Row, delta?: keyof Deltas) => { if (++facts > LIMIT || ++writes > LIMIT) throw new CalendarError('CALENDAR_CAPACITY'); context.db.createStrict(table, row); if (delta) deltas[delta]++; };
    const checkVersion = (id: string): Row => {
      const row = required(context.db.get(t.versions, id), s.scopeId);
      if (row.run_id !== runId || row.series_id !== s.seriesId) return reject();
      if (!validated.has(id)) { admit(context, s, id, versionBooking(row).booking); validated.add(id); }
      return row;
    };
    for (const value of instructions) {
      const { digest: claimedDigest, ...body } = value;
      if (calendarHash(['calendar-series-projection-instruction-v1', body]) !== claimedDigest || value.bindingDigest !== binding.bindingDigest
        || value.batchDigest !== binding.batchDigest || value.resourceVectorDigest !== binding.resourceVectorDigest || value.scopeId !== s.scopeId
        || value.instructionOrdinal !== instructionOrdinal++) return reject('CALENDAR_FORBIDDEN');
      declaredRows += calendarInteger(value.rowCount, 1, 33); batchRoot = calendarHash(['calendar-series-projection-chain-v1', [batchRoot, value.digest]]);
      projectionRoot = calendarHash(['calendar-series-projection-chain-v1', projectionRoot, value.digest]);
      if (value.kind === 'occurrence') {
        if (value.seriesId !== s.seriesId || value.logicalSegmentId !== s.segmentId || value.id !== value.appointmentId
          || value.id !== calendarHash(['calendar-series-occurrence-v1', s.scopeId, s.seriesId, s.segmentId, value.nominalKey])) return reject();
        const old = context.db.get(t.occurrences, value.id);
        if (old) { if (old.scope_id !== s.scopeId || old.series_id !== s.seriesId || old.logical_segment_id !== s.segmentId || old.nominal_key !== value.nominalKey) return reject(); }
        else create(t.occurrences, { id: value.id, scope_id: s.scopeId, series_id: s.seriesId, logical_segment_id: s.segmentId, nominal_key: value.nominalKey, appointment_id: value.appointmentId, batch_receipt_id: claim.id });
      } else if (value.kind === 'version') {
        if (value.runId !== runId || value.seriesId !== s.seriesId || value.id !== value.versionDigest || value.resourceDigest !== s.grant.resourceDigest
          || !same(value.booking.resourceIds, s.selections.resourceIds) || value.title !== authoring.template.title || !same(value.participants, s.selections.participants)
          || !same(value.booking.appointmentType ?? null, s.selections.appointmentType) || !same(value.booking.visit ?? null, s.selections.visit)) return reject();
        const interval = normalizeCalendarTimedInterval({ startAt: value.booking.interval.startAt, endAt: value.booking.interval.endAt, timeZone: value.booking.interval.timeZone,
          bufferBeforeMinutes: value.booking.interval.bufferBeforeMinutes, bufferAfterMinutes: value.booking.interval.bufferAfterMinutes });
        if (!same(interval, value.booking.interval) || interval.bufferBeforeMinutes !== authoring.template.bufferBeforeMinutes || interval.bufferAfterMinutes !== authoring.template.bufferAfterMinutes) return reject();
        const admitted = admit(context, s, value.id, value.booking), effective = { booking: value.booking, title: value.title, participants: value.participants,
          admittedType: admitted.appointmentType ?? null, admittedVisit: admitted.visit ?? null };
        create(t.versions, { id: value.id, scope_id: s.scopeId, series_id: s.seriesId, occurrence_id: value.occurrenceId, run_id: runId, version_digest: value.versionDigest,
          booking_json: calendarJson(effective), start_ms: interval.startMs, end_ms: interval.endMs, occupied_from_ms: interval.occupiedStartMs, occupied_until_ms: interval.occupiedEndMs,
          resource_ids_json: calendarJson(s.selections.resourceIds), resource_digest: s.grant.resourceDigest, binding_digest: digest(effective), batch_receipt_id: claim.id }, 'candidate_delta');
        for (const resource of s.resourceRevisions) {
          create(t.resources, { id: calendarHash(['calendar-series-version-resource-v1', [value.id, resource.id]]), scope_id: s.scopeId, version_id: value.id, resource_id: resource.id, resource_revision: resource.revision, batch_receipt_id: claim.id }, 'resource_delta');
          create(t.claims, { id: calendarHash(['calendar-series-pending-claim-v1', [runId, value.id, resource.id]]), scope_id: s.scopeId, run_id: runId, version_id: value.id, resource_id: resource.id,
            from_ms: interval.occupiedStartMs, until_ms: interval.occupiedEndMs, expires_ms: run.expires_ms, batch_receipt_id: claim.id }, 'claim_delta');
        }
        validated.add(value.id); candidateRoot = calendarHash(['calendar-series-candidate-chain-v1', candidateRoot, value.id, value.candidateDigest, digest(effective)]);
      } else if (value.kind === 'resource') {
        const version = checkVersion(value.versionId), membership = required(context.db.get(t.resources, value.id), s.scopeId), reserved = required(context.db.get(t.claims, value.claimId), s.scopeId);
        if (membership.version_id !== version.id || membership.resource_id !== value.resourceId || membership.resource_revision !== value.resourceRevision
          || reserved.run_id !== runId || reserved.version_id !== version.id || reserved.resource_id !== value.resourceId || reserved.from_ms !== value.fromMs
          || reserved.until_ms !== value.untilMs || reserved.expires_ms !== value.expiresAtMs) return reject();
      } else if (value.kind === 'cell-member') {
        const version = checkVersion(value.versionId);
        if (value.runId !== runId || value.cellStartMs % DAY !== 0 || value.fromMs !== Math.max(Number(version.occupied_from_ms), value.cellStartMs)
          || value.untilMs !== Math.min(Number(version.occupied_until_ms), value.cellStartMs + DAY) || value.fromMs >= value.untilMs
          || value.cellSetId !== calendarHash(['calendar-series-cell-set-v1', [runId, value.resourceId, value.cellStartMs]])
          || value.id !== calendarHash(['calendar-series-cell-member-v1', [runId, value.versionId, value.resourceId, value.cellStartMs]])) return reject();
        let builder = builders.get(value.cellSetId);
        if (!builder) {
          let header = context.db.get(t.cellSets, value.cellSetId), fresh = false;
          if (!header) {
            create(t.cellSets, { id: value.cellSetId, scope_id: s.scopeId, run_id: runId, series_id: s.seriesId, resource_id: value.resourceId, cell_start_ms: value.cellStartMs, batch_receipt_id: claim.id }, 'cell_delta');
            const row = { id: value.cellSetId, scope_id: s.scopeId, run_id: runId, revision: 1, member_count: 0, member_root: root('calendar-series-cell-members-empty-v1', value.cellSetId), batch_receipt_id: claim.id };
            create(t.cellBuilders, row); fresh = true; header = row;
          }
          const row = required(context.db.get(t.cellBuilders, value.cellSetId), s.scopeId);
          if (row.run_id !== runId) return reject();
          builder = { row, count: 0, root: String(row.member_root), fresh }; builders.set(value.cellSetId, builder);
        }
        create(t.members, { id: value.id, scope_id: s.scopeId, cell_set_id: value.cellSetId, version_id: value.versionId, resource_id: value.resourceId,
          cell_start_ms: value.cellStartMs, from_ms: value.fromMs, until_ms: value.untilMs, batch_receipt_id: claim.id }, 'member_delta');
        builder.count++; builder.root = calendarHash(['calendar-series-cell-member-chain-v1', builder.root, value.digest]);
        cellRoot = calendarHash(['calendar-series-cell-chain-v1', cellRoot, value.digest]);
      } else return reject('CALENDAR_INPUT_INVALID');
    }
    for (const [id, builder] of builders) {
      if (++writes > LIMIT) throw new CalendarError('CALENDAR_CAPACITY');
      if (!builder.fresh && ++facts > LIMIT) throw new CalendarError('CALENDAR_CAPACITY');
      context.db.update(t.cellBuilders, id, { revision: number(builder.row.revision) + 1, member_count: number(builder.row.member_count) + builder.count,
        member_root: builder.root, batch_receipt_id: claim.id });
    }
    if (declaredRows !== calendarInteger(p.rowCount, 0, LIMIT) || progress.checkpoint.instructionCount !== instructionOrdinal
      || progress.checkpoint.rowCount !== number(startCheckpoint.rowCount) + declaredRows || progress.checkpoint.manifestRootDigest !== batchRoot) return reject('CALENDAR_REVISION_CONFLICT');
    let progressId = head.progress_id, before = previousCompiler ? String(previousCompiler.after_digest) : String(run.initial_progress_digest), after = before;
    if (progress.checkpoint.phase === 'complete') {
      after = hash(compiler.afterDigest); progressId = calendarHash(['calendar-series-run-progress-v1', runId, claim.id]);
      create(t.progress, { id: progressId, scope_id: s.scopeId, run_id: runId, revision: previousCompiler ? number(previousCompiler.revision) + 1 : 1,
        before_digest: before, after_digest: after, checkpoint_json: calendarJson(compiler.checkpoint), evaluated_candidates: calendarInteger(work.evaluatedCandidates, 0, 4096),
        completion: work.completion, batch_receipt_id: claim.id, created_ms: calendarNow() });
    }
    const next: Row = { ...head, revision: number(head.revision) + 1, state: 'preparing', last_receipt_id: claim.id, progress_id: progressId,
      receipt_base_json: calendarJson(Object.fromEntries(Object.keys(COUNTERS).map(name => [name, number(head[name])]))),
      projection_cursor_json: calendarJson(progress.checkpoint), projection_complete: progress.checkpoint.phase === 'complete' ? 1 : 0,
      candidate_root: candidateRoot, projection_root: projectionRoot, cell_root: cellRoot, updated_ms: calendarNow() };
    for (const [counter, delta] of Object.entries(COUNTERS)) next[counter] = number(head[counter]) + deltas[delta];
    context.db.updateIfCurrent(t.runState, runId, next, head);
    if (selected) {
      const extra = deriveCalendarSeriesSelectedMaterialization(context, { phase: 'stage', source: s, run, head: next, receiptId: claim.id, logicalKey: frame.logicalKey, semanticDigest: claim.semantic, budget: LIMIT - Math.max(facts, writes) });
      facts += extra; writes += extra;
      if (Math.max(facts, writes) > LIMIT) throw new CalendarError('CALENDAR_CAPACITY');
    }
    const receipt = receiptRow(frame, run, next, claim, 'batch', deltas, facts, before, after, progress.beforeDigest, progress.afterDigest);
    context.db.createStrict(t.receipts, receipt); return outcome(frame, receipt);
  }));
}

export function abortCalendarSeriesMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return abortMaterialization(context, input, false);
}
export function abortCalendarSeriesSelectedMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return abortMaterialization(context, input, true);
}
function abortMaterialization(context: DatabaseWriteCommandContext, input: unknown, selected: boolean) {
  return calendarCommand(() => context.db.transaction(() => {
    const frame = verifyCalendarSeriesNativeEnvelope(context.writerPolicy, input, 'calendar.series.run.abort'), s = owner(context, frame);
    const p = record(frame.payload, ['runId', 'expectedRevision', 'limit', 'cleanupOnly']), runId = calendarKey(p.runId), claim = prior(context, frame, runId, 'reconcile');
    if (claim.row) return outcome(frame, claim.row);
    const { run, head } = ownedRun(context, s, runId), limit = calendarInteger(p.limit ?? 128, 1, 128);
    if (p.cleanupOnly !== undefined && typeof p.cleanupOnly !== 'boolean') return reject('CALENDAR_INPUT_INVALID');
    const publishedCleanup = head.state === 'published' && p.cleanupOnly === true;
    if (head.state === 'published' && !publishedCleanup || p.cleanupOnly === true && !publishedCleanup || number(head.revision) !== calendarInteger(p.expectedRevision, 1)) return reject('CALENDAR_REVISION_CONFLICT');
    const previous = head.progress_id === null ? null : required(context.db.get(t.progress, String(head.progress_id)), s.scopeId);
    const next = { ...head, revision: number(head.revision) + 1, state: publishedCleanup ? 'published' : 'aborted', phase: publishedCleanup ? head.phase : 'retiring', last_receipt_id: claim.id,
      receipt_base_json: calendarJson(Object.fromEntries(Object.keys(COUNTERS).map(name => [name, number(head[name])]))), updated_ms: calendarNow() };
    context.db.updateIfCurrent(t.runState, runId, next, head);
    let deleted = 0;
    for (const table of [t.claims, t.cellBuilders]) for (const row of context.db.find(table, { filters: [{ type: 'field', field: 'run_id', operator: 'eq', value: runId }], order: [{ field: 'id', direction: 'asc' }], limit: Math.min(limit, 256 - deleted) })) {
      if (row.scope_id !== s.scopeId) return reject(); context.db.delete(table, String(row.id)); deleted++;
    }
    while (deleted < 256) {
      const page = context.query(CALENDAR_SERIES_PUBLICATION_QUERY, { scopeId: s.scopeId, ownerId: s.ownerId, seriesId: s.seriesId, runId, kind: 'cleanup', limit: Math.min(64, 256 - deleted) }) as unknown as { items: Row[] };
      if (!Array.isArray(page.items) || page.items.length > 64) return reject(); if (!page.items.length) break;
      for (const item of page.items) {
        if (item.scope_id !== s.scopeId || item.kind !== 'working-member' && item.kind !== 'selector') return reject();
        const table = item.kind === 'working-member' ? t.workingMembers : t.selectors, row = required(context.db.get(table, String(item.id)), s.scopeId);
        if (row.cell_set_id !== item.cell_set_id) return reject(); context.db.delete(table, String(row.id)); deleted++;
      }
    }
    if (selected) deleted += deriveCalendarSeriesSelectedMaterialization(context, { phase: 'reconcile', source: s, run, head: next, receiptId: claim.id, logicalKey: frame.logicalKey, semanticDigest: claim.semantic, budget: LIMIT - deleted });
    const compiled = previous ? String(previous.after_digest) : String(run.initial_progress_digest), projected = projectionDigest(JSON.parse(String(head.projection_cursor_json)));
    const receipt = receiptRow(frame, run, next, claim, 'reconcile', { ...EMPTY_DELTAS }, deleted, compiled, compiled, projected, projected);
    context.db.createStrict(t.receipts, receipt); return outcome(frame, receipt);
  }));
}

function readOwner(context: DatabaseReadQueryContext, value: unknown) {
  const p = record(value, ['scopeId', 'ownerId', 'seriesId', 'runId', 'phase', 'logicalKey']), scopeId = calendarScope(p.scopeId), ownerId = calendarKey(p.ownerId), seriesId = calendarKey(p.seriesId), runId = calendarKey(p.runId);
  const physical = context.database.query<Row>("SELECT scope_id,owner_id FROM _calendar_owner WHERE id='application'").get();
  const source = context.database.query<Row>('SELECT id,scope_id,owner_id,source_id,current_grant_id FROM calendar_series WHERE id=? AND scope_id=? LIMIT 1').get(seriesId, scopeId);
  if (physical?.scope_id !== scopeId || physical.owner_id !== ownerId || !source || source.owner_id !== ownerId) return reject('CALENDAR_FORBIDDEN');
  return { p, scopeId, ownerId, seriesId, runId, source };
}
/** Native-only point inspection. A missing/unknown receipt never proves a prior
 * physical operation did not commit; the broker must reconcile original keys. */
export function readCalendarSeriesMaterialization(context: DatabaseReadQueryContext, input: unknown) {
  return readMaterialization(context, input, false);
}
export function readCalendarSeriesSelectedMaterialization(context: DatabaseReadQueryContext, input: unknown) {
  return readMaterialization(context, input, true);
}
function readMaterialization(context: DatabaseReadQueryContext, input: unknown, selected: boolean) {
  const r = readOwner(context, input), run = context.database.query<Row>(`SELECT * FROM ${t.runs} WHERE id=? AND scope_id=? AND series_id=? LIMIT 1`).get(r.runId, r.scopeId, r.seriesId);
  if (!run) return { status: 'unknown' as const };
  const state = context.database.query<Row>(`SELECT * FROM ${t.runState} WHERE id=? AND scope_id=? LIMIT 1`).get(r.runId, r.scopeId);
  if (!state) return reject();
  const progress = state.progress_id === null ? null : context.database.query<Row>(`SELECT * FROM ${t.progress} WHERE id=? AND scope_id=? AND run_id=? LIMIT 1`).get(String(state.progress_id), r.scopeId, r.runId);
  const cleanupPending = context.database.query(`SELECT 1 AS present FROM ${t.claims} WHERE run_id=? LIMIT 1`).get(r.runId) !== null
    || context.database.query(`SELECT 1 AS present FROM ${t.cellBuilders} WHERE run_id=? LIMIT 1`).get(r.runId) !== null
    || context.database.query(`SELECT 1 AS present FROM ${t.cellSeals} z JOIN ${t.workingMembers} m ON m.selector_id=z.base_selector_id AND m.cell_set_id=z.base_cell_set_id
      WHERE z.run_id=? AND m.scope_id=? AND NOT EXISTS(SELECT 1 FROM ${t.selectors} x WHERE x.id=m.selector_id AND x.cell_set_id=m.cell_set_id) LIMIT 1`).get(r.runId, r.scopeId) !== null
    || state.state === 'aborted' && (context.database.query(`SELECT 1 AS present FROM ${t.cellSets} c JOIN ${t.workingMembers} m ON m.cell_set_id=c.id WHERE c.run_id=? AND m.scope_id=? LIMIT 1`).get(r.runId, r.scopeId) !== null
      || context.database.query(`SELECT 1 AS present FROM ${t.cellSets} c JOIN ${t.selectors} x ON x.cell_set_id=c.id WHERE c.run_id=? AND x.scope_id=? LIMIT 1`).get(r.runId, r.scopeId) !== null);
  return { status: 'known' as const, run, state, progress, cleanupPending: cleanupPending || selected && calendarSeriesSelectedMaterializationCleanupPending(context, r.scopeId, r.runId) };
}
export function reconcileCalendarSeriesMaterializationReceipt(context: DatabaseReadQueryContext, input: unknown) {
  const r = readOwner(context, input), run = context.database.query<Row>(`SELECT * FROM ${t.runs} WHERE id=? AND scope_id=? AND series_id=? LIMIT 1`).get(r.runId, r.scopeId, r.seriesId);
  if (!run) return { status: 'unknown' as const };
  if (!['batch', 'publish', 'reconcile'].includes(String(r.p.phase))) return reject('CALENDAR_INPUT_INVALID');
  const generation = context.database.query<Row>('SELECT generation FROM _calendar_series_generations WHERE id=? AND scope_id=? LIMIT 1').get(String(run.generation_id), r.scopeId);
  if (!generation) return reject();
  const id = calendarSeriesMaterializationReceiptId({ scopeId: r.scopeId, ownerId: r.ownerId, sourceId: String(run.source_id), sourceGeneration: number(generation.generation) }, r.runId, r.p.phase as 'batch', calendarKey(r.p.logicalKey));
  const receipt = context.database.query<Row>(`SELECT * FROM ${t.receipts} WHERE id=? AND scope_id=? AND run_id=? LIMIT 1`).get(id, r.scopeId, r.runId);
  return receipt ? { status: 'accepted' as const, receipt } : { status: 'unknown' as const };
}

/** Shared private canonical protocol pieces. No public/browser exports. */
export { owner as assertCalendarSeriesMaterializationOwner, current as assertCalendarSeriesMaterializationCurrent,
  prior as readCalendarSeriesMaterializationPrior, ownedRun as readCalendarSeriesMaterializationOwnedRun,
  outcome as calendarSeriesMaterializationOutcome, receiptRow as calendarSeriesMaterializationReceiptRow };
export const CALENDAR_SERIES_MATERIALIZATION_COUNTERS = COUNTERS;
export type CalendarSeriesMaterializationDeltas = Deltas;
