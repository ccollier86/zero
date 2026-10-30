'use client';
/** Ordered historical result exploration. Reauthorization occurs on every version/manifest request. */
import * as React from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { LoggingResultManifest, LoggingResultVersions } from '../../logging/logging-result-contracts';
import { defineSchema, field } from '../../schema';
import { DataTable } from '../data-table';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { modals } from '../../modals';
import { LoggingHistory } from './logging-history';
import { loggingFieldValue } from './logging-change-presentation';
import { loggingWords } from './logging-readable-activity';
const schema = defineSchema({ position: field.number({ label: 'Position' }), record: field.text({ label: 'Record ID' }), revision: field.text({ label: 'Source revision' }), values: field.text({ label: 'Retained values' }) });

export function LoggingResultExplorer({ receiptId, activityId, highWaterOrdinal, scopeKey, platform = false }: {
  receiptId: string; activityId?: string; highWaterOrdinal?: number; scopeKey: string; platform?: boolean;
}) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client), key = JSON.stringify([scopeKey, platform, activityId, highWaterOrdinal]);
  const [selected, setSelected] = React.useState(receiptId), [retry, setRetry] = React.useState(0);
  const [versions, setVersions] = React.useState<{ key: string; page: LoggingResultVersions } | null>(null);
  const [result, setResult] = React.useState<{ key: string; id: string; manifest: LoggingResultManifest | null; failed: boolean } | null>(null);
  const current = React.useRef(key); current.current = key;
  const olderController = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => { olderController.current?.abort(); olderController.current = null; }, [key]);
  React.useEffect(() => { setSelected(receiptId); }, [key, receiptId]);
  const ready = Boolean(client && boundary.ready && boundary.stable && boundary.key === scopeKey);
  React.useEffect(() => {
    if (!ready || !activityId || !client) return;
    const abort = new AbortController();
    void client.logging.resultVersions(activityId, { platform, highWaterOrdinal, signal: abort.signal }).then(page => {
      if (!abort.signal.aborted && current.current === key) setVersions({ key, page });
    }).catch(() => { /* The selected retained result remains inspectable. Older versions expose an explicit retry below. */ });
    return () => abort.abort();
  }, [client, ready, key, activityId, retry]);
  React.useEffect(() => {
    if (!ready || !client) return;
    const abort = new AbortController();
    void client.logging.result(selected, { platform, signal: abort.signal }).then(manifest => {
      if (!abort.signal.aborted && current.current === key) setResult({ key, id: selected, manifest, failed: false });
    }).catch(() => { if (!abort.signal.aborted && current.current === key) setResult({ key, id: selected, manifest: null, failed: true }); });
    return () => abort.abort();
  }, [client, ready, key, selected, retry]);
  const [olderBusy, setOlderBusy] = React.useState(false), [olderError, setOlderError] = React.useState(false);
  const page = versions?.key === key ? versions.page : null;
  const older = async () => {
    if (!client || !activityId || !ready || !page?.nextBeforeOrdinal || olderBusy) return;
    setOlderBusy(true); setOlderError(false);
    const abort = new AbortController(); olderController.current?.abort(); olderController.current = abort;
    try {
      const next = await client.logging.resultVersions(activityId, { platform, highWaterOrdinal, beforeOrdinal: page.nextBeforeOrdinal, signal: abort.signal });
      if (!abort.signal.aborted && current.current === key) setVersions({ key, page: { items: [...page.items, ...next.items], nextBeforeOrdinal: next.nextBeforeOrdinal } });
    } catch { if (!abort.signal.aborted && current.current === key) setOlderError(true); }
    finally { if (!abort.signal.aborted && current.current === key) setOlderBusy(false); }
  };
  if (!ready) return <p role="status" className="text-sm text-muted-foreground">Historical results are hidden while access is revalidated.</p>;
  const visible = result?.key === key && result.id === selected ? result : null, manifest = visible?.manifest;
  const rows = manifest?.records.map((record, index) => ({ id: String(index), position: index + 1, record: record.id, revision: record.revision,
    values: Object.entries(record.values).map(([key, value]) => `${loggingWords(key)}: ${loggingFieldValue(value, true)}`).join(' · ') || 'Values private', target: { type: record.type, id: record.id } })) ?? [];
  return <section className="space-y-3" aria-label="Recorded result"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Recorded result</h4>
    {activityId && <Select value={selected} onValueChange={setSelected}><SelectTrigger aria-label="Displayed result version" className="max-w-xs"><SelectValue /></SelectTrigger><SelectContent>
      {!page?.items.some(item => item.receipt.id === receiptId) && <SelectItem value={receiptId}>Displayed result at this activity revision</SelectItem>}
      {page?.items.filter((item, index, items) => items.findIndex(other => other.receipt.id === item.receipt.id) === index).map(item => <SelectItem key={item.receipt.id} value={item.receipt.id}>{new Date(item.preparedAt).toLocaleString()} · {item.receipt.count} records</SelectItem>)}
    </SelectContent></Select>}
  </div>
    {!visible ? <p role="status" className="text-sm text-muted-foreground">Loading recorded result…</p> : visible.failed ? <div role="alert" className="space-y-2 text-sm"><p>The historical result could not be loaded under current access.</p><Button variant="outline" size="sm" onClick={() => setRetry(n => n + 1)}>Retry historical result</Button></div>
      : !manifest ? <p className="text-sm text-muted-foreground">This historical result is unavailable or no longer retained. Current application data has not been substituted.</p>
      : <><p className="text-xs leading-relaxed text-muted-foreground">{loggingWords(manifest.table)} · {manifest.records.length} records, in the order returned. {manifest.complete ? 'The bounded result is complete.' : 'This result is incomplete.'} Values appear only where the capture policy explicitly allowed them. Select a record for its activity history.</p>
      <DataTable schema={schema} data={rows} columns={schema.fieldNames as string[]} paginated={{ pageSize: 20 }} sortable={false} searchable={false} filterable={false} selectable={false} showExport={false} cellMotion={false}
        onRowClick={row => modals.show({ title: `Activity for record ${row.record}`, size: 'xl', body: <LoggingHistory scopeKey={scopeKey} platform={platform} query={{ projection: 'activities', targetType: row.target.type, targetId: row.target.id }} /> })}
        emptyState={<p className="p-5 text-center text-sm text-muted-foreground">The user saw an empty result. No records matched that displayed query.</p>} />
      </>}
    {activityId && !page && <Button size="sm" variant="ghost" onClick={() => setRetry(n => n + 1)}>Load displayed-result history</Button>}
    {page?.nextBeforeOrdinal && <Button size="sm" variant="outline" disabled={olderBusy} onClick={() => { void older(); }}>{olderBusy ? 'Loading earlier results…' : 'Load earlier displayed results'}</Button>}
    {olderError && <p role="alert" className="text-xs text-destructive">Earlier result versions could not be loaded. Retry when access is available.</p>}
  </section>;
}
