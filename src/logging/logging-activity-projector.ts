/** Deterministic same-writer projection. Groups only declared service/read identities or scoped sequenced view lifetimes. */
import type { DatabaseWriteCommandCapability } from '../databases/database-write-command-capability';
import type { LoggingEvent } from './logging-contracts';
import type { LoggingActivitySummary, LoggingViewSummary } from './logging-activity-summary';
import { loggingCanonical, loggingRecord, normalizeLoggingEvent } from './logging-validation';
import { loggingDigest } from './logging-hash';
import { DatabaseError } from '../databases/database-error';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { normalizeLoggingResultManifest } from './logging-result-validation';

function fail(): never { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Activity evidence is inconsistent.', { outcome: 'not-committed' }); }
function viewInterval(event: LoggingEvent) {
  if (event.origin !== 'frontend' || event.evidence !== 'browser-observed' || event.family !== 'views' || !['view.opened', 'view.interval', 'view.closed', 'view.result.changed'].includes(event.action)) return null;
  const m = event.metadata;
  if (typeof m.viewId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(m.viewId)
    || !['sequence', 'elapsedMs', 'visibleMs', 'activeMs'].every(key => Number.isSafeInteger(m[key]) && Number(m[key]) >= 0)
    || Number(m.elapsedMs) > 60000 || Number(m.visibleMs) > Number(m.elapsedMs) || Number(m.activeMs) > Number(m.visibleMs)
    || typeof m.incomplete !== 'boolean') return null; // Unsupported historical facts remain individual evidence.
  return { viewId: m.viewId, sequence: Number(m.sequence), elapsedMs: Number(m.elapsedMs), visibleMs: Number(m.visibleMs), activeMs: Number(m.activeMs), incomplete: m.incomplete };
}
export function loggingActivityKey(event: LoggingEvent): { id: string; action: string; view: ReturnType<typeof viewInterval> } | null {
  if (event.action === 'logging.retention.applied') return null;
  if (event.stream === 'audit' && (/^access\.http\./.test(event.action) || ['logging.delivery.acknowledged', 'logging.machine.admitted'].includes(event.action))) return null;
  // Interactive preparations/prefetches are supporting evidence, not proof that a result was displayed.
  if (event.detail?.kind === 'result' && event.actor.kind === 'user' && event.actor.sessionId) return null;
  const v = viewInterval(event);
  const owner = [event.stream, event.scope, event.actor, event.policyVersion];
  if (v) {
    const ref = event.metadata.resultActivityRef;
    if (typeof ref === 'string' && /^[a-f0-9]{64}$/.test(ref)) return { id: ref, action: event.metadata.resultKind === 'list' ? 'record.list.viewed' : 'record.viewed', view: v };
    return { id: loggingDigest(['view', owner, event.sourceId, v.viewId]), action: 'view.record', view: v };
  }
  if (event.origin !== 'frontend' && event.family === 'investigations' && event.action === 'logging.query.window' && event.correlationId)
    return { id: loggingDigest(['investigation', owner, event.sourceId, event.correlationId]), action: event.action, view: null };
  if (event.origin !== 'frontend' && event.target?.type === 'service.invocation' && ['ai', 'communications', 'workflow', 'transfers'].includes(event.family))
    return { id: loggingDigest(['service', owner, event.sourceId, event.target.id]), action: event.action.replace(/\.(?:admitted|accepted|rejected|completed|failed|denied|unknown)$/, ''), view: null };
  if (event.origin !== 'frontend' && event.family === 'records' && event.correlationId && /^record\.read\.(?:admitted|prepared|failed|denied|unknown)$/.test(event.action))
    return { id: loggingDigest(['read', owner, event.sourceId, event.correlationId]), action: 'record.read', view: null };
  return { id: loggingDigest(['event', event.sourceId, event.id]), action: event.action, view: null };
}

/** Called only for a genuinely new immutable event, in the very same writer transaction. */
export function projectLoggingActivity(db: DatabaseWriteCommandCapability, event: LoggingEvent, eventRef: string, ordinal: number, ingestedAt: number): void {
  if (event.detail?.kind === 'record-change') for (const change of event.detail.changes) {
    const id = loggingDigest([eventRef, change.field]);
    if (!db.get('logging_change_fields', id)) db.createStrict('logging_change_fields', { id, event_ref: eventRef, field: change.field });
  }
  const key = loggingActivityKey(event); if (!key) return;
  if (Number(db.get('logging_activity_retirements', key.id)?.through ?? 0) >= ordinal) return;
  const old = db.get('logging_activities', key.id), binding = loggingDigest([event.scope, event.actor, event.policyVersion, event.target, key.action]);
  if (old && old.binding !== binding) fail();
  const previous = old ? JSON.parse(String(old.summary)) as LoggingActivitySummary : null;
  const view = key.view;
  const receiptId = (view || event.origin === 'frontend' && ['clipboard', 'printing'].includes(event.family)) && typeof event.metadata.receiptId === 'string' ? event.metadata.receiptId : undefined;
  let additionalEvidence = 0;
  let evidenceSince = event.occurredAt, evidenceUntil = event.occurredAt;
  if (receiptId) {
    const selected = db.get('logging_results', receiptId); if (!selected) fail();
    const manifest = normalizeLoggingResultManifest(JSON.parse(String(selected.manifest)));
    for (const source of [{ receiptId, digest: String(selected.digest) }, ...manifest.sources ?? []]) {
      const result = db.get('logging_results', source.receiptId), prepared = result && db.get('logging_events', String(result.event_ref));
      if (!result || !prepared || result.digest !== source.digest) fail();
      evidenceSince = Math.min(evidenceSince, Number(prepared.occurred_at)); evidenceUntil = Math.max(evidenceUntil, Number(prepared.occurred_at));
      const id = loggingDigest([key.id, result.event_ref]);
      if (!db.get('logging_activity_evidence', id)) {
        db.createStrict('logging_activity_evidence', { id, activity_id: key.id, event_ref: result.event_ref, ordinal: prepared.ordinal, linked_at: ordinal });
        additionalEvidence++;
      }
    }
  }
  let observed: LoggingViewSummary | undefined;
  if (view) {
    const p = previous?.view;
    const existing = db.find('logging_activity_revisions', { filters: [{ type: 'field', field: 'activity_id', operator: 'eq', value: key.id }, { type: 'field', field: 'view_sequence', operator: 'eq', value: view.sequence }], select: ['id'], limit: 1 });
    if (existing.length) fail();
    if (event.action === 'view.opened' && (view.sequence !== 0 || view.elapsedMs || view.visibleMs || view.activeMs)) fail();
    const closedSequence = event.action === 'view.closed' ? view.sequence : p?.closedSequence ?? null;
    const maxSequence = Math.max(p?.maxSequence ?? 0, view.sequence), observations = (p?.observations ?? 0) + 1;
    const openedAt = event.action === 'view.opened' ? event.occurredAt : p?.openedAt ?? null;
    const explicitIncomplete = view.incomplete || p?.explicitIncomplete || false;
    const afterClose = p?.afterClose || closedSequence !== null && maxSequence > closedSequence;
    observed = { viewId: view.viewId, openedAt, closedAt: event.action === 'view.closed' ? event.occurredAt : p?.closedAt ?? null,
      elapsedMs: (p?.elapsedMs ?? 0) + view.elapsedMs, visibleMs: (p?.visibleMs ?? 0) + view.visibleMs, activeMs: (p?.activeMs ?? 0) + view.activeMs,
      observations, maxSequence, explicitIncomplete, afterClose, closedSequence, complete: !explicitIncomplete && !afterClose && openedAt !== null && observations === maxSequence + 1 };
    if (![observed.elapsedMs, observed.visibleMs, observed.activeMs, observations].every(Number.isSafeInteger)) fail();
  }
  // A later response cannot silently turn an earlier definite failure into success.
  const outcome = previous && (['failed', 'denied', 'unknown'].includes(previous.outcome) || event.outcome === 'attempted') ? previous.outcome : event.outcome;
  const summary: LoggingActivitySummary = { version: 1, id: key.id, action: key.action, outcome,
    firstOrdinal: previous?.firstOrdinal ?? ordinal, revision: ordinal, startedAt: Math.min(previous?.startedAt ?? event.occurredAt, event.occurredAt),
    evidenceCount: (previous?.evidenceCount ?? 0) + 1 + additionalEvidence,
    ...(receiptId ? { resultReceiptId: !view || view.sequence >= (previous?.view?.maxSequence ?? 0) ? receiptId : previous!.resultReceiptId } : {}),
    ...(observed ? { view: observed } : {}) };
  const encoded = loggingCanonical(summary), digest = loggingDigest(summary);
  const columns = { stream: event.stream, scope_kind: event.scope.kind, tenant_id: event.scope.tenantId, actor_id: event.actor.id, actor_kind: event.actor.kind, initiator_id: event.actor.initiatorId, session_id: event.actor.sessionId,
    family: event.family, action: summary.action, level: event.level, outcome, target_type: event.target?.type ?? null, target_id: event.target?.id ?? null,
    occurred_at: summary.startedAt, ingested_at: Number(old?.ingested_at ?? ingestedAt), event_ref: eventRef, summary: encoded, digest };
  const bounds = { evidence_since: Math.min(evidenceSince, Number(old?.evidence_since ?? evidenceSince)), evidence_until: Math.max(evidenceUntil, Number(old?.evidence_until ?? evidenceUntil)) };
  if (old) db.update('logging_activities', key.id, { ...columns, ...bounds, revision: ordinal });
  else db.createStrict('logging_activities', { id: key.id, ordinal, revision: ordinal, binding, ...columns, ...bounds });
  db.createStrict('logging_activity_revisions', { id: eventRef, ordinal, activity_id: key.id, activity_ordinal: summary.firstOrdinal, view_sequence: view?.sequence ?? null, ...columns });
  db.createStrict('logging_activity_evidence', { id: loggingDigest([key.id, eventRef]), activity_id: key.id, event_ref: eventRef, ordinal, linked_at: ordinal });
}

/** Bounded restartable backfill. Does not touch original envelopes, hashes, custody, or replay proofs. */
export function rebuildLoggingActivities({ db }: DatabaseWriteCommandContext, raw: unknown) {
  loggingRecord(raw, []);
  const state = db.get('logging_activity_state', 'projection'), cursor = Number(state?.cursor ?? 0);
  const head = Number(db.get('logging_state', 'head')?.ordinal ?? 0);
  const rows = db.find('logging_events', { select: ['id', 'envelope', 'ordinal', 'ingested_at', 'digest'], filters: [{ type: 'field', field: 'ordinal', operator: 'gt', value: cursor }], order: [{ field: 'ordinal', direction: 'asc' }], limit: 100 }) as { id: string; envelope: string; ordinal: number; ingested_at: number; digest: string }[];
  for (const row of rows) {
    const event = normalizeLoggingEvent(JSON.parse(row.envelope));
    if (loggingDigest(event) !== row.digest || loggingDigest([event.sourceId, event.id]) !== row.id) fail();
    if (!db.get('logging_activity_revisions', row.id)) projectLoggingActivity(db, event, row.id, row.ordinal, row.ingested_at);
  }
  const through = rows.length === 100 ? rows.at(-1)!.ordinal : head;
  if (state) db.update('logging_activity_state', 'projection', { cursor: through });
  else db.createStrict('logging_activity_state', { id: 'projection', cursor: through, version: 1 });
  return { cursor: through, hasMore: through < head };
}
