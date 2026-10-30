/** Bounded history segments accompany activities; raw v1 exports keep their original byte format. */
import type { LoggingRuntime } from './logging-runtime';
import type { LoggingReadScope, StoredLoggingEvent } from './logging-contracts';
import type { LoggingResultManifest } from './logging-result-contracts';
import { loggingByteLength } from './logging-validation';
import { LoggingError } from './logging-error';
import { loggingDigest } from './logging-hash';

export async function loggingExportHistory(runtime: LoggingRuntime, scope: LoggingReadScope, row: StoredLoggingEvent, highWater: number, budget: number) {
  if (!row.activity) return { row, complete: true };
  let bytes = loggingByteLength(row);
  const charge = (value: unknown) => { bytes += loggingByteLength(value); if (bytes > budget) throw new LoggingError('LOGGING_BACKPRESSURE', 'Activity history exceeds the export byte budget; narrow the query.'); };
  const water = Math.min(highWater, row.activity.revision);
  const evidence = await runtime.page(row.event.stream, scope, { activityId: row.activity.id, projection: 'events', highWaterOrdinal: water, limit: 100, includeTotal: false });
  charge(evidence);
  const versions = await runtime.resultVersions(scope, row.activity.id, undefined, water);
  charge(versions);
  const results: { ordinal: number; receipt: typeof versions.items[number]['receipt']; manifest: LoggingResultManifest | null }[] = [];
  const needed = new Map<string, string>(), lineage: LoggingResultManifest[] = [], unavailable: string[] = [];
  let complete = !evidence.hasMore && versions.nextBeforeOrdinal === null;
  for (const version of versions.items) {
    const manifest = await runtime.result(scope, version.receipt.id); charge(manifest);
    results.push({ ordinal: version.ordinal, receipt: version.receipt, manifest });
    if (!manifest) { complete = false; unavailable.push(version.receipt.id); }
    for (const source of manifest?.sources ?? []) needed.set(source.receiptId, source.digest);
  }
  let sourceCount = 0;
  for (const [id, digest] of needed) {
    if (results.some(result => result.manifest?.id === id)) continue;
    if (sourceCount++ >= 100) { complete = false; continue; }
    const source = await runtime.result(scope, id); charge(source);
    if (source && loggingDigest(source) !== digest) throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Retained result lineage does not match its recorded digest.');
    if (source) lineage.push(source); else { complete = false; unavailable.push(id); }
  }
  // A selected receipt can disappear under retention before its version query.
  // Never replace it with a current-domain read or silently claim complete history.
  if (row.activity.resultReceiptId && !results.some(result => result.receipt.id === row.activity!.resultReceiptId)) {
    complete = false; unavailable.push(row.activity.resultReceiptId);
  }
  const item = { ...row, history: { version: 1, complete, results, lineage, supportingEvidence: evidence.events,
    nextResultBeforeOrdinal: versions.nextBeforeOrdinal, nextEvidenceBeforeOrdinal: evidence.nextBeforeOrdinal,
    omittedSourceIds: [...needed.keys()].filter(id => !lineage.some(source => source.id === id) && !results.some(result => result.manifest?.id === id) && !unavailable.includes(id)),
    unavailableResultIds: [...new Set(unavailable)] } };
  if (loggingByteLength(item) > budget) throw new LoggingError('LOGGING_BACKPRESSURE', 'Activity history exceeds the export byte budget; narrow the query.');
  return { row: item, complete };
}
