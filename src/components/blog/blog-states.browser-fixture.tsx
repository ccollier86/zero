/** Synthetic presentation/recovery controls only; the remote search uses the real public facade over loopback HTTP. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BlogProvider } from './blog-provider';
import { BlogListPage } from './blog-layouts';
import { SearchWithResults } from './blog-search-results';
import { BlogSearchPalette } from './blog-search';
import { useBlogPublicSearch } from './use-blog-public-search';
import { ModalManager } from '../../modals/modal-manager';
import type { BlogPost } from './blog.types';

const posts: BlogPost[] = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, slug: `story-${index}`, title: `Considered story ${index + 1}`,
  excerpt: 'A useful story with thoughtful details, ready to read.', featuredImage: index % 2 ? undefined : '/cover.svg', featuredImageAlt: 'Synthetic editorial cover' }));
function Fixture() {
  const [count, setCount] = React.useState(1), [phase, setPhase] = React.useState('ready'), [view, setView] = React.useState('listing');
  const [query, setQuery] = React.useState(''), [selected, setSelected] = React.useState(''), [retried, setRetried] = React.useState(0);
  const remote = useBlogPublicSearch({ site: 'default', basePath: '/journal', posts: posts.slice(0, count), query: view === 'remote' ? query : '' });
  const retry = () => { setRetried(value => value + 1); setPhase('ready'); };
  return <ModalManager recedeSurface={false}><main data-testid="blog-state-fixture" data-zero-theme="next">
    <nav aria-label="Synthetic fixture controls" className="fixture-toolbar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 16 }}>
      {[0, 1, 2, 3, 4, 12].map(value => <button key={value} type="button" onClick={() => setCount(value)}>{value} articles</button>)}
      {['ready', 'loading', 'error'].map(value => <button key={value} type="button" onClick={() => setPhase(value)}>Set {value}</button>)}
      {['listing', 'list palette', 'dropdown', 'palette', 'remote'].map(value => <button key={value} type="button" onClick={() => { setView(value); setQuery(''); }}>Show {value}</button>)}
      <button type="button" onClick={() => document.documentElement.classList.toggle('dark')}>Toggle dark</button>
    </nav><output data-testid="selection">{selected}</output><output data-testid="retries">{retried}</output>
    <BlogProvider>
      {view === 'listing' || view === 'list palette' ? <BlogListPage title="The journal" description="Ideas and stories, from the very first article." posts={posts.slice(0, count)} search={view === 'list palette' ? 'palette' : 'inline'} isLoading={phase === 'loading'} error={phase === 'error'} onRetry={retry} />
        : view === 'dropdown' ? <SearchWithResults posts={posts.slice(0, count)} loading={phase === 'loading'} error={phase === 'error'} onRetry={retry} onSelect={post => { setSelected(post.id); }} />
          : view === 'remote' ? <BlogSearchPalette posts={remote.posts} query={query} onQueryChange={setQuery} filterMode="manual" loading={remote.loading} error={remote.error} onRetry={remote.retry} onSelectPost={post => { setSelected(post.id); }} />
            : <BlogSearchPalette posts={posts.slice(0, count)} loading={phase === 'loading'} error={phase === 'error'} onRetry={retry} onSelectPost={post => { setSelected(post.id); }} />}
    </BlogProvider>
  </main></ModalManager>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
