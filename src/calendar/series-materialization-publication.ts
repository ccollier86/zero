/** Private bounded preparation plus one atomic native publication. No sparse
 * UTC coverage certificate, public activation, timer or SYSTEM authority is
 * introduced here. The managed owner's actual COMMIT fence remains mandatory. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { appendDatabaseCommandSourceAudit } from '../databases/database-command-source-audit';
import type { Row } from '../sync/types';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as t } from './realm-series-materialization-migration';
import { CALENDAR_SERIES_PUBLICATION_QUERY } from './series-publication-query';
import { verifyCalendarSeriesNativeEnvelope } from './series-native-transport';
import { assertCalendarSeriesMaterializationOwner as owner, assertCalendarSeriesMaterializationCurrent as current,
  readCalendarSeriesMaterializationPrior as prior, readCalendarSeriesMaterializationOwnedRun as ownedRun,
  calendarSeriesMaterializationOutcome as outcome, calendarSeriesMaterializationReceiptRow as receiptRow,
  CALENDAR_SERIES_MATERIALIZATION_COUNTERS as counters, type CalendarSeriesMaterializationDeltas } from './series-materialization-writer';
import { CalendarError, calendarCommand } from './error';
import { calendarNow } from './hold-time';
import { calendarHash as h, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';
import { admitCalendarBookingHardCandidate, type CalendarBookingCandidate } from './booking-admission';
import { assertCalendarTypePolicyForScope } from './appointment-type-bindings';
import { assertCalendarVisitPolicyForScope, assertCalendarBookingVisitForScope } from './visit-bindings';
import { calendarTypeRevision } from './appointment-types-model';
import { assertCalendarSeriesSelectedDerivationCurrent, deriveCalendarSeriesSelectedMaterialization } from './series-materialization-derivation';

interface Cursor {
  kind: 'calendar-series-publication-cursor-v1'; phase: 'cell' | 'carry' | 'working' | 'ready'; afterCellSetId: string | null;
  cellSetId: string | null; afterMemberId: string | null; baseSelectorId: string | null; baseCellSetId: string | null;
  baseSelectorRevision: number; publicationId: string;
}
const columns = ['kind', 'phase', 'afterCellSetId', 'cellSetId', 'afterMemberId', 'baseSelectorId', 'baseCellSetId', 'baseSelectorRevision', 'publicationId'];
function fail(code: 'CALENDAR_NOT_READY' | 'CALENDAR_STATE_INVALID' | 'CALENDAR_REVISION_CONFLICT' | 'CALENDAR_CAPACITY' = 'CALENDAR_STATE_INVALID'): never { throw new CalendarError(code); }
function n(value: unknown): number { return calendarInteger(value, 0); }
function key(value: unknown): string | null { return value === null ? null : calendarKey(value); }
function zeros(): CalendarSeriesMaterializationDeltas { return { candidate_delta: 0, resource_delta: 0, claim_delta: 0, cell_delta: 0, member_delta: 0, selector_delta: 0, working_member_delta: 0 }; }
function base(head: Row): string { return calendarJson(Object.fromEntries(Object.keys(counters).map(name => [name, n(head[name])]))); }
function cursor(head: Row, runId: string): Cursor {
  const initial: Cursor = { kind: 'calendar-series-publication-cursor-v1', phase: 'cell', afterCellSetId: null, cellSetId: null, afterMemberId: null,
    baseSelectorId: null, baseCellSetId: null, baseSelectorRevision: 0, publicationId: h(['calendar-series-run-publication-v1', runId]) };
  if (head.publication_cursor_json === '{}') return initial;
  const r = calendarRecord(JSON.parse(String(head.publication_cursor_json)), columns);
  if (r.kind !== initial.kind || !['cell', 'carry', 'working', 'ready'].includes(String(r.phase)) || r.publicationId !== initial.publicationId) return fail();
  return { kind: initial.kind, phase: r.phase as Cursor['phase'], afterCellSetId: key(r.afterCellSetId), cellSetId: key(r.cellSetId), afterMemberId: key(r.afterMemberId),
    baseSelectorId: key(r.baseSelectorId), baseCellSetId: key(r.baseCellSetId), baseSelectorRevision: n(r.baseSelectorRevision), publicationId: initial.publicationId };
}
function nextCell(value: Cursor): Cursor { return { ...value, phase: 'cell', afterCellSetId: value.cellSetId, cellSetId: null, afterMemberId: null,
  baseSelectorId: null, baseCellSetId: null, baseSelectorRevision: 0 }; }
function checkpointDigest(head: Row): string { return h(['calendar-series-projection-progress-v1', JSON.parse(String(head.projection_cursor_json))]); }
function catalogs(context: DatabaseWriteCommandContext, s: Parameters<typeof current>[1], run: Row, authoring: ReturnType<typeof current>): void {
  // One actual accepted interval suffices: every child shares the same source
  // type/visit/duration/buffers. Resource revisions independently fence each
  // occurrence's already admitted availability and assignment policy.
  const first = context.db.find(t.versions, { filters: [{ type: 'field', field: 'run_id', operator: 'eq', value: String(run.id) }],
    order: [{ field: 'occurrence_id', direction: 'asc' }], limit: 1 })[0];
  if (first) {
    const effective = JSON.parse(String(first.booking_json)) as { booking: CalendarBookingCandidate };
    admitCalendarBookingHardCandidate(context, s.scopeId, effective.booking, { type: true, visit: true, availabilityResourceIds: [], occupancy: false }); return;
  }
  // A zero-output horizon has no interval. Re-admit both intersections and the
  // exact selected generations without fabricating a booking or UTC midnight.
  const type = authoring.template.appointmentType ?? undefined, visit = authoring.template.visit ?? undefined, resources = authoring.template.resourceIds;
  assertCalendarTypePolicyForScope(context, s.scopeId, resources, type); assertCalendarVisitPolicyForScope(context, s.scopeId, resources, visit);
  if (type) {
    const pointer = context.db.get('calendar_types', type.id);
    if (!pointer || pointer.scope_id !== s.scopeId || pointer.revision !== type.revision) throw new CalendarError('CALENDAR_TYPE_STALE');
    const selected = calendarTypeRevision(context, s.scopeId, type.id, type.revision);
    if (selected.active !== 1) throw new CalendarError('CALENDAR_TYPE_STALE');
    if (selected.duration_minutes * 60_000 !== authoring.recurrence.durationMilliseconds || selected.buffer_before !== authoring.template.bufferBeforeMinutes
      || selected.buffer_after !== authoring.template.bufferAfterMinutes) throw new CalendarError('CALENDAR_TYPE_CONFLICT');
  }
  assertCalendarBookingVisitForScope(context, s.scopeId, resources, visit);
}

/** Each call performs <=256 owned preparation mutations. Durable cursor and
 * receipt commit together; no prepared selector becomes visible before publish. */
