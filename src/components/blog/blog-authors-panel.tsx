'use client';

/** Existing Guardian identities become explicit blog authors. Public byline data and avatar opt-in remain separate from private account profiles. */
import * as React from 'react';
import type { Client } from '../../frontend/client/sdk';
import type { BlogAuthorRecord, BlogCapabilities, BlogAuthorProfile } from '../../blog/types';
import { DataTable } from '../data-table';
import { defineSchema, field } from '../../schema';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { ControlledModal } from '../../modals/modal-controlled';
import { modals } from '../../modals';

const schema = defineSchema({ name: field.text({ label: 'Public name' }), status: field.text({ label: 'Author status' }), publication: field.text({ label: 'Public profile' }) });
export function BlogAuthorsPanel({ client, capabilities, authors, onRefresh, moreAuthors }: { client: Client; capabilities: BlogCapabilities; authors: readonly BlogAuthorRecord[]; onRefresh(): void; moreAuthors?: React.ReactNode }) {
  const [selected, setSelected] = React.useState<BlogAuthorRecord | null>(null), [userId, setUserId] = React.useState(''), [error, setError] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false);
  const [search, setSearch] = React.useState(''), [candidates, setCandidates] = React.useState<readonly { id: string; name: string }[]>([]);
  React.useEffect(() => { if (!capabilities.canManageAuthors || !search.trim()) { setCandidates([]); return; }
    let active = true;
    const timer = setTimeout(() => { void client.listAuthAdminUsers({ search, status: 'active', limit: 20 }).then(result => {
      if (active) setCandidates(result.users.map(user => ({ id: user.userId, name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username })));
    }).catch(() => { if (active) setCandidates([]); }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [client, capabilities.canManageAuthors, search]);
  const enroll = async () => {
    if (busy || !userId) return; setBusy(true); setError(null);
    try { const existing = authors.find(author => author.userId === userId); await client.blog.authors.assign({ userId, expectedRevision: existing?.revision ?? 0, status: 'active' }); onRefresh(); }
    catch { setError('Author enrollment was not confirmed. Refresh the directory to inspect the existing record before repeating the action.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Authors and public bylines">
    {capabilities.canManageAuthors && <div className="zero-blog-editor-notice"><h3>Enroll an existing user</h3><label>Find an account<Input value={search} placeholder="Search existing users…" onChange={event => setSearch(event.target.value)} /></label>
      {!!candidates.length && <Select value={userId} onValueChange={setUserId}><SelectTrigger aria-label="Existing user"><SelectValue placeholder="Choose an account" /></SelectTrigger><SelectContent>{candidates.map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent></Select>}
      <details><summary>Use a known user ID or a custom Guardian directory</summary><label>Existing Guardian user ID<Input value={userId} onChange={event => setUserId(event.target.value)} /></label><p className="zero-blog-muted">Search uses the existing administrator directory permission. Custom author managers can supply a known identity without receiving platform-wide user-list access.</p></details>
      <Button type="button" disabled={busy || !userId} onClick={() => { void enroll(); }}>{busy ? 'Enrolling…' : 'Enroll author'}</Button></div>}
    {error && <p role="alert">{error}</p>}
    <DataTable schema={schema} data={authors.map(author => ({ id: author.id, name: author.profile.displayName || 'Profile not completed', status: author.status, publication: author.published && author.status === 'active' ? 'Published byline' : author.status !== 'active' ? 'Not publicly available' : author.readiness.ready ? 'Ready to publish' : 'Missing ' + author.readiness.missing.join(', '), author }))} primaryKey="id" columns={schema.fieldNames as string[]} searchable={false} sortable={false} showExport={false}
      onRowClick={row => setSelected(row.author)} />
    {moreAuthors}
    <ControlledModal open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }} descriptor={{ title: 'Public author profile', size: 'lg',
      body: context => selected?.userId ? <AuthorProfileForm key={selected.id} client={client} record={selected} manage={capabilities.canManageAuthors} signal={context.signal} setBusy={context.setBusy} setDirty={context.setDirty} updated={record => { setSelected(record); onRefresh(); }} /> : null }} />
    {capabilities.requirements.avatar && <p className="zero-blog-muted">A photo must be uploaded and explicitly approved for public access in the native account Profile settings before a byline can be published. Private account photos are never reused silently.</p>}
  </section>;
}
function AuthorProfileForm({ client, record, manage, signal, setBusy, setDirty, updated }: { client: Client; record: BlogAuthorRecord; manage: boolean; signal: AbortSignal; setBusy(value: boolean): void; setDirty(value: boolean): void; updated(record: BlogAuthorRecord): void }) {
  const [stored, setStored] = React.useState(record), [profile, setProfile] = React.useState<BlogAuthorProfile>(record.profile), [busy, busyState] = React.useState(false), [error, setError] = React.useState<string | null>(null), [uncertain, setUncertain] = React.useState(false);
  const dirty = JSON.stringify(profile) !== JSON.stringify(stored.profile);
  React.useEffect(() => { setDirty(dirty || uncertain); }, [dirty, uncertain, setDirty]);
  const write = async (action: 'save' | 'publish' | 'withdraw' | 'suspend' | 'revoke') => {
    if (busy || uncertain || signal.aborted) return; setBusy(true); busyState(true); setError(null);
    try {
      const id = stored.userId!, options = { signal };
      const result = action === 'save' ? await client.blog.authors.updateProfile(id, { expectedRevision: stored.revision, changes: profile }, options)
        : action === 'publish' ? await client.blog.authors.publishProfile(id, stored.revision, options)
          : action === 'withdraw' ? await client.blog.authors.withdrawProfile(id, stored.revision, options)
            : await client.blog.authors.assign({ userId: id, expectedRevision: stored.revision, status: action === 'suspend' ? 'suspended' : 'revoked' }, options);
      if (!signal.aborted) { setStored(result); setProfile(result.profile); setDirty(false); updated(result); }
    } catch (failure) { if (!signal.aborted) { const status = (failure as { status?: number })?.status;
      setUncertain(!status || status >= 500); setError(status === 409 ? 'This profile changed elsewhere. Your local edits are preserved; reload to compare the current stored state.' : 'The profile change was not confirmed. Inspect the current stored profile before another operation.'); } }
    finally { if (!signal.aborted) { setBusy(false); busyState(false); } }
  };
  const patch = (changes: Partial<BlogAuthorProfile>) => setProfile(value => ({ ...value, ...changes }));
  const reload = async () => {
    if (dirty && !await modals.confirm({ title: 'Reload the stored public profile?', description: 'Unsaved local profile edits will be replaced. This does not publish anything.', confirmLabel: 'Reload profile', variant: 'destructive' })) return;
    try { const current = await client.blog.authors.get(stored.userId!, { signal }); if (!signal.aborted) { setStored(current); setProfile(current.profile); setUncertain(false); setError(null); updated(current); } }
    catch { if (!signal.aborted) setError('The current profile could not be inspected.'); }
  };
  return <form className="zero-blog-settings-form" onSubmit={event => { event.preventDefault(); void write('save'); }}><fieldset disabled={busy || uncertain || stored.status !== 'active'}>
    <label>Public display name<Input value={profile.displayName} maxLength={120} required onChange={event => patch({ displayName: event.target.value })} /></label>
    <label>Author slug<Input value={profile.slug} maxLength={100} required onChange={event => patch({ slug: event.target.value })} /></label>
    <label>Byline<Input value={profile.byline ?? ''} maxLength={200} onChange={event => patch({ byline: event.target.value || null })} /></label>
    <label>Biography<Textarea value={profile.bio ?? ''} maxLength={2000} onChange={event => patch({ bio: event.target.value || null })} /></label>
    <label>Website<Input value={profile.website ?? ''} type="url" onChange={event => patch({ website: event.target.value || null })} /></label>
    <label className="zero-blog-check"><input type="checkbox" checked={profile.avatar === 'account'} onChange={event => patch({ avatar: event.target.checked ? 'account' : null })} />Use this author's explicitly published account photo</label>
    <fieldset><legend>Public social links</legend>{profile.socialLinks.map((link, index) => <div key={index} className="zero-blog-social-link-fields"><label>Label<Input value={link.label} onChange={event => patch({ socialLinks: profile.socialLinks.map((value, i) => i === index ? { ...value, label: event.target.value } : value) })} /></label><label>URL<Input type="url" value={link.url} onChange={event => patch({ socialLinks: profile.socialLinks.map((value, i) => i === index ? { ...value, url: event.target.value } : value) })} /></label><Button type="button" variant="ghost" onClick={() => patch({ socialLinks: profile.socialLinks.filter((_, i) => i !== index) })}>Remove link</Button></div>)}
      <Button type="button" variant="outline" disabled={profile.socialLinks.length >= 12} onClick={() => patch({ socialLinks: [...profile.socialLinks, { label: '', url: '' }] })}>Add social link</Button></fieldset>
  </fieldset>{error && <p role="alert">{error}</p>}<div className="zero-blog-format-tools"><Button type="submit" disabled={busy || uncertain || !dirty}>Save profile draft</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { void reload(); }}>Inspect stored profile</Button>
    <Button type="button" disabled={busy || uncertain || dirty || !stored.readiness.ready || stored.status !== 'active'} onClick={() => { void write('publish'); }}>Publish public byline</Button>
    {stored.published && <Button type="button" variant="outline" disabled={busy || uncertain || dirty} onClick={() => { void write('withdraw'); }}>Withdraw public byline</Button>}
    {manage && <Button type="button" variant="ghost" disabled={busy || uncertain || dirty} onClick={async event => { if (await modals.confirm({ title: 'Suspend this author?', description: 'Author permissions and the current public byline are withdrawn. This does not delete the Guardian account or rewrite already published article history.', confirmLabel: 'Suspend author', variant: 'destructive', trigger: event.currentTarget })) void write('suspend'); }}>Suspend author</Button>}
  </div></form>;
}
