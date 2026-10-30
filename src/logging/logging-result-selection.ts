/** Actor-owned derivation: a client chooses positions, never record identities, revisions or values. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { DatabaseError } from '../databases/database-error';
import type { LoggingResultManifest, LoggingResultReceipt } from './logging-result-contracts';
import { LOGGING_RESULT_MAX_RECORDS } from './logging-result-contracts';
import { normalizeLoggingDeriveResultInput, normalizeLoggingResultManifest } from './logging-result-validation';
import { loggingCanonical, loggingRecord, normalizeLoggingEvent } from './logging-validation';
import { loggingDigest } from './logging-hash';
import { loggingTableTarget } from './logging-table-target';
import { prepareLoggingResult } from './logging-result-realm';
import { LoggingError } from './logging-error';

function fail(): never { throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Displayed selection is invalid or no longer available.', { outcome: 'not-committed' }); }
export function deriveLoggingResult(context: DatabaseWriteCommandContext, raw: unknown, append: Parameters<typeof prepareLoggingResult>[2]): LoggingResultReceipt {
  try { return derive(context, raw, append); }
  catch (error) { if (error instanceof LoggingError && error.code === 'LOGGING_EVENT_INVALID') fail(); throw error; }
}
function derive(context: DatabaseWriteCommandContext, raw: unknown, append: Parameters<typeof prepareLoggingResult>[2]): LoggingResultReceipt {
  const r = loggingRecord(raw, ['selection', 'event']), input = normalizeLoggingDeriveResultInput(r.selection), template = normalizeLoggingEvent(r.event);
  if (template.stream !== 'audit' || template.origin !== 'backend' || template.actor.kind !== 'user' || !template.actor.sessionId) fail();
  const binding = [template.scope.kind, template.scope.tenantId, template.actor.id, template.actor.sessionId, template.policyVersion];
  const id = 'selection:' + loggingDigest([binding, input.id]), criteriaDigest = loggingDigest(input);
  const matches = (row: Record<string, unknown>) => loggingCanonical([row.scope_kind, row.tenant_id, row.actor_id, row.session_id, row.policy_version]) === loggingCanonical(binding);
  const old = context.db.get('logging_results', id);
  if (old) {
    const manifest = normalizeLoggingResultManifest(JSON.parse(String(old.manifest)));
    if (!matches(old) || old.digest !== loggingDigest(manifest) || manifest.criteriaDigest !== criteriaDigest || !context.db.get('logging_events', String(old.event_ref))) fail();
    return { id, digest: String(old.digest), kind: manifest.kind, table: manifest.table, count: manifest.records.length, expiresAt: Number(old.expires_at) };
  }
  const records: LoggingResultManifest['records'][number][] = [], sources = new Map<string, string>();
  let table: string | undefined, complete = true;
  const includeSource = (receiptId: string, digest: string) => {
    if (sources.has(receiptId) && sources.get(receiptId) !== digest) fail();
    sources.set(receiptId, digest);
    if (sources.size > LOGGING_RESULT_MAX_RECORDS) fail();
  };
  for (const selected of input.sources) {
    const row = context.db.get('logging_results', selected.receiptId);
    if (!row || !matches(row) || !context.db.get('logging_events', String(row.event_ref))) fail();
    const source = normalizeLoggingResultManifest(JSON.parse(String(row.manifest)));
    if (row.digest !== loggingDigest(source) || table !== undefined && table !== source.table) fail();
    table = source.table; complete &&= source.complete;
    includeSource(source.id, String(row.digest));
    for (const ancestor of source.sources ?? []) includeSource(ancestor.receiptId, ancestor.digest);
    for (const position of selected.positions) { const record = source.records[position]; if (!record) fail(); records.push(record); }
  }
  // Flattened lineage is verified now and linked to a displayed activity later. Retired evidence is never re-created.
  for (const [receiptId, digest] of sources) {
    const row = context.db.get('logging_results', receiptId);
    if (!row || !matches(row) || row.digest !== digest || !context.db.get('logging_events', String(row.event_ref))) fail();
  }
  const manifest = normalizeLoggingResultManifest({ version: 1, id, kind: input.kind, table, preparedAt: template.occurredAt,
    criteriaDigest, records, complete, sources: [...sources].map(([receiptId, digest]) => ({ receiptId, digest })) });
  const digest = loggingDigest(manifest), event = normalizeLoggingEvent({ ...template, version: 2, id: 'result:' + id,
    action: input.kind === 'record' ? 'record.read.prepared' : 'record.list.prepared',
    target: { type: loggingTableTarget(manifest.table), id: input.kind === 'record' ? records[0]!.id : id },
    detail: { kind: 'result', receiptId: id, digest, resultKind: input.kind, table: manifest.table, recordCount: records.length, complete } });
  return prepareLoggingResult(context, { manifest, event, expiresAt: manifest.preparedAt + 300000 }, append);
}