export function sealCalendarSeriesMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return sealMaterialization(context, input, false);
}
export function sealCalendarSeriesSelectedMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return sealMaterialization(context, input, true);
}
function sealMaterialization(context: DatabaseWriteCommandContext, input: unknown, selected: boolean) {
  return calendarCommand(() => context.db.transaction(() => {
    const frame = verifyCalendarSeriesNativeEnvelope(context.writerPolicy, input, 'calendar.series.run.seal'), s = owner(context, frame);
    const p = calendarRecord(frame.payload, ['runId', 'expectedRevision', 'limit']), runId = calendarKey(p.runId), claim = prior(context, frame, runId, 'batch');
    if (claim.row) return outcome(frame, claim.row);
    if (selected) assertCalendarSeriesSelectedDerivationCurrent(context, s);
    const { run, head } = ownedRun(context, s, runId), authoring = current(context, s, run); catalogs(context, s, run, authoring);
    if (n(head.revision) !== calendarInteger(p.expectedRevision, 1)) return fail('CALENDAR_REVISION_CONFLICT');
    const progress = head.progress_id === null ? null : context.db.get(t.progress, String(head.progress_id));
    if (!['preparing', 'blocked'].includes(String(head.state)) || head.projection_complete !== 1 || !progress || progress.completion === 'incomplete') return fail('CALENDAR_NOT_READY');
    const limit = calendarInteger(p.limit ?? 256, 8, 256), deltas = zeros(); let writes = 0, cellRoot = String(head.cell_root), state = cursor(head, runId);
    const query = (kind: string, extra: Record<string, unknown> = {}) => context.query(CALENDAR_SERIES_PUBLICATION_QUERY,
      { scopeId: s.scopeId, ownerId: s.ownerId, seriesId: s.seriesId, runId, kind, ...extra } as DatabaseSerializableValue) as unknown as Record<string, unknown>;
    const create = (table: string, row: Row, delta?: keyof CalendarSeriesMaterializationDeltas) => {
      if (++writes > limit) return fail('CALENDAR_CAPACITY'); context.db.createStrict(table, row); if (delta) deltas[delta]++;
    };
    for (let turns = 0; state.phase !== 'ready' && writes < limit - 4 && turns < 512; turns++) {
      if (state.phase === 'cell') {
        const page = query('cell', state.afterCellSetId ? { after: state.afterCellSetId } : {}), cell = page.cell as Row | null;
        if (!cell) { state = { ...state, phase: 'ready' }; break; }
        if (page.seal) return fail();
        const selected = page.selector as Row | null;
        state = { ...state, phase: 'carry', cellSetId: String(cell.id), afterMemberId: null,
          baseSelectorId: selected ? String(selected.id) : null, baseCellSetId: selected ? String(selected.cell_set_id) : null, baseSelectorRevision: selected ? n(selected.revision) : 0 };
      }
      const cell = context.db.get(t.cellSets, state.cellSetId!);
      if (!cell || cell.run_id !== runId || cell.scope_id !== s.scopeId) return fail();
      if (state.phase === 'carry') {
        const builder = context.db.get(t.cellBuilders, String(cell.id)); if (!builder) return fail();
        let count = 0, memberRoot = String(builder.member_root), more = false;
        if (state.baseSelectorId) {
          const page = query('carry', { cellSetId: cell.id, selectorId: state.baseSelectorId, baseCellSetId: state.baseCellSetId,
            ...(state.afterMemberId ? { after: state.afterMemberId } : {}), limit: Math.min(64, limit - writes - 4) });
          const selected = page.selector as Row | null;
          if (!selected || selected.id !== state.baseSelectorId || selected.cell_set_id !== state.baseCellSetId || selected.revision !== state.baseSelectorRevision) return fail('CALENDAR_REVISION_CONFLICT');
          for (const member of page.items as Row[]) {
            const id = h(['calendar-series-cell-member-v1', [runId, member.version_id, cell.resource_id, cell.cell_start_ms]]), present = context.db.get(t.members, id);
            if (present) {
              if (present.cell_set_id !== cell.id || present.version_id !== member.version_id || present.from_ms !== member.from_ms || present.until_ms !== member.until_ms) return fail();
            } else {
              const row = { id, scope_id: s.scopeId, cell_set_id: cell.id, version_id: member.version_id, resource_id: cell.resource_id,
                cell_start_ms: cell.cell_start_ms, from_ms: member.from_ms, until_ms: member.until_ms, batch_receipt_id: claim.id };
              create(t.members, row, 'member_delta'); count++;
              const fact = h(['calendar-series-carried-member-v1', id, member.version_id, member.from_ms, member.until_ms]);
              memberRoot = h(['calendar-series-cell-member-chain-v1', memberRoot, fact]); cellRoot = h(['calendar-series-cell-chain-v1', cellRoot, fact]);
            }
            state.afterMemberId = String(member.id);
          }
          more = page.more === true;
        }
        if (count) { writes++; context.db.update(t.cellBuilders, String(cell.id), { revision: n(builder.revision) + 1, member_count: n(builder.member_count) + count, member_root: memberRoot, batch_receipt_id: claim.id }); }
        if (more) break; // One aggregate builder CAS per cell/physical batch.
        create(t.cellSeals, { id: h(['calendar-series-cell-seal-v1', cell.id]), scope_id: s.scopeId, cell_set_id: cell.id, run_id: runId,
          member_count: n(builder.member_count) + count, member_root: memberRoot, base_selector_id: state.baseSelectorId, base_cell_set_id: state.baseCellSetId,
          base_selector_revision: state.baseSelectorRevision, batch_receipt_id: claim.id });
        const selectorId = state.baseSelectorId ?? h(['calendar-series-working-selector-v1', s.scopeId, s.seriesId, run.source_publication_id, cell.resource_id, cell.cell_start_ms]);
        if (!state.baseSelectorId) create(t.selectors, { id: selectorId, scope_id: s.scopeId, series_id: s.seriesId, source_publication_id: run.source_publication_id,
          resource_id: cell.resource_id, cell_start_ms: cell.cell_start_ms, cell_set_id: cell.id, publication_id: state.publicationId,
          revision: 1, created_receipt_id: claim.id, batch_receipt_id: claim.id }, 'selector_delta');
        writes++; context.db.delete(t.cellBuilders, String(cell.id));
        state = { ...state, phase: 'working', afterMemberId: null };
      }
      if (state.phase === 'working') {
        const selectorId = state.baseSelectorId ?? h(['calendar-series-working-selector-v1', s.scopeId, s.seriesId, run.source_publication_id, cell.resource_id, cell.cell_start_ms]);
        const page = query('members', { cellSetId: cell.id, ...(state.afterMemberId ? { after: state.afterMemberId } : {}), limit: Math.min(64, limit - writes) });
        for (const member of page.items as Row[]) {
          create(t.workingMembers, { id: h(['calendar-series-working-member-v1', selectorId, cell.id, member.version_id]), scope_id: s.scopeId,
            selector_id: selectorId, cell_set_id: cell.id, version_id: member.version_id, resource_id: member.resource_id,
            from_ms: member.from_ms, until_ms: member.until_ms, batch_receipt_id: claim.id }, 'working_member_delta');
          state.afterMemberId = String(member.id);
        }
        if (page.more === true) break;
        state = nextCell(state);
      }
    }
    const next: Row = { ...head, revision: n(head.revision) + 1, state: 'preparing', last_receipt_id: claim.id, receipt_base_json: base(head),
      publication_cursor_json: calendarJson(state), cell_root: cellRoot, updated_ms: calendarNow() };
    for (const [counter, delta] of Object.entries(counters)) next[counter] = n(head[counter]) + deltas[delta];
    context.db.updateIfCurrent(t.runState, runId, next, head);
    if (selected) writes += deriveCalendarSeriesSelectedMaterialization(context, { phase: 'seal', source: s, run, head: next, receiptId: claim.id, logicalKey: frame.logicalKey, semanticDigest: claim.semantic, budget: limit - writes });
    const receipt = receiptRow(frame, run, next, claim, 'batch', deltas, writes, String(progress.after_digest), String(progress.after_digest), checkpointDigest(head), checkpointDigest(head));
    context.db.createStrict(t.receipts, receipt); return outcome(frame, receipt);
  }));
}

