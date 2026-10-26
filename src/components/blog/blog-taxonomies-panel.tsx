'use client';

/** Scoped taxonomy CRUD over the public facade with explicit revision checks and retained retry identity. No app tables or raw SQL. */
import * as React from 'react';
import type { BlogClient } from '../../blog/client-contracts';
import type { BlogTaxonomyTerm, BlogTermInput, BlogPage } from '../../blog/content-types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ControlledModal } from '../../modals/modal-controlled';
import { modals } from '../../modals';
import { DataTable } from '../data-table';
import { defineSchema, field } from '../../schema';

const schema = defineSchema({ name: field.text({ label: 'Name' }), kind: field.text({ label: 'Type' }), slug: field.text({ label: 'Slug' }), description: field.text({ label: 'Description' }) });
export function BlogTaxonomiesPanel({ client, onChange, candidates = [], moreTerms }: { client: BlogClient; onChange(): void; candidates?: readonly BlogTaxonomyTerm[]; moreTerms?: React.ReactNode }) {
  const [page, setPage] = React.useState<BlogPage<BlogTaxonomyTerm> | null>(null), [offset, setOffset] = React.useState(0), [version, setVersion] = React.useState(0), [error, setError] = React.useState(false);
  const [selected, setSelected] = React.useState<BlogTaxonomyTerm | 'new' | null>(null), [origin, setOrigin] = React.useState<Element | null>(null);
  React.useEffect(() => { const owner = new AbortController(); setPage(null); setError(false);
    void client.taxonomies.list({ limit: 50, offset }, { signal: owner.signal }).then(value => { if (!owner.signal.aborted) setPage(value); }).catch(() => { if (!owner.signal.aborted) setError(true); });
    return () => owner.abort(); }, [client, offset, version]);
  return <div className="zero-blog-taxonomies-panel"><Button type="button" variant="outline" onClick={event => { setOrigin(event.currentTarget); setSelected('new'); }}>Add category or tag</Button>
    {error && <p role="alert">Taxonomies could not be loaded. <Button type="button" variant="ghost" onClick={() => setVersion(value => value + 1)}>Retry</Button></p>}
    {page && <><DataTable schema={schema} data={page.items.map(term => ({ ...term }))} columns={schema.fieldNames as string[]} primaryKey="id" searchable={false} sortable={false} showExport={false} onRowClick={row => setSelected(row)} />
      <nav aria-label="Taxonomy pages"><Button type="button" variant="ghost" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button><Button type="button" variant="ghost" disabled={!page.hasMore} onClick={() => setOffset(offset + 50)}>Next</Button></nav></>}
    <ControlledModal open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }} descriptor={{ title: selected === 'new' ? 'New taxonomy' : 'Edit taxonomy', size: 'md', trigger: origin,
      body: context => selected ? <TaxonomyForm client={client} term={selected === 'new' ? null : selected} candidates={[...new Map([...candidates, ...(page?.items ?? [])].map(term => [term.id, term])).values()]} moreTerms={moreTerms} signal={context.signal} setBusy={context.setBusy} setDirty={context.setDirty}
        accepted={() => { setVersion(value => value + 1); onChange(); context.accept(undefined); }} /> : null }} />
  </div>;
}
function TaxonomyForm({ client, term, candidates, moreTerms, signal, setBusy, setDirty, accepted }: { client: BlogClient; term: BlogTaxonomyTerm | null; candidates: readonly BlogTaxonomyTerm[]; moreTerms?: React.ReactNode; signal: AbortSignal; setBusy(value: boolean): void; setDirty(value: boolean): void; accepted(): void }) {
  const initial: BlogTermInput = term ? { kind: term.kind, name: term.name, slug: term.slug, description: term.description, parentId: term.parentId, seoTitle: term.seoTitle, seoDescription: term.seoDescription, noIndex: term.noIndex }
    : { kind: 'category', name: '', slug: '', description: '', parentId: null, seoTitle: null, seoDescription: null, noIndex: false };
  const [value, setValue] = React.useState(initial), [error, setError] = React.useState<string | null>(null), [busy, busyState] = React.useState(false), [uncertain, setUncertain] = React.useState(false);
  const attempt = React.useRef<{ id: string; input: BlogTermInput; action: 'save' | 'remove' } | null>(null);
  React.useEffect(() => { setDirty(uncertain || JSON.stringify(value) !== JSON.stringify(initial)); }, [value, uncertain, setDirty]);
  const write = async (action: 'save' | 'remove') => {
    if (busy || signal.aborted || attempt.current && attempt.current.action !== action) return;
    if (!attempt.current) attempt.current = { id: crypto.randomUUID(), input: structuredClone(value), action };
    const current = attempt.current; setBusy(true); busyState(true); setError(null);
    try {
      const options = { requestId: current.id, signal };
      if (action === 'remove') await client.taxonomies.remove(term!.id, term!.revision, options);
      else if (term) await client.taxonomies.update(term.id, term.revision, current.input, options);
      else await client.taxonomies.create(current.input, options);
      if (!signal.aborted) { attempt.current = null; setBusy(false); setDirty(false); accepted(); }
    } catch (failure) {
      if (signal.aborted) return;
      const status = (failure as { status?: number })?.status, code = (failure as { body?: { code?: string } })?.body?.code;
      const known = status && status >= 400 && status < 500 && code !== 'BLOG_OUTCOME_UNKNOWN';
      if (known) attempt.current = null;
      setUncertain(!known); setError(known ? 'The taxonomy was not accepted. Check its slug, ancestry, references and stored revision.' : 'The outcome is not confirmed. Retry repeats the original operation unchanged.');
    } finally { if (!signal.aborted) { setBusy(false); busyState(false); } }
  };
  const patch = (changes: Partial<BlogTermInput>) => setValue(previous => ({ ...previous, ...changes }));
  return <form onSubmit={event => { event.preventDefault(); void write('save'); }} className="zero-blog-settings-form">
    <fieldset disabled={busy || uncertain}><label>Type<Select value={value.kind} disabled={Boolean(term)} onValueChange={kind => patch({ kind: kind as 'category', parentId: null })}><SelectTrigger aria-label="Taxonomy type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="category">Category</SelectItem><SelectItem value="tag">Tag</SelectItem></SelectContent></Select></label>
      <label>Name<Input value={value.name} maxLength={160} onChange={event => patch({ name: event.target.value })} required /></label><label>Slug<Input value={value.slug} maxLength={120} onChange={event => patch({ slug: event.target.value })} required /></label>
      <label>Description<Textarea value={value.description} maxLength={2000} onChange={event => patch({ description: event.target.value })} /></label>
      {value.kind === 'category' && <><label>Parent category<Select value={value.parentId ?? 'none'} onValueChange={parent => patch({ parentId: parent === 'none' ? null : parent })}><SelectTrigger aria-label="Parent category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No parent</SelectItem>{value.parentId && !candidates.some(candidate => candidate.id === value.parentId) && <SelectItem value={value.parentId}>Current parent (outside loaded directory)</SelectItem>}{candidates.filter(candidate => candidate.kind === 'category' && candidate.id !== term?.id).map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent></Select></label>{moreTerms}</>}
      <details><summary>Search metadata</summary><label>SEO title<Input value={value.seoTitle ?? ''} onChange={event => patch({ seoTitle: event.target.value || null })} /></label><label>SEO description<Textarea value={value.seoDescription ?? ''} onChange={event => patch({ seoDescription: event.target.value || null })} /></label><label className="zero-blog-check"><input type="checkbox" checked={value.noIndex} onChange={event => patch({ noIndex: event.target.checked })} />Noindex</label></details>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="zero-blog-format-tools"><Button type="submit" disabled={busy || attempt.current?.action === 'remove'}>{uncertain ? 'Retry original save' : busy ? 'Saving…' : 'Save taxonomy'}</Button>
      {term && <Button type="button" variant="ghost" disabled={busy || Boolean(attempt.current && attempt.current.action !== 'remove')} onClick={async event => {
        if (uncertain || await modals.confirm({ title: 'Remove this taxonomy?', description: 'A referenced taxonomy cannot be removed. Existing post references are never silently cleared.', confirmLabel: 'Remove taxonomy', variant: 'destructive', trigger: event.currentTarget })) void write('remove');
      }}>{uncertain && attempt.current?.action === 'remove' ? 'Retry original removal' : 'Remove'}</Button>}
    </div>
  </form>;
}
