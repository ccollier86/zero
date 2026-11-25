/** Fixed private022 derivation. No callback, SQL handle or strategy is accepted
 * from command JSON. The legacy021 entry points never enter this module. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarSeriesCompilationBinding } from './series-compilation';
import { CalendarError } from './error';
import { calendarHash as h, calendarInteger, calendarJson } from './validation';
import { calendarNow } from './hold-time';
import { CALENDAR_SERIES_CHILD_TABLES as c } from './realm-series-children-migration';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';

/** Every base VERSION costs1+2R; its selected projection adds1+R.153 base
 * declared rows +102 derived rows +one progress fact fit the joint256 budget. */
export { CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT } from './series-projection-budgets';
export function calendarSeriesSelectedProjectionExtraRows(resourceCount: number): number {
  return 1 + calendarInteger(resourceCount, 1, 16);
}
export interface CalendarSeriesSelectedDerivation {
  readonly phase: 'begin' | 'stage' | 'seal' | 'publish' | 'reconcile';
  readonly source: CalendarSeriesCompilationBinding;
  readonly run: Row;
  readonly head: Row;
  readonly receiptId: string;
  readonly logicalKey: string;
  readonly semanticDigest: string;
  readonly budget: number;
}

function fail(code: 'CALENDAR_NOT_READY' | 'CALENDAR_STATE_INVALID' | 'CALENDAR_FORBIDDEN' | 'CALENDAR_REVISION_CONFLICT' | 'CALENDAR_CAPACITY' = 'CALENDAR_STATE_INVALID'): never {
  throw new CalendarError(code);
}
function count(value: unknown): number { return calendarInteger(value, 0); }
function eq(field: string, value: string | number) { return { type: 'field' as const, field, operator: 'eq' as const, value }; }
function owned(row: Row | null, scopeId: string): Row {
  if (!row || row.scope_id !== scopeId) return fail(); return row;
}
function base(view: Row): string {
  return calendarJson({ child_count: count(view.child_count), resource_count: count(view.resource_count), directory_count: count(view.directory_count) });
}
function viewId(input: CalendarSeriesSelectedDerivation): string {
  return h(['calendar-series-child-view-v1', input.source.scopeId, input.source.seriesId, input.run.source_publication_id, input.run.id]);
}
function rowId(view: string, appointment: string): string { return h(['calendar-series-child-head-v1', view, appointment]); }
function resourceId(head: string, revision: number, resource: string): string { return h(['calendar-series-child-resource-v1', head, revision, resource]); }
function directoryId(view: string, resource: string): string { return h(['calendar-series-child-directory-v1', view, resource]); }
function checkView(view: Row, source: CalendarSeriesCompilationBinding, run: Row): void {
  if (view.scope_id !== source.scopeId || view.series_id !== source.seriesId || view.owner_id !== source.ownerId || view.source_id !== source.sourceId
    || view.generation_id !== source.generationId || view.source_generation !== source.sourceGeneration || view.source_publication_id !== run.source_publication_id
    || view.legacy_grant_id !== source.grant.grantId || view.legacy_authority_digest !== source.grant.authorityDigest
    || view.root_hash !== source.rootHash || view.realm_fingerprint !== source.realmFingerprint) return fail('CALENDAR_FORBIDDEN');
}

/** This is a BASE-only bridge, not an exception-aware compiler. An actual022
 * exception epoch blocks fresh work even if caller source JSON still says0. */
export function assertCalendarSeriesSelectedDerivationCurrent(context: DatabaseWriteCommandContext,
  source: CalendarSeriesCompilationBinding): void {
  if (!context.db.hasTable(c.state) || context.db.get(c.state, 'application')?.version !== 22) return fail('CALENDAR_NOT_READY');
  const current = context.db.get(c.current, source.seriesId);
  if (source.exceptionRevision !== 0 || current && count(current.exception_revision) !== 0) return fail('CALENDAR_NOT_READY');
  if (current && (current.scope_id !== source.scopeId || current.series_id !== source.seriesId || current.owner_id !== source.ownerId)) return fail('CALENDAR_FORBIDDEN');
}