/** The 2,048-selector cap is an explicit private final-transaction budget,
 * separate from256-row staging. Physical latency qualification remains gated. */
export function publishCalendarSeriesMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return publishMaterialization(context, input, false);
}
export function publishCalendarSeriesSelectedMaterialization(context: DatabaseWriteCommandContext, input: unknown) {
  return publishMaterialization(context, input, true);
}
function publishMaterialization(context: DatabaseWriteCommandContext, input: unknown, selected: boolean) {
  return calendarCommand(() => context.db.transaction(() => {
    const frame = verifyCalendarSeriesNativeEnvelope(context.writerPolicy, input, 'calendar.series.run.publish'), s = owner(context, frame);
    const p = calendarRecord(frame.payload, ['runId', 'expectedRevision']), runId = calendarKey(p.runId), claim = prior(context, frame, runId, 'publish');
    if (claim.row) return outcome(frame, claim.row);
    if (selected) assertCalendarSeriesSelectedDerivationCurrent(context, s);
    const { run, head } = ownedRun(context, s, runId), authoring = current(context, s, run, 'commit'); catalogs(context, s, run, authoring);
    const prepared = cursor(head, runId), progress = head.progress_id === null ? null : context.db.get(t.progress, String(head.progress_id));
    if (n(head.revision) !== calendarInteger(p.expectedRevision, 1)) return fail('CALENDAR_REVISION_CONFLICT');
    if (prepared.phase !== 'ready' || head.projection_complete !== 1 || !progress || progress.completion === 'incomplete' || !['preparing', 'blocked'].includes(String(head.state))) return fail('CALENDAR_NOT_READY');
    if (n(head.cell_count) > 2048 || n(head.working_member_count) !== n(head.member_count)) return fail('CALENDAR_CAPACITY');
    const now = calendarNow(), next: Row = { ...head, revision: n(head.revision) + 1, last_receipt_id: claim.id, receipt_base_json: base(head), updated_ms: now };
    context.db.updateIfCurrent(t.runState, runId, next, head);
    const sealId = h(['calendar-series-run-seal-v1', runId]);
    context.db.createStrict(t.seals, { id: sealId, scope_id: s.scopeId, run_id: runId, plan_digest: run.plan_digest, candidate_root: head.candidate_root,
      projection_root: head.projection_root, cell_root: head.cell_root, progress_digest: progress.after_digest, receipt_id: claim.id,
      occurrence_count: head.candidate_count, resource_count: head.resource_count, claim_count: head.claim_count, cell_count: head.cell_count,
      member_count: head.member_count, selector_count: head.selector_count, sealed_ms: now });
    const publication = context.db.createStrict(t.publications, { id: prepared.publicationId, scope_id: s.scopeId, run_id: runId, seal_id: sealId,
      source_publication_id: run.source_publication_id, base_source_publication_id: run.base_source_publication_id, kind: run.kind, published_ms: now });
    let rows = 0, after: string | undefined;
    while (true) {
      const page = context.query(CALENDAR_SERIES_PUBLICATION_QUERY, { scopeId: s.scopeId, ownerId: s.ownerId, seriesId: s.seriesId, runId, kind: 'final', limit: 64,
        ...(after ? { after } : {}) }) as unknown as { items: { cell: Row; seal: Row; selector: Row }[]; more: boolean };
      for (const { cell, seal, selector } of page.items) {
        if (++rows > 2048) return fail('CALENDAR_CAPACITY');
        if (seal.base_selector_id !== null) {
          if (selector.id !== seal.base_selector_id || selector.cell_set_id !== seal.base_cell_set_id || selector.revision !== seal.base_selector_revision) return fail('CALENDAR_REVISION_CONFLICT');
          const changed = context.db.updateIfCurrent(t.selectors, String(selector.id), { cell_set_id: cell.id, publication_id: prepared.publicationId,
            revision: n(selector.revision) + 1, batch_receipt_id: claim.id }, selector); if (!changed) return fail('CALENDAR_REVISION_CONFLICT');
        } else if (selector.cell_set_id !== cell.id || selector.publication_id !== prepared.publicationId) return fail();
        after = String(cell.id);
      }
      if (!page.more) break; if (!page.items.length) return fail();
    }
    if (rows !== n(head.cell_count)) return fail();
    if (run.kind === 'cutover') {
      const nativeId = h(['calendar-series-native-v1', s.scopeId, s.ownerId, s.sourceId, s.sourceGeneration, 'commit', h(['cutover', runId])]);
      context.db.createStrict('_calendar_series_native_receipts', { id: nativeId, scope_id: s.scopeId, domain: 'calendar-series-native-v1', owner_id: s.ownerId, source_id: s.sourceId,
        series_id: s.seriesId, generation_id: s.generationId, source_generation: s.sourceGeneration, grant_id: s.grant.grantId, grant_epoch: s.grant.grantEpoch,
        preparation_id: run.source_preparation_id, phase: 'commit', logical_key: h(['cutover', runId]), candidate_digest: run.plan_digest,
        cursor_digest: progress.after_digest, policy_digest: s.policyGeneration, outcome: 'publication.ready', accepted_ms: now });
      context.db.createStrict('_calendar_series_publications', { id: run.source_publication_id, scope_id: s.scopeId, series_id: s.seriesId, preparation_id: run.source_preparation_id,
        generation_id: s.generationId, base_publication_id: run.base_source_publication_id, owner_id: s.ownerId, source_id: s.sourceId, source_generation: s.sourceGeneration,
        grant_id: s.grant.grantId, grant_epoch: s.grant.grantEpoch, manifest_digest: run.plan_digest, native_receipt_id: nativeId, published_ms: now, operation: 'series.publication.applied' });
      context.db.createStrict('_calendar_series_effect_intents', { id: h(['calendar-series-cutover-effect-v1', runId]), scope_id: s.scopeId, series_id: s.seriesId, generation_id: s.generationId,
        preparation_id: run.source_preparation_id, receipt_family: 'native', receipt_id: nativeId, operation: 'series.publication.applied', publication_id: run.source_publication_id, child_version_id: null, child_binding_digest: null });
    }
    const headId = h(['calendar-series-continuation-head-v1', s.scopeId, s.seriesId, s.generationId, s.segmentId, run.source_publication_id]);
    const oldHead = context.db.get(t.continuationHeads, headId), selectedHead = { series_id: s.seriesId, generation_id: s.generationId, logical_segment_id: s.segmentId,
      source_publication_id: run.source_publication_id, grant_id: s.grant.grantId, grant_epoch: s.grant.grantEpoch, engine_generation: s.engineGeneration, run_id: runId, progress_id: progress.id };
    if (oldHead) { if (!context.db.updateIfCurrent(t.continuationHeads, headId, { ...selectedHead, revision: n(oldHead.revision) + 1 }, oldHead)) return fail('CALENDAR_REVISION_CONFLICT'); }
    else context.db.createStrict(t.continuationHeads, { id: headId, scope_id: s.scopeId, ...selectedHead, revision: 1 });
    const finalHead = context.db.get(t.runState, runId)!;
    if (selected) deriveCalendarSeriesSelectedMaterialization(context, { phase: 'publish', source: s, run, head: finalHead, receiptId: claim.id, logicalKey: frame.logicalKey, semanticDigest: claim.semantic, budget: 0 });
    const receipt = receiptRow(frame, run, finalHead, claim, 'publish', zeros(), rows, String(progress.after_digest), String(progress.after_digest), checkpointDigest(head), checkpointDigest(head));
    context.db.createStrict(t.receipts, receipt);
    appendDatabaseCommandSourceAudit(context, { id: 'calendar:' + h(['calendar-series-native-publication-v1', publication.table, publication.rowId, publication.seq]), family: 'workflow',
      action: 'calendar.series.materialization.published', outcome: 'succeeded', occurredAt: publication.ts, target: { type: 'calendar.series', id: s.seriesId },
      metadata: { sourceGeneration: s.sourceGeneration, occurrenceCount: n(head.candidate_count), resourceCount: n(head.resource_count), cellCount: rows } });
    return outcome(frame, receipt);
  }));
}
