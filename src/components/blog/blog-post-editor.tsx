'use client';

/** Acknowledged native publishing workspace for one article. Reuses Zero save/leave guards, media, rich blocks and owned dialogs. */
import * as React from 'react';
import { ArrowLeft, History, Eye, Save, Send } from 'lucide-react';
import type { BlogClient } from '../../blog/client-contracts';
import type { BlogAuthorRecord } from '../../blog/types';
import type { BlogPostContent, BlogPostRecord, BlogTaxonomyTerm, BlogPage, BlogRevisionRecord } from '../../blog/content-types';
import { BlogDraftController } from './blog-draft-controller';
import { BlogPostFields } from './blog-post-fields';
import type { BlogInlineInputProps } from './blog-inline-input';
import { useFormSave, UnsavedChangesDialog, FormSaveBar } from '../form-save';
import { Button } from '../ui/button';
import { modals } from '../../modals';
import { ControlledModal } from '../../modals/modal-controlled';
import { BlogPostPage } from './blog-layouts';
import { BlogProvider } from './blog-provider';
import { presentBlogDocument } from '../../blog/presentation';
import { BlogPrivateImage } from './blog-media-picker';
import { BlockRenderer } from './blog-blocks';

export interface BlogPostEditorProps {
  client: BlogClient;
  initial: BlogPostContent;
  record?: BlogPostRecord | null;
  authors: readonly BlogAuthorRecord[];
  terms: readonly BlogTaxonomyTerm[];
  moreAuthors?: React.ReactNode;
  moreTerms?: React.ReactNode;
  directoryError?: string | null;
  canPublish: boolean;
  /** Immutable incarnation of the authenticated target. Workspace keys the editor to this value. */
  boundaryKey: string;
  onBack(): void;
  /** Optional draft-only save delay; false (default) keeps persistence explicitly user initiated. */
  autoSave?: false | number;
  renderSelectionMenu?: BlogInlineInputProps['renderSelectionMenu'];
}
/** Publication always uses an accepted clean stored revision, never the browser's current unsaved body. */
export function BlogPostEditor({ client, initial, record = null, authors, terms, moreAuthors, moreTerms, directoryError, canPublish, boundaryKey, onBack, autoSave = false, renderSelectionMenu }: BlogPostEditorProps) {
  const [draft] = React.useState(() => new BlogDraftController(client.posts, initial, record));
  const state = React.useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const [preview, setPreview] = React.useState(false), [history, setHistory] = React.useState(false), [message, setMessage] = React.useState<string | null>(null);
  const [readable, setReadable] = React.useState(true);
  const alive = React.useRef(true), current = React.useRef(state); current.current = state;
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; queueMicrotask(() => { if (!alive.current) draft.close(); }); }; }, [draft]);
  const save = useFormSave({ scopeKey: boundaryKey, form: { boundaryKey, isDirty: state.dirty || state.uncertain, isSubmitting: state.busy, submitError: state.error,
    submit: () => state.uncertain ? draft.retry() : draft.save(), reset: () => draft.reset() } });
  React.useEffect(() => {
    if (!state.record) return;
    const owner = new AbortController();
    // The authorized projection is a hint. Read this exact post; never infer an edit from another row's change.
    const stop = client.watchPost(state.record.id, post => { if (!owner.signal.aborted) { draft.incoming(post); setReadable(true); } },
      { signal: owner.signal, onError: () => { if (!owner.signal.aborted) setReadable(false); } });
    return () => { owner.abort(); stop(); };
  }, [client, draft, state.record?.id]);
  React.useEffect(() => {
    if (autoSave === false || !state.dirty || state.busy || state.uncertain || state.conflict) return;
    const timer = setTimeout(() => { void save.save(); }, Math.max(500, Math.min(60000, autoSave)));
    return () => clearTimeout(timer);
  }, [autoSave, state.content, state.dirty, state.busy, state.uncertain, state.conflict, save.save]);
  const action = async (kind: 'publish' | 'withdraw' | 'trash', trigger: Element) => {
    if (!state.record || state.busy || state.uncertain || state.dirty) return;
    if (!await modals.confirm({ title: kind === 'publish' ? 'Publish this article?' : kind === 'withdraw' ? 'Withdraw this article?' : 'Move this draft to trash?',
      description: kind === 'publish' ? 'The accepted stored revision becomes public. Later edits remain private until you publish again.' : kind === 'withdraw' ? 'The public article and its publication-bound media stop being delivered. Drafts and revision history remain.' : 'The draft and its immutable history are retained. Published articles must be withdrawn first.',
      confirmLabel: kind === 'publish' ? 'Publish article' : kind === 'withdraw' ? 'Withdraw article' : 'Move to trash', variant: kind === 'publish' ? undefined : 'destructive', trigger })) return;
    if (!alive.current || current.current !== state) return;
    const result = await draft.act(kind);
    if (alive.current && result.kind === 'accepted') setMessage(kind === 'publish' ? 'Article published.' : kind === 'withdraw' ? 'Article withdrawn.' : 'Draft moved to trash.');
  };
  const reload = async (trigger: Element) => {
    if (!state.record || state.busy || state.uncertain) return;
    if (state.dirty && !await modals.confirm({ title: 'Discard this local draft and reload?', description: 'Your unsaved local changes will be replaced by the currently stored revision.', confirmLabel: 'Discard and reload', variant: 'destructive', trigger })) return;
    if (!alive.current || current.current !== state) return;
    try { const stored = await client.posts.get(state.record.id); if (alive.current) { draft.reload(stored); setMessage('Current stored revision loaded.'); } }
    catch { if (alive.current) setMessage('The current article could not be reloaded. Your draft is preserved.'); }
  };
  if (!readable) return <section className="zero-blog zero-blog-editor" role="status">Article access is being revalidated. Your local draft is retained, but its contents and actions stay hidden until a current authorized read succeeds.</section>;
  return <div className="zero-blog zero-blog-editor" aria-label="Article editor">
    <header className="zero-blog-workspace-toolbar"><Button type="button" variant="ghost" onClick={() => { void save.requestLeave(onBack); }}><ArrowLeft />All articles</Button>
      <span role="status">{state.busy ? 'Waiting for acknowledgment…' : state.uncertain ? 'Outcome needs reconciliation' : state.conflict ? 'Revision conflict' : state.dirty ? 'Unsaved draft' : state.record ? `Saved · revision ${state.record.revision} · ${state.record.status}` : 'New article'}</span>
      <div className="zero-blog-format-tools"><Button type="button" variant="outline" disabled={state.busy} onClick={() => setPreview(true)}><Eye />Preview</Button>
        <Button type="button" variant="outline" disabled={!state.record || state.busy} onClick={() => setHistory(true)}><History />History</Button>
        <Button type="button" variant="outline" disabled={state.busy || state.conflict} onClick={() => { void save.save(); }}><Save />{state.uncertain ? 'Retry original operation' : 'Save draft'}</Button>
        {canPublish && <Button type="button" disabled={!state.record || state.busy || state.dirty || state.uncertain || state.conflict || state.record.status === 'trashed'} onClick={event => { void action('publish', event.currentTarget); }}><Send />{state.record?.publicRevision ? 'Publish changes' : 'Publish'}</Button>}
      </div>
    </header>
    {(state.error || message) && <p role={state.error ? 'alert' : 'status'} className="zero-blog-editor-notice">{state.error ?? message}</p>}
    {(state.incomingRevision || state.conflict) && <div className="zero-blog-editor-notice"><p>A newer stored revision is available. Your local text has not been overwritten.</p><Button type="button" disabled={state.busy || state.uncertain} onClick={event => { void reload(event.currentTarget); }}>Reload stored revision</Button></div>}
    {directoryError && <p role="alert">{directoryError}</p>}
    <BlogPostFields value={state.content} onChange={content => draft.setContent(content)} authors={authors} terms={terms} moreAuthors={moreAuthors} moreTerms={moreTerms} media={client.media} disabled={state.busy || state.uncertain || state.record?.status === 'trashed'} renderSelectionMenu={renderSelectionMenu} />
    {state.record && <footer className="zero-blog-workspace-toolbar">{state.record.status === 'published' && canPublish && <Button type="button" variant="outline" disabled={state.busy || state.dirty || state.uncertain} onClick={event => { void action('withdraw', event.currentTarget); }}>Withdraw publication</Button>}
      {state.record.status !== 'published' && state.record.status !== 'trashed' && <Button type="button" variant="ghost" disabled={state.busy || state.dirty || state.uncertain} onClick={event => { void action('trash', event.currentTarget); }}>Move draft to trash</Button>}
    </footer>}
    <FormSaveBar controller={save} saveLabel={state.uncertain ? 'Retry original operation' : 'Save draft'} placement="inline" /><UnsavedChangesDialog controller={save} />
    <ControlledModal open={preview} onOpenChange={setPreview} descriptor={{ title: 'Private article preview', size: 'full', body: <PrivatePreview content={state.content} client={client} authorName={authors.find(author => author.id === state.content.authorId)?.profile.displayName} /> }} />
    <ControlledModal open={history} onOpenChange={setHistory} descriptor={{ title: 'Article revision history', size: 'lg', body: context => state.record ? <RevisionHistory client={client} id={state.record.id} signal={context.signal} disabled={state.dirty || state.busy || state.uncertain}
      restore={async revision => { const result = await draft.act('restore', revision); if (result.kind === 'accepted') context.accept(undefined); }} /> : null }} />
  </div>;
}
function PrivatePreview({ content, client, authorName }: { content: BlogPostContent; client: BlogClient; authorName?: string }) {
  const blocks = presentBlogDocument(content.document, () => '');
  return <BlogProvider><BlogPostPage post={{ id: 'private-preview', title: content.title, slug: content.slug, excerpt: content.excerpt, author: authorName ? { id: content.authorId, name: authorName } : undefined,
    toc: content.document.blocks.filter(block => block.type === 'heading').map(block => ({ id: block.id, level: block.level, text: block.content.map(run => run.text).join('') })) }}
    showFloatingShare={false} content={<>{content.featuredImage && <BlogPrivateImage api={client.media} id={content.featuredImage.mediaId} alt={content.featuredImage.alt} />}{blocks.map((block, index) => {
      const original = content.document.blocks[index]!;
      if (original.type === 'image') return <BlogPrivateImage key={original.id} api={client.media} id={original.image.mediaId} alt={original.image.alt} />;
      if (original.type === 'gallery') return <div key={original.id} className="zero-blog-private-gallery">{original.images.map((image, i) => <BlogPrivateImage key={i} api={client.media} id={image.mediaId} alt={image.alt} />)}</div>;
      if (original.type === 'audio' || original.type === 'video') return <p key={original.id}>{original.type}: {original.title} (private playback is available after publication)</p>;
      return <BlockRenderer key={original.id} blocks={[block]} />;
    })}</>} /></BlogProvider>;
}
function RevisionHistory({ client, id, signal, restore, disabled }: { client: BlogClient; id: string; signal: AbortSignal; restore(revision: number): Promise<void>; disabled: boolean }) {
  const [page, setPage] = React.useState<BlogPage<BlogRevisionRecord> | null>(null), [offsets, setOffsets] = React.useState([0]), [error, setError] = React.useState(false), [busy, setBusy] = React.useState(false);
  const offset = offsets.at(-1)!;
  React.useEffect(() => { const owner = new AbortController(), combined = AbortSignal.any([signal, owner.signal]); setPage(null); setError(false);
    void client.posts.revisions(id, { limit: 10, offset }, { signal: combined }).then(value => { if (!combined.aborted) setPage(value); }).catch(() => { if (!combined.aborted) setError(true); });
    return () => owner.abort(); }, [client, id, offset, signal]);
  return <div className="zero-blog-revision-history">{disabled && <p>Save or reconcile the current draft before restoring a revision.</p>}{error && <p role="alert">History could not be loaded.</p>}{!page && !error && <p role="status">Loading immutable revisions…</p>}
    {page?.items.map(item => <section key={item.id}><div><strong>Revision {item.revision} · {item.action}</strong><p>{item.content.title}</p><time>{new Date(item.createdAt).toLocaleString()}</time></div><Button type="button" variant="outline" disabled={disabled || busy} onClick={async event => {
      if (!await modals.confirm({ title: 'Restore this revision as a draft?', description: 'This creates a new revision; it does not change the current public article.', confirmLabel: 'Restore as draft', trigger: event.currentTarget })) return;
      if (signal.aborted) return; setBusy(true); try { await restore(item.revision); } finally { if (!signal.aborted) setBusy(false); }
    }}>Restore draft</Button></section>)}
    <nav aria-label="Revision pages"><Button type="button" variant="ghost" disabled={offsets.length < 2 || busy || !page} onClick={() => setOffsets(previous => previous.slice(0, -1))}>Newer</Button><Button type="button" variant="ghost" disabled={!page?.hasMore || !page.items.length || busy} onClick={() => setOffsets(previous => [...previous, offset + page!.items.length])}>Older</Button></nav>
  </div>;
}
