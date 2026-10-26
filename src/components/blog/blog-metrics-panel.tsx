'use client';

/** Daily aggregate investigation using the native reactive projection and the existing table. Not human-attention or compliance evidence. */
import * as React from 'react';
import type { BlogClient } from '../../blog/client-contracts';
import type { BlogMetricsPage } from '../../blog/metrics-types';
import { DataTable } from '../data-table';
import { defineSchema, field } from '../../schema';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const schema = defineSchema({ day: field.text({ label: 'Day (UTC)' }), post: field.text({ label: 'Article ID' }), views: field.number({ label: 'View observations' }), engagements: field.number({ label: 'Engagement observations' }), seconds: field.number({ label: 'Reported foreground seconds' }) });
export function BlogMetricsPanel({ client }: { client: BlogClient }) {
  const [capabilities, setCapabilities] = React.useState<{ enabled: boolean; retentionDays: number } | null>(null), [page, setPage] = React.useState<BlogMetricsPage | null>(null), [error, setError] = React.useState(false);
  const [offset, setOffset] = React.useState(0), [since, setSince] = React.useState(''), [until, setUntil] = React.useState('');
  React.useEffect(() => { let active = true; void client.metrics.capabilities().then(value => { if (active) setCapabilities(value); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [client]);
  React.useEffect(() => { if (!capabilities?.enabled) return; const owner = new AbortController(); setPage(null); setError(false);
    const stop = client.watchMetrics(value => { if (!owner.signal.aborted) { setPage(value); setError(false); } }, { query: { limit: 25, offset, since: since || undefined, until: until || undefined }, signal: owner.signal,
      onError: () => { if (!owner.signal.aborted) { setError(true); setPage(null); } } });
    return () => { owner.abort(); stop(); }; }, [client, capabilities?.enabled, offset, since, until]);
  if (capabilities && !capabilities.enabled) return <p>Article metrics are disabled. Opt in with blog.content.metrics.enabled to collect aggregate observations without user identifiers or third-party analytics.</p>;
  return <section aria-label="Article observations"><p className="zero-blog-muted">Browser observations, not unique people or proof of attention. Reported foreground time is bounded per signed ticket. Configured retention: {capabilities?.retentionDays ?? '…'} days.</p>
    <div className="zero-blog-workspace-toolbar"><label>From<Input type="date" value={since} onChange={event => { setSince(event.target.value); setOffset(0); }} /></label><label>Through<Input type="date" value={until} onChange={event => { setUntil(event.target.value); setOffset(0); }} /></label></div>
    {error && <p role="alert">Current aggregate access could not be verified. Counts remain hidden until a fresh authorized read succeeds.</p>}
    {page && <DataTable schema={schema} primaryKey="id" data={page.items.map(day => ({ id: day.postId + ':' + day.day, day: day.day, post: day.postId, views: day.views, engagements: day.engagements, seconds: Math.round(day.visibleMs / 1000) }))} columns={schema.fieldNames as string[]} showExport={false} sortable={false} searchable={false} />}
    <nav aria-label="Observation pages"><Button type="button" variant="ghost" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Newer</Button><Button type="button" variant="ghost" disabled={!page?.hasMore} onClick={() => setOffset(offset + 25)}>Older</Button></nav>
  </section>;
}
