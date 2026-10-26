'use client';

/** Self-wired publishing organism. Existing AppProvider/Guardian choose authority; DataTable owns query presentation and native facades own persistence. */
import * as React from 'react';
import { Plus } from 'lucide-react';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { Client } from '../../frontend/client/sdk';
import type { BlogLiveSnapshot } from '../../blog/client-contracts';
import type { BlogPostContent, BlogPostQuery, BlogPostRecord, BlogPublishingCapabilities, BlogTaxonomyTerm } from '../../blog/content-types';
import type { BlogAuthorRecord } from '../../blog/types';
import { DataTable } from '../data-table';
import type { DataTableServerSource } from '../data-table/data-table-server-types';
import type { DataTableState } from '../data-table/data-table-state';
import { defineSchema, field } from '../../schema';
import { Button } from '../ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { ModalManager } from '../../modals/modal-manager';
import { useModalHostPresent } from '../../modals/modal-host-context';
import { BlogPostEditor } from './blog-post-editor';
import { BlogAuthorsPanel } from './blog-authors-panel';
import { BlogTaxonomiesPanel } from './blog-taxonomies-panel';
import { BlogMetricsPanel } from './blog-metrics-panel';
import type { BlogInlineInputProps } from './blog-inline-input';

const schema = defineSchema({ title: field.text({ label: 'Article' }), status: field.text({ label: 'Status' }), author: field.text({ label: 'Author' }), updated: field.text({ label: 'Updated' }), changes: field.text({ label: 'Publication' }) });
type PostRow = { id: string; title: string; status: string; author: string; updated: string; changes: string };
export interface BlogWorkspaceProps { className?: string; autoSave?: false | number; renderSelectionMenu?: BlogInlineInputProps['renderSelectionMenu'] }
/** Place inside the existing protected AppShell. The workspace never creates another auth client or replaces app tokens. */
export function BlogWorkspace(props: BlogWorkspaceProps) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client), hosted = useModalHostPresent();
  if (!client || !boundary.ready || !boundary.stable) return <p role="status">Publishing requires a ready authenticated AppProvider.</p>;
  const content = <PublishingWorkspace key={boundary.key} {...props} client={client} boundaryKey={boundary.key} />;
  return hosted ? content : <ModalManager>{content}</ModalManager>;
}
function PublishingWorkspace({ client, boundaryKey, className = '', autoSave, renderSelectionMenu }: BlogWorkspaceProps & { client: Client; boundaryKey: string }) {
  const [snapshot, setSnapshot] = React.useState<BlogLiveSnapshot | null>(null), [capabilities, setCapabilities] = React.useState<BlogPublishingCapabilities | null>(null);
  const [terms, setTerms] = React.useState<readonly BlogTaxonomyTerm[]>([]), [tab, setTab] = React.useState<'posts' | 'authors' | 'taxonomies' | 'metrics'>('posts');
  const [selected, setSelected] = React.useState<BlogPostRecord | 'new' | null>(null), [error, setError] = React.useState<string | null>(null), [ready, setReady] = React.useState(false), [version, setVersion] = React.useState(0);
  const [extraAuthors, setExtraAuthors] = React.useState<readonly BlogAuthorRecord[]>([]), [authorCursor, setAuthorCursor] = React.useState<string | null | undefined>();
  const [termOffset, setTermOffset] = React.useState<number | null>(null), [loadingDirectory, setLoadingDirectory] = React.useState<'authors' | 'terms' | null>(null);
  const lifetime = React.useRef(new AbortController());
  React.useEffect(() => { if (lifetime.current.signal.aborted) lifetime.current = new AbortController(); const owned = lifetime.current; return () => owned.abort(); }, []);
  React.useEffect(() => {
    const owner = new AbortController();
    setExtraAuthors([]); setAuthorCursor(undefined);
    void client.blog.posts.capabilities().then(value => { if (!owner.signal.aborted) setCapabilities(value); }).catch(() => { if (!owner.signal.aborted) setError('Publishing capabilities could not be loaded.'); });
    const stop = client.blog.watch(value => { if (!owner.signal.aborted) { setSnapshot(value); setReady(true); } }, { signal: owner.signal, onError: () => { if (!owner.signal.aborted) setReady(false); } });
    const load = async () => {
      const page = await client.blog.taxonomies.list({ limit: 100 }, { signal: owner.signal });
      if (!owner.signal.aborted) { setTerms(page.items); setTermOffset(page.hasMore ? page.offset + page.items.length : null); }
    };
    void load().catch(() => { if (!owner.signal.aborted) setError('Taxonomy choices could not be loaded.'); });
    return () => { owner.abort(); stop(); };
  }, [client, version]);
  const authors = [...new Map([...extraAuthors, ...(snapshot?.authors?.items ?? []), ...(snapshot?.capabilities.self ? [snapshot.capabilities.self] : [])].map(author => [author.id, author])).values()];
  const nextAuthor = authorCursor === undefined ? snapshot?.authors?.nextCursor : authorCursor;
  const directoryGeneration = React.useRef(version); directoryGeneration.current = version;
  const loadDirectory = async (kind: 'authors' | 'terms') => {
    if (loadingDirectory) return;
    const generation = version, signal = lifetime.current.signal; setLoadingDirectory(kind); setError(null);
    try {
      if (kind === 'authors' && nextAuthor) {
        const page = await client.blog.authors.list({ limit: 100, after: nextAuthor }, { signal });
        if (!signal.aborted && generation === directoryGeneration.current) { setExtraAuthors(previous => [...previous, ...page.items]); setAuthorCursor(page.nextCursor); }
      } else if (kind === 'terms' && termOffset !== null) {
        const page = await client.blog.taxonomies.list({ limit: 100, offset: termOffset }, { signal });
        if (!signal.aborted && generation === directoryGeneration.current) { setTerms(previous => [...new Map([...previous, ...page.items].map(term => [term.id, term])).values()]); setTermOffset(page.hasMore ? page.offset + page.items.length : null); }
      }
    } catch { if (!signal.aborted && generation === directoryGeneration.current) setError('More directory choices could not be loaded. Retry without changing your draft.'); }
    finally { if (!signal.aborted) setLoadingDirectory(null); }
  };
  const moreAuthors = nextAuthor ? <Button type="button" variant="ghost" disabled={Boolean(loadingDirectory)} onClick={() => { void loadDirectory('authors'); }}>{loadingDirectory === 'authors' ? 'Loading authors…' : 'Load more authors'}</Button> : null;
  const moreTerms = termOffset !== null ? <Button type="button" variant="ghost" disabled={Boolean(loadingDirectory)} onClick={() => { void loadDirectory('terms'); }}>{loadingDirectory === 'terms' ? 'Loading categories and tags…' : 'Load more categories and tags'}</Button> : null;
  const open = async (id: string) => {
    try { const post = await client.blog.posts.get(id, { signal: lifetime.current.signal }); if (!lifetime.current.signal.aborted) setSelected(post); }
    catch { if (!lifetime.current.signal.aborted) setError('The article could not be opened under the current permissions.'); }
  };
  if (!ready || !snapshot || !capabilities) return <section className="zero-blog" role="status">{error ?? 'Verifying publishing access…'}</section>;
  if (snapshot.capabilities.state !== 'ready') return <section className="zero-blog" role="status">Blogging is disabled or requires its reviewed migration.</section>;
  if (selected) {
    const initial = selected === 'new' ? newPost(authors.find(author => author.status === 'active')?.id ?? '') : selected.content;
    return <BlogPostEditor key={selected === 'new' ? 'new' : selected.id} client={client.blog} boundaryKey={boundaryKey} initial={initial} record={selected === 'new' ? null : selected} authors={authors} terms={terms}
      moreAuthors={moreAuthors} moreTerms={moreTerms} directoryError={error} canPublish={capabilities.canPublishOwn} autoSave={autoSave} renderSelectionMenu={renderSelectionMenu} onBack={() => { setSelected(null); setVersion(value => value + 1); }} />;
  }
  return <section className={`zero-blog zero-blog-workspace ${className}`} aria-label="Blog publishing">
    <header className="zero-blog-workspace-toolbar"><div><h2>{snapshot.capabilities.site?.name ?? 'Blog publishing'}</h2><p className="zero-blog-muted">Draft privately. Publish an accepted revision. Keep every previous revision.</p></div>
      {capabilities.canCreate && <Button type="button" disabled={!authors.some(author => author.status === 'active')} onClick={() => setSelected('new')}><Plus />New article</Button>}</header>
    <nav className="zero-blog-workspace-tabs" aria-label="Publishing sections">{(['posts', 'authors', 'metrics', ...(capabilities.canManage ? ['taxonomies'] : [])] as const).map(value => <Button key={value} type="button" variant={tab === value ? 'secondary' : 'ghost'} aria-pressed={tab === value} onClick={() => setTab(value as typeof tab)}>{value === 'posts' ? 'Articles' : value === 'authors' ? 'Authors and profiles' : value === 'metrics' ? 'Observations' : 'Categories and tags'}</Button>)}</nav>
    {error && <p role="alert">{error}</p>}
    {!authors.some(author => author.status === 'active') && <div className="zero-blog-editor-notice"><p>No active author is in the loaded directory. Load more authors or ask an administrator to enroll an existing user. Complete and explicitly publish the public byline before publishing an article.</p>{moreAuthors}</div>}
    {tab === 'posts' && <PostsTable client={client} authors={authors} onOpen={id => { void open(id); }} />}
    {tab === 'authors' && <BlogAuthorsPanel client={client} capabilities={snapshot.capabilities} authors={authors} moreAuthors={moreAuthors} onRefresh={() => setVersion(value => value + 1)} />}
    {tab === 'taxonomies' && <BlogTaxonomiesPanel client={client.blog} candidates={terms} moreTerms={moreTerms} onChange={() => setVersion(value => value + 1)} />}
    {tab === 'metrics' && <BlogMetricsPanel client={client.blog} />}
  </section>;
}
function PostsTable({ client, authors, onOpen }: { client: Client; authors: readonly BlogAuthorRecord[]; onOpen(id: string): void }) {
  const [status, setStatus] = React.useState('all'), [revision, setRevision] = React.useState(0), [readable, setReadable] = React.useState(true);
  const [tableState, setTableState] = React.useState<Partial<DataTableState>>({ pagination: { pageIndex: 0, pageSize: 20 }, globalFilter: '' });
  const currentAuthors = React.useRef(authors); currentAuthors.current = authors;
  const authorNames = JSON.stringify(authors.map(author => [author.id, author.profile.displayName]));
  React.useEffect(() => { setRevision(value => value + 1); }, [authorNames]);
  const criteria: BlogPostQuery = { ...(status === 'all' ? {} : { status: status as BlogPostQuery['status'] }), search: tableState.globalFilter || undefined,
    limit: tableState.pagination?.pageSize ?? 20, offset: (tableState.pagination?.pageIndex ?? 0) * (tableState.pagination?.pageSize ?? 20) };
  const key = JSON.stringify(criteria);
  React.useEffect(() => { const owner = new AbortController(); let previous = '';
    const stop = client.blog.watchPosts(page => { if (owner.signal.aborted) return; setReadable(true); const next = JSON.stringify(page); if (previous && next !== previous) setRevision(value => value + 1); previous = next; },
      { query: criteria, signal: owner.signal, onError: () => { if (!owner.signal.aborted) setReadable(false); } });
    return () => { owner.abort(); stop(); };
  }, [client, key]);
  const source = React.useMemo<DataTableServerSource<PostRow>>(() => ({ type: 'server', table: 'zero_blog_publishing_projection', live: false, prefetch: false, getRowId: row => row.id,
    adapter: { query: async (query, { signal }) => {
      const page = await client.blog.posts.list({ ...(status === 'all' ? {} : { status: status as BlogPostQuery['status'] }), search: query.search || undefined,
        limit: query.pagination.pageSize, offset: query.pagination.pageIndex * query.pagination.pageSize }, { signal });
      return { rows: page.items.map(post => ({ id: post.id, title: post.title, status: post.status, author: currentAuthors.current.find(author => author.id === post.authorId)?.profile.displayName ?? 'Author',
        updated: new Date(post.updatedAt).toLocaleString(), changes: post.status === 'published' ? post.hasUnpublishedChanges ? 'Unpublished changes' : 'Public revision is current' : 'Private' })), page: { mode: 'offset', offset: page.offset, total: page.total, hasMore: page.hasMore } };
    } } }), [client, status]);
  return <><div className="zero-blog-workspace-toolbar"><Select value={status} onValueChange={value => { setStatus(value); setTableState(previous => ({ ...previous, pagination: { pageIndex: 0, pageSize: previous.pagination?.pageSize ?? 20 } })); }}><SelectTrigger aria-label="Article status"><SelectValue /></SelectTrigger><SelectContent>{['all', 'draft', 'published', 'withdrawn', 'trashed'].map(value => <SelectItem key={value} value={value}>{value === 'all' ? 'All statuses' : value}</SelectItem>)}</SelectContent></Select></div>
    {readable ? <DataTable schema={schema} source={source} refreshKey={revision} primaryKey="id" columns={schema.fieldNames as string[]} searchable sortable={false} filterable={false} paginated={{ pageSize: 20 }} state={tableState} onStateChange={value => setTableState(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value)}
      showExport={false} cellMotion={false} onRowClick={row => onOpen(row.id)} emptyState={<div className="zero-blog-empty">No articles match. Start a draft or adjust the search.</div>} /> : <p role="status">Article access is being revalidated. Retained rows remain hidden until a fresh authorized snapshot succeeds.</p>}
  </>;
}
function newPost(authorId: string): BlogPostContent {
  return { title: '', slug: '', excerpt: '', authorId, featuredImage: null, categoryIds: [], tagIds: [], seo: { title: null, description: null, noIndex: false, socialImage: null },
    document: { version: 1, blocks: [{ id: 'b_' + crypto.randomUUID(), type: 'paragraph', content: [] }] } };
}
