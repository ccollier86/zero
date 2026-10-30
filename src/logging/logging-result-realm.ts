/** Private writer commands: a result and its preparation evidence commit together; observations bind in that same actor. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { DatabaseError } from '../databases/database-error';
import type { LoggingEvent, LoggingReadScope } from './logging-contracts';
import type { LoggingResultManifest, LoggingResultReceipt, LoggingResultVersions } from './logging-result-contracts';
import { loggingCanonical, loggingId, loggingRecord, loggingTime, normalizeLoggingEvent } from './logging-validation';
import { normalizeLoggingResultManifest } from './logging-result-validation';
import { loggingDigest } from './logging-hash';
import { loggingTableTarget } from './logging-table-target';
import { normalizeLoggingQuery } from './logging-query';
import { projectLoggingStoredEvent } from './logging-stored-event';

type Append = (context: DatabaseWriteCommandContext, input: unknown) => unknown;
function fail(): never { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Historical result admission is invalid or unavailable.', { outcome: 'not-committed' }); }
const binding = (event: LoggingEvent) => [event.scope.kind, event.scope.tenantId, event.actor.id, event.actor.sessionId, event.policyVersion];
const rowBinding = (row: Record<string, unknown>) => [row.scope_kind, row.tenant_id, row.actor_id, row.session_id, row.policy_version];

export function prepareLoggingResult(context: DatabaseWriteCommandContext, raw: unknown, append: Append): LoggingResultReceipt {
  const r = loggingRecord(raw, ['manifest', 'event', 'expiresAt']), manifest = normalizeLoggingResultManifest(r.manifest), event = normalizeLoggingEvent(r.event);
  const expiresAt = loggingTime(r.expiresAt), digest = loggingDigest(manifest), eventRef = loggingDigest([event.sourceId, event.id]);
  if (event.stream !== 'audit' || event.detail?.kind !== 'result' || event.detail.receiptId !== manifest.id || event.detail.digest !== digest
    || event.detail.table !== manifest.table || event.detail.resultKind !== manifest.kind || event.detail.recordCount !== manifest.records.length
    || event.detail.complete !== manifest.complete || event.occurredAt !== manifest.preparedAt || expiresAt !== manifest.preparedAt + 300000) fail();
  const old = context.db.get('logging_results', manifest.id);
  if (old) {
    if (old.digest !== digest || old.event_ref !== eventRef || loggingCanonical(rowBinding(old)) !== loggingCanonical(binding(event))) fail();
  } else {
    context.db.createStrict('logging_results', { id: manifest.id, scope_kind: event.scope.kind, tenant_id: event.scope.tenantId,
      actor_id: event.actor.id, session_id: event.actor.sessionId, policy_version: event.policyVersion, digest,
      manifest: loggingCanonical(manifest), expires_at: expiresAt, event_ref: eventRef });
  }
  const appended = append(context, { stream: 'audit', events: [event] }) as { status?: string };
  if (appended.status !== 'stored') fail();
  return { id: manifest.id, digest, kind: manifest.kind, table: manifest.table, count: manifest.records.length, expiresAt };
}

export function observeLoggingResult(context: DatabaseWriteCommandContext, raw: unknown, append: Append): unknown {
  const r = loggingRecord(raw, ['receiptId', 'event']), receiptId = loggingId(r.receiptId)!, input = normalizeLoggingEvent(r.event), m = input.metadata;
  if (input.family === 'clipboard' || input.family === 'printing') return observeResultInteraction(context, receiptId, input, append);
  if (input.stream !== 'audit' || input.origin !== 'frontend' || input.actor.kind !== 'user' || !input.actor.sessionId || input.evidence !== 'browser-observed'
    || input.family !== 'views' || !['view.opened', 'view.interval', 'view.closed', 'view.result.changed'].includes(input.action)
    || typeof m.viewId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(m.viewId)
    || !['sequence', 'elapsedMs', 'visibleMs', 'activeMs'].every(key => Number.isSafeInteger(m[key]) && Number(m[key]) >= 0)
    || Number(m.elapsedMs) > 60000 || Number(m.visibleMs) > Number(m.elapsedMs) || Number(m.activeMs) > Number(m.visibleMs)
    || typeof m.incomplete !== 'boolean' || Object.keys(m).some(key => !['viewId', 'sequence', 'elapsedMs', 'visibleMs', 'activeMs', 'incomplete'].includes(key))) fail();
  const result = context.db.get('logging_results', receiptId);
  if (!result || loggingCanonical(rowBinding(result)) !== loggingCanonical(binding(input))) fail();
  const manifest = normalizeLoggingResultManifest(JSON.parse(String(result.manifest)));
  if (result.digest !== loggingDigest(manifest)) fail();
  const viewRef = loggingDigest(['result-view', binding(input), input.sourceId, m.viewId]);
  const target = { type: loggingTableTarget(manifest.table), id: manifest.kind === 'record' ? manifest.records[0]!.id : 'list:' + viewRef };
  const event = normalizeLoggingEvent({ ...input, target, metadata: { ...m, receiptId, resultKind: manifest.kind, resultCount: manifest.records.length, resultActivityRef: viewRef } });
  const eventRef = loggingDigest([event.sourceId, event.id]);
  // Reconcile a lost response exactly, including after expiry or close. Never admit different bytes under the same identity.
  const proof = context.db.get('logging_proofs', eventRef);
  if (proof) { if (proof.digest !== loggingDigest(event) || proof.expired !== 0) fail(); return append(context, { stream: 'audit', events: [event] }); }
  if (!context.db.get('logging_events', String(result.event_ref))) fail();
  const old = context.db.get('logging_result_views', viewRef), sequence = Number(m.sequence);
  if (!old) {
    const priorClaim = Number(result.expires_at) <= Date.now() && context.db.find('logging_result_views', { filters: [
      { type: 'field', field: 'receipt_id', operator: 'eq', value: receiptId }, { type: 'field', field: 'source_id', operator: 'eq', value: event.sourceId }], select: ['id'], limit: 1 }).length > 0;
    if (event.action !== 'view.opened' || sequence !== 0 || m.elapsedMs !== 0 || m.visibleMs !== 0 || m.activeMs !== 0 || Number(result.expires_at) <= Date.now() && !priorClaim) fail();
    context.db.createStrict('logging_result_views', { id: viewRef, receipt_id: receiptId, source_id: event.sourceId, view_id: m.viewId, latest_sequence: 0, closed_sequence: null });
  } else {
    if (event.action === 'view.opened' || old.closed_sequence !== null && sequence > Number(old.closed_sequence)) fail();
    if (event.action === 'view.result.changed') {
      if (old.closed_sequence !== null || sequence <= Number(old.latest_sequence) || old.receipt_id === receiptId || Number(result.expires_at) <= Date.now()) fail();
      const prior = context.db.get('logging_results', String(old.receipt_id));
      if (!prior) fail();
      const previous = normalizeLoggingResultManifest(JSON.parse(String(prior.manifest)));
      if (previous.kind !== manifest.kind || previous.table !== manifest.table || manifest.kind === 'record' && previous.records[0]!.id !== manifest.records[0]!.id) fail();
    } else {
      const versions = context.db.find('logging_result_view_versions', { filters: [{ type: 'field', field: 'view_ref', operator: 'eq', value: viewRef }, { type: 'field', field: 'sequence', operator: 'lte', value: sequence }], order: [{ field: 'sequence', direction: 'desc' }], limit: 1 });
      if (versions[0]?.receipt_id !== receiptId) fail();
    }
    context.db.update('logging_result_views', viewRef, { receipt_id: sequence > Number(old.latest_sequence) ? receiptId : old.receipt_id,
      latest_sequence: Math.max(sequence, Number(old.latest_sequence)), closed_sequence: event.action === 'view.closed' ? sequence : old.closed_sequence });
  }
  if (!old || event.action === 'view.result.changed') context.db.createStrict('logging_result_view_versions', {
    id: loggingDigest([viewRef, sequence]), view_ref: viewRef, receipt_id: receiptId, sequence, event_ref: eventRef });
  const resultAppend = append(context, { stream: 'audit', events: [event] }) as { status?: string };
  if (resultAppend.status !== 'stored') fail();
  return resultAppend as DatabaseSerializableValue;
}

function observeResultInteraction(context: DatabaseWriteCommandContext, receiptId: string, input: LoggingEvent, append: Append): unknown {
  const allowed = input.family === 'clipboard' ? ['clipboard.copy.observed', 'clipboard.copy.completed', 'clipboard.copy.failed'] : ['print.requested', 'print.dialog.closed'];
  if (input.origin !== 'frontend' || input.actor.kind !== 'user' || !input.actor.sessionId || input.evidence !== 'browser-observed' || !allowed.includes(input.action) || Object.keys(input.metadata).length) fail();
  const row = context.db.get('logging_results', receiptId);
  if (!row || loggingCanonical(rowBinding(row)) !== loggingCanonical(binding(input))) fail();
  const manifest = normalizeLoggingResultManifest(JSON.parse(String(row.manifest)));
  if (row.digest !== loggingDigest(manifest)) fail();
  const event = normalizeLoggingEvent({ ...input, target: { type: loggingTableTarget(manifest.table), id: manifest.kind === 'record' ? manifest.records[0]!.id : 'list:' + receiptId },
    metadata: { receiptId, resultKind: manifest.kind, resultCount: manifest.records.length } });
  const proof = context.db.get('logging_proofs', loggingDigest([event.sourceId, event.id]));
  if (proof) { if (proof.digest !== loggingDigest(event) || proof.expired !== 0) fail(); return append(context, { stream: 'audit', events: [event] }); }
  if (!context.db.get('logging_events', String(row.event_ref)) || !context.db.find('logging_result_views', { filters: [
    { type: 'field', field: 'receipt_id', operator: 'eq', value: receiptId }, { type: 'field', field: 'source_id', operator: 'eq', value: input.sourceId },
    { type: 'field', field: 'closed_sequence', operator: 'eq', value: null }], select: ['id'], limit: 1 }).length) fail();
  return append(context, { stream: 'audit', events: [event] });
}

export function readLoggingResult({ database }: DatabaseReadQueryContext, raw: unknown): LoggingResultManifest | null {
  const r = loggingRecord(raw, ['id', 'scope']), id = loggingId(r.id)!, scope = normalizeLoggingQuery('audit', r.scope as LoggingReadScope, {}).scope;
  const row = database.query<Record<string, unknown>>('SELECT * FROM logging_results WHERE id=?' + (scope.kind === 'platform' ? '' : ' AND scope_kind=? AND tenant_id IS ?'))
    .get(...(scope.kind === 'platform' ? [id] : [id, scope.kind, scope.kind === 'tenant' ? scope.tenantId : null]));
  if (!row) return null;
  const source = database.query<import('./logging-stored-event').LoggingStoredRow>('SELECT e.*,p.digest AS proof_digest,p.previous_hash,p.chain_hash,p.expired FROM logging_events e JOIN logging_proofs p ON p.id=e.id WHERE e.id=?').get(String(row.event_ref));
  if (!source) return null;
  const event = projectLoggingStoredEvent(source).event, manifest = normalizeLoggingResultManifest(JSON.parse(String(row.manifest)));
  if (row.id !== manifest.id || row.digest !== loggingDigest(manifest) || event.detail?.kind !== 'result' || event.detail.digest !== row.digest
    || event.detail.receiptId !== row.id || loggingCanonical(rowBinding(row)) !== loggingCanonical(binding(event))) fail();
  return manifest;
}

export function readLoggingResultVersions(context: DatabaseReadQueryContext, raw: unknown): LoggingResultVersions {
  const r = loggingRecord(raw, ['activityId', 'scope', 'beforeOrdinal', 'highWaterOrdinal']);
  if (typeof r.activityId !== 'string' || !/^[a-f0-9]{64}$/.test(r.activityId)) fail();
  const scope = normalizeLoggingQuery('audit', r.scope as LoggingReadScope, {}).scope;
  const before = r.beforeOrdinal === undefined ? Number.MAX_SAFE_INTEGER : loggingTime(r.beforeOrdinal);
  const high = r.highWaterOrdinal === undefined ? Number.MAX_SAFE_INTEGER : loggingTime(r.highWaterOrdinal);
  const rows = context.database.query<{ id: string; ordinal: number; digest: string; expires_at: number }>(
    'SELECT r.id,a.ordinal,r.digest,r.expires_at FROM logging_result_view_versions v JOIN logging_activity_revisions a ON a.id=v.event_ref JOIN logging_results r ON r.id=v.receipt_id '
    + 'WHERE a.activity_id=? AND a.ordinal<? AND a.ordinal<=?' + (scope.kind === 'platform' ? '' : ' AND r.scope_kind=? AND r.tenant_id IS ?')
    + ' AND EXISTS(SELECT 1 FROM logging_events e WHERE e.id=r.event_ref) ORDER BY a.ordinal DESC LIMIT 21')
    .all(r.activityId, before, high, ...(scope.kind === 'platform' ? [] : [scope.kind, scope.kind === 'tenant' ? scope.tenantId : null]));
  const items = rows.slice(0, 20).map(row => {
    const manifest = readLoggingResult(context, { id: row.id, scope });
    if (!manifest) fail();
    return { receipt: { id: manifest.id, digest: row.digest, kind: manifest.kind, table: manifest.table, count: manifest.records.length, expiresAt: row.expires_at }, preparedAt: manifest.preparedAt, ordinal: row.ordinal };
  });
  return { items, nextBeforeOrdinal: rows.length > 20 ? items.at(-1)!.ordinal : null };
}
