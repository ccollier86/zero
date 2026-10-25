/** Synthetic UI only, deliberately separate from the recovered reference and all application services. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BlogProvider, BlogListPage, BlogPostPage, ContentImage, NewsletterSignup, type BlogPost, type BlogCategory } from './index';
import { CommandPalette } from '../command-palette';
import { ModalManager } from '../../modals/modal-manager';
import { BlogPartsExamples } from './blog-parts.browser-fixture';

const categories: BlogCategory[] = [{ id: 'engineering', slug: 'engineering', name: 'Engineering', tone: 'accent' }, { id: 'design', slug: 'design', name: 'Design', tone: 'success' }];
const author = { id: 'avery', name: 'Avery Brooks', bio: 'Builds clear, useful interfaces.', role: 'Product engineer' };
const posts: BlogPost[] = Array.from({ length: 18 }, (_, index) => ({ id: `post-${index}`, slug: `article-${index}`, title: index ? `Designing dependable interfaces ${index}` : 'Building a better publishing experience',
  excerpt: 'A considered approach to useful interfaces, thoughtful motion and the details that make a product feel complete.', author, categories: [categories[index % 2]!],
  featuredImage: '/cover.svg', featuredImageAlt: 'Editorial cover', publishedAt: '2026-10-20', readingTime: '6 min read', tags: [{ id: 'systems', name: 'Systems', slug: 'systems' }],
  blocks: Array.from({ length: 22 }, (_, section) => [{ type: 'heading' as const, level: 2 as const, anchor: `section-${section}`, text: `Section ${section + 1}` }, { type: 'paragraph' as const, text: 'Thoughtful defaults leave room for the application. Components remain useful independently and carry no hidden data or publishing responsibilities. '.repeat(4) }]).flat() }));
function Fixture() {
  const [view, setView] = React.useState('magazine'), [selected, setSelected] = React.useState(''), [failCommand, setFailCommand] = React.useState(false);
  return <ModalManager recedeSurface={false}><main data-zero-theme="next" data-testid="blog-fixture">
    <div className="fixture-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 16 }}><button type="button" onClick={() => setView('magazine')}>Show magazine</button><button type="button" onClick={() => setView('article')}>Show article</button><button type="button" onClick={() => setView('parts')}>Show parts</button><label><input type="checkbox" checked={failCommand} onChange={event => setFailCommand(event.currentTarget.checked)} />Fail command</label>
      <CommandPalette title="App commands" trigger="Open app commands" style={{ '--zero-command-palette-width': '36rem' } as React.CSSProperties} items={[{ id: 'billing', label: 'Open billing', description: 'Manage invoices', group: 'navigation' }]} groups={[{ id: 'navigation', label: 'Navigation' }]}
        onSelect={() => { if (failCommand) throw new Error('PRIVATE_COMMAND_ERROR'); setSelected('billing'); }} />
    </div><output data-testid="selection">{selected}</output>
    <BlogProvider style={{ '--zero-blog-type-prose': '19px' } as React.CSSProperties}>
      {view === 'magazine' ? <BlogListPage posts={posts} categories={categories} title="The journal" description="Ideas, stories and considered interfaces." searchProps={{ authors: [author], tags: [{ id: 'systems', slug: 'systems', name: 'Systems' }], shortcut: true, onSelectPost: async post => { if (failCommand) throw new Error('PRIVATE_BLOG_ERROR'); setSelected(post.id); }, onSelectAuthor: value => setSelected(value.id) }} />
        : view === 'parts' ? <BlogPartsExamples posts={posts} categories={categories} author={author} fail={failCommand} onSelect={setSelected} /> : <BlogPostPage post={posts[0]!} content={<><h2 id="introduction">Introduction</h2><p>An article can be rendered directly, with the sidebar generated from its headings.</p><ContentImage src="/cover.svg" alt="Editorial detail" caption="A shared managed lightbox" />{posts[0]!.blocks!.map((block, index) => block.type === 'heading' ? <h2 key={index} id={block.anchor}>{block.text}</h2> : block.type === 'paragraph' ? <p key={index}>{block.text}</p> : null)}</>}
          newsletter={<NewsletterSignup description="Only appears with an integration." onSubscribe={async () => { setSelected('subscribed'); }} />} relatedPosts={posts.slice(1, 4)} />}
    </BlogProvider>
  </main></ModalManager>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