/** Called in the SAME writer transaction after021 qCAS and before its receipt.
 * Variable rows share the native256 budget. View/batch/current metadata is a
 * fixed at-most5 DML overhead (initial publication has ready/current flips,
 * one immutable view seal, the source pointer CAS and the closing batch).
 * Batches forward-reference the missing021 receipt; no postcommit repair runs. */
export function deriveCalendarSeriesSelectedMaterialization(context: DatabaseWriteCommandContext,
  input: CalendarSeriesSelectedDerivation): number {
  const { source: s, run, head, receiptId, phase } = input, scope = s.scopeId;
  const budget = calendarInteger(input.budget, 0, 256), batchId = h(['calendar-series-child-native-batch-v1', receiptId]), now = calendarNow();
  if (!context.db.hasTable(c.state) || context.db.get(c.state, 'application')?.version !== 22) return fail('CALENDAR_NOT_READY');
  if (context.db.get(n.receipts, receiptId) || context.db.get(c.batches, batchId)) return fail('CALENDAR_REVISION_CONFLICT');
  const sourceRow = owned(context.db.get('calendar_series', s.seriesId), scope), current = context.db.get(c.current, s.seriesId);
  if (sourceRow.owner_id !== s.ownerId || sourceRow.source_id !== s.sourceId || run.scope_id !== scope || run.series_id !== s.seriesId || head.id !== run.id
    || head.last_receipt_id !== receiptId) return fail('CALENDAR_FORBIDDEN');
  if (current && (current.scope_id !== scope || current.owner_id !== s.ownerId || current.series_id !== s.seriesId)) return fail('CALENDAR_FORBIDDEN');
  let view: Row, fresh = false;
  if (phase === 'begin') {
    if (run.kind === 'cutover') {
      if (current?.current_view_id !== null && current?.current_view_id !== undefined) return fail('CALENDAR_REVISION_CONFLICT');
      const id = viewId(input);
      if (context.db.get(c.views, id)) return fail('CALENDAR_REVISION_CONFLICT');
      const adoption = h(['calendar-series-child-adoption-v1', scope, s.ownerId, s.seriesId, s.generationId, run.source_publication_id,
        s.grant.grantId, s.grant.authorityDigest, s.rootHash, s.realmFingerprint, s.policyGeneration, s.resourceRevisions]);
      view = { id, scope_id: scope, series_id: s.seriesId, owner_id: s.ownerId, source_id: s.sourceId, generation_id: s.generationId,
        source_generation: s.sourceGeneration, source_publication_id: run.source_publication_id, base_view_id: null, base_content_revision: 0, kind: 'promotion',
        legacy_grant_id: s.grant.grantId, legacy_root_hash: s.rootHash, legacy_realm_fingerprint: s.realmFingerprint, legacy_authority_digest: s.grant.authorityDigest,
        root_hash: s.rootHash, realm_fingerprint: s.realmFingerprint, adoption_digest: adoption, phase: 'pending', revision: 1,
        child_count: 0, resource_count: 0, directory_count: s.selections.resourceIds.length,
        receipt_base_json: calendarJson({ child_count: 0, resource_count: 0, directory_count: 0 }),
        child_root: h(['calendar-series-child-empty-v1', id]), resource_root: h(['calendar-series-child-resources-empty-v1', id]), cursor_json: '{}',
        publication_id: null, initial_batch_id: batchId, last_batch_id: batchId, created_ms: now, expires_ms: run.expires_ms };
      if (s.selections.resourceIds.length > budget) return fail('CALENDAR_CAPACITY');
      context.db.createStrict(c.views, view); fresh = true;
    } else {
      if (!current?.current_view_id) return fail('CALENDAR_NOT_READY');
      view = owned(context.db.get(c.views, String(current.current_view_id)), scope);
      if (view.phase !== 'current') return fail('CALENDAR_NOT_READY');
    }
  } else {
    const starts = context.db.find(c.batches, { filters: [eq('run_id', String(run.id)), eq('origin_kind', 'native21'), eq('phase', 'begin')], limit: 2 });
    if (starts.length !== 1 || starts[0]!.scope_id !== scope || starts[0]!.series_id !== s.seriesId || !starts[0]!.view_id) return fail('CALENDAR_NOT_READY');
    view = owned(context.db.get(c.views, String(starts[0]!.view_id)), scope);
  }
  checkView(view, s, run);
  if (phase !== 'reconcile' && !['pending', 'current'].includes(String(view.phase))) return fail('CALENDAR_NOT_READY');
  if (run.kind === 'horizon' && phase !== 'reconcile' && current?.current_view_id !== view.id) return fail('CALENDAR_REVISION_CONFLICT');
  const beforeRevision = fresh ? 0 : count(view.revision), withdrawals: { kind: 'head' | 'resource' | 'directory'; id: string }[] = [];
  let children = 0, resources = 0, directories = 0, rows = 0, childRoot = String(view.child_root), resourceRoot = String(view.resource_root);
  const create = (table: string, row: Row) => {
    if (++rows > budget) return fail('CALENDAR_CAPACITY'); context.db.createStrict(table, row);
  };
  if (fresh) {
    for (const resource of s.selections.resourceIds) {
      create(c.directory, { id: directoryId(String(view.id), resource), scope_id: scope, view_id: view.id, series_id: s.seriesId, resource_id: resource, batch_id: batchId }); directories++;
    }
    if (!current) context.db.createStrict(c.current, { id: s.seriesId, scope_id: scope, series_id: s.seriesId, owner_id: s.ownerId,
      current_view_id: null, pointer_revision: 0, content_revision: 0, exception_revision: 0, revision: 1, last_batch_id: batchId, updated_ms: now });
  }
  if (phase === 'stage') {
    const versions = context.db.find(n.versions, { select: ['id', 'scope_id', 'run_id', 'series_id', 'occurrence_id', 'resource_ids_json', 'resource_digest', 'binding_digest',
      'start_ms', 'end_ms', 'occupied_from_ms', 'occupied_until_ms'], filters: [eq('batch_receipt_id', receiptId)], order: [{ field: 'id', direction: 'asc' }], limit: 257 });
    if (versions.length > 256) return fail('CALENDAR_CAPACITY');
    for (const version of versions) {
      if (version.scope_id !== scope || version.run_id !== run.id || version.series_id !== s.seriesId) return fail('CALENDAR_FORBIDDEN');
      const occurrence = owned(context.db.get(n.occurrences, String(version.occurrence_id)), scope);
      if (occurrence.series_id !== s.seriesId || occurrence.logical_segment_id !== s.segmentId) return fail('CALENDAR_FORBIDDEN');
      const memberships = context.db.find(n.resources, { filters: [eq('version_id', String(version.id))], order: [{ field: 'resource_id', direction: 'asc' }], limit: 17 });
      if (memberships.length < 1 || memberships.length > 16 || calendarJson(memberships.map(row => row.resource_id)) !== version.resource_ids_json
        || memberships.some(row => row.scope_id !== scope || row.batch_receipt_id !== receiptId)) return fail();
      if (rows + calendarSeriesSelectedProjectionExtraRows(memberships.length) > budget) return fail('CALENDAR_CAPACITY');
      const id = rowId(String(view.id), String(occurrence.appointment_id));
      if (context.db.get(c.heads, id)) return fail('CALENDAR_REVISION_CONFLICT');
      const child: Row = { id, scope_id: scope, view_id: view.id, series_id: s.seriesId, appointment_id: occurrence.appointment_id,
        occurrence_id: occurrence.id, logical_segment_id: occurrence.logical_segment_id, nominal_key: occurrence.nominal_key,
        origin_kind: 'native21', version_id: version.id, native_version_id: version.id, variant_version_id: null, native_run_id: run.id,
        child_revision: 1, selection_revision: 1, child_exception_revision: 0, status: 'confirmed', created_by: sourceRow.created_by,
        authority_resource_ids_json: version.resource_ids_json, resource_digest: version.resource_digest, binding_digest: version.binding_digest,
        start_ms: version.start_ms, end_ms: version.end_ms, occupied_from_ms: version.occupied_from_ms, occupied_until_ms: version.occupied_until_ms,
        created_batch_id: batchId, last_batch_id: batchId };
      create(c.heads, child); children++;
      childRoot = h(['calendar-series-child-chain-v1', childRoot, id, version.id, version.binding_digest, 1]);
      for (const member of memberships) {
        const row: Row = { id: resourceId(id, 1, String(member.resource_id)), scope_id: scope, view_id: view.id, head_id: id, series_id: s.seriesId,
          appointment_id: occurrence.appointment_id, selection_revision: 1, child_revision: 1, version_id: version.id,
          resource_id: member.resource_id, resource_revision: member.resource_revision, status: 'confirmed', occupies: 1,
          occupied_from_ms: version.occupied_from_ms, occupied_until_ms: version.occupied_until_ms, batch_id: batchId };
        create(c.resources, row); resources++;
        resourceRoot = h(['calendar-series-child-resource-chain-v1', resourceRoot, row.id, row.version_id, row.resource_id, row.resource_revision, row.occupied_from_ms, row.occupied_until_ms]);
      }
    }
  }
  if (phase === 'reconcile' && head.state === 'aborted' && budget) {
    const heads = context.db.find(c.heads, { select: ['id', 'scope_id', 'view_id', 'origin_kind', 'selection_revision'],
      filters: [eq('native_run_id', String(run.id))], order: [{ field: 'id', direction: 'asc' }], limit: Math.min(256, budget) });
    for (const child of heads) {
      if (rows >= budget) break;
      if (child.scope_id !== scope || child.view_id !== view.id || child.origin_kind !== 'native21') return fail('CALENDAR_FORBIDDEN');
      const members = context.db.find(c.resources, { filters: [eq('head_id', String(child.id))], order: [{ field: 'id', direction: 'asc' }], limit: 17 });
      if (members.length > 16) return fail();
      let removed = 0;
      for (const member of members) {
        if (rows >= budget) break;
        if (member.scope_id !== scope || member.view_id !== view.id || member.selection_revision !== child.selection_revision) return fail('CALENDAR_FORBIDDEN');
        context.db.delete(c.resources, String(member.id)); rows++; resources++; removed++;
        withdrawals.push({ kind: 'resource', id: String(member.id) }); resourceRoot = h(['calendar-series-child-resource-withdrawal-v1', resourceRoot, member.id]);
      }
      if (removed === members.length && rows < budget) {
        context.db.delete(c.heads, String(child.id)); rows++; children++;
        withdrawals.push({ kind: 'head', id: String(child.id) }); childRoot = h(['calendar-series-child-withdrawal-v1', childRoot, child.id]);
      }
    }
  }
  const withdrawing = phase === 'reconcile', next: Row = { ...view, revision: fresh ? 1 : count(view.revision) + 1, last_batch_id: batchId,
    receipt_base_json: fresh ? view.receipt_base_json : base(view), child_count: count(view.child_count) + (withdrawing ? -children : children),
    resource_count: count(view.resource_count) + (withdrawing ? -resources : resources), directory_count: count(view.directory_count), child_root: childRoot, resource_root: resourceRoot };
  if (fresh) { next.child_count = children; next.resource_count = resources; }
  if (withdrawing && head.state === 'aborted' && run.kind === 'cutover' && current?.current_view_id !== view.id) next.phase = 'aborted';
  if (phase === 'publish' && view.phase === 'pending') { next.phase = 'ready'; next.publication_id = h(['calendar-series-child-view-publication-v1', view.id]); }
  const retiringDirectory = withdrawing && next.phase === 'aborted' && next.child_count === 0 && next.resource_count === 0 && rows < budget
    ? context.db.find(c.directory, { filters: [eq('view_id', String(view.id))], order: [{ field: 'id', direction: 'asc' }], limit: Math.min(16, budget - rows) }) : [];
  directories += retiringDirectory.length; next.directory_count = count(view.directory_count) - retiringDirectory.length;
  for (const item of retiringDirectory) {
    if (item.scope_id !== scope) return fail('CALENDAR_FORBIDDEN'); context.db.delete(c.directory, String(item.id)); rows++;
    withdrawals.push({ kind: 'directory', id: String(item.id) });
  }
  if (!fresh && !context.db.updateIfCurrent(c.views, String(view.id), next, view)) return fail('CALENDAR_REVISION_CONFLICT');
  if (phase === 'publish') {
    const selected = owned(context.db.get(c.current, s.seriesId), scope);
    if (view.phase === 'pending') {
      context.db.createStrict(c.viewPublications, { id: next.publication_id, scope_id: scope, view_id: view.id, series_id: s.seriesId,
        source_publication_id: run.source_publication_id, base_view_id: view.base_view_id, base_content_revision: view.base_content_revision, kind: view.kind,
        child_count: next.child_count, resource_count: next.resource_count, child_root: next.child_root, resource_root: next.resource_root,
        adoption_digest: view.adoption_digest, receipt_id: batchId, published_ms: now });
      const ready = { ...next }; next.phase = 'current';
      if (!context.db.updateIfCurrent(c.views, String(view.id), next, ready)) return fail('CALENDAR_REVISION_CONFLICT');
    }
    if (selected.current_view_id !== null && selected.current_view_id !== view.id) return fail('CALENDAR_REVISION_CONFLICT');
    if (!context.db.updateIfCurrent(c.current, s.seriesId, { current_view_id: view.id, pointer_revision: count(selected.pointer_revision) + (selected.current_view_id === view.id ? 0 : 1),
      content_revision: count(selected.content_revision) + 1, revision: count(selected.revision) + 1, last_batch_id: batchId, updated_ms: now }, selected)) return fail('CALENDAR_REVISION_CONFLICT');
  }
  context.db.createStrict(c.batches, { id: batchId, scope_id: scope, series_id: s.seriesId, view_id: view.id, run_id: run.id, change_id: null,
    origin_kind: 'native21', origin21_receipt_id: receiptId, phase, logical_key: input.logicalKey, before_revision: beforeRevision,
    after_revision: next.revision, row_count: rows, child_delta: children, resource_delta: resources, directory_delta: directories,
    input_digest: input.semanticDigest, child_root: next.child_root, resource_root: next.resource_root, withdrawals_json: calendarJson(withdrawals), accepted_ms: now });
  return rows;
}
export function calendarSeriesSelectedMaterializationCleanupPending(context: DatabaseReadQueryContext,
  scopeId: string, runId: string): boolean {
  if (context.database.query(`SELECT 1 AS present FROM ${c.heads} h JOIN ${n.runState} q ON q.id=h.native_run_id
    WHERE h.scope_id=? AND h.native_run_id=? AND q.state='aborted' LIMIT 1`).get(scopeId, runId)) return true;
  return context.database.query(`SELECT 1 AS present FROM ${c.batches} b JOIN ${c.views} v ON v.id=b.view_id JOIN ${c.directory} d ON d.view_id=v.id
    JOIN ${n.runState} q ON q.id=b.run_id WHERE b.scope_id=? AND b.run_id=? AND b.phase='begin' AND q.state='aborted' AND v.phase='aborted' LIMIT 1`).get(scopeId, runId) !== null;
}
