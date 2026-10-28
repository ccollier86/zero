'use client';

/** Blog-specific result projection into the reusable Zero command palette. No fetching or shared global stores. */
import * as React from 'react';
import { FileText, Tag, Folder } from 'lucide-react';
import { User } from '../animate-ui/icons/user';
import { CommandPalette, type CommandPaletteProps, type CommandPaletteItem } from '../command-palette';
import { safeBlogHref } from './blog-utils';
import { useBlogPostHref } from './blog-provider';
import type { BlogPost, BlogAuthor, BlogCategory, BlogTag } from './blog.types';
import { BlogReadError, BlogSearchSkeleton } from './blog-states';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

type BlogSearchData = { kind: 'post'; value: BlogPost } | { kind: 'author'; value: BlogAuthor } | { kind: 'category'; value: BlogCategory } | { kind: 'tag'; value: BlogTag };
type SelectRecord<T> = (value: T, context: { signal: AbortSignal }) => void | boolean | Promise<void | boolean>;
export interface BlogSearchPaletteProps extends Omit<CommandPaletteProps<BlogSearchData>, 'items' | 'groups' | 'onSelect'> {
  posts: readonly BlogPost[]; authors?: readonly BlogAuthor[]; categories?: readonly BlogCategory[]; tags?: readonly BlogTag[]; baseUrl?: string;
  onSelectPost?: SelectRecord<BlogPost>; onSelectAuthor?: SelectRecord<BlogAuthor>;
  onSelectCategory?: SelectRecord<BlogCategory>; onSelectTag?: SelectRecord<BlogTag>;
  error?: boolean; onRetry?: () => void;
  /** Explicit for a manual source: an empty result page is not proof the whole blog is empty. */
  catalogEmpty?: boolean;
}
export function BlogSearchPalette({ posts, authors = [], categories = [], tags = [], baseUrl, onSelectPost, onSelectAuthor, onSelectCategory, onSelectTag, error = false, onRetry, catalogEmpty, ...props }: BlogSearchPaletteProps) {
  const hrefForPost = useBlogPostHref();
  const [observedQuery, setObservedQuery] = React.useState('');
  const query = props.query ?? observedQuery;
  React.useEffect(() => { if (props.open === false) setObservedQuery(''); }, [props.open]);
  const noCatalog = catalogEmpty ?? (!posts.length && !authors.length && !categories.length && !tags.length && props.filterMode !== 'manual');
  const empty = props.empty !== undefined ? props.empty : <div className="zero-blog-search-empty"><strong>{!query.trim() ? noCatalog ? 'No articles yet' : 'Search articles' : 'No matching results'}</strong>
    <p>{query.trim() ? 'Try a different search or explore another category.' : 'Search published articles by title or topic.'}</p>
    {query.trim() && props.query !== undefined && props.onQueryChange && <Button type="button" variant="outline" onClick={() => props.onQueryChange?.('')}>Clear search</Button>}</div>;
  const items: CommandPaletteItem<BlogSearchData>[] = [
    ...posts.map(post => ({ id: `post:${post.id}`, group: 'posts', label: post.title, description: post.excerpt, keywords: [post.author?.name ?? '', ...(post.tags ?? []).map(tag => tag.name), ...(post.categories ?? []).map(category => category.name)],
      icon: <FileText />, image: safeBlogHref(post.featuredImage) ? <img src={safeBlogHref(post.featuredImage)} alt="" loading="lazy" /> : undefined, data: { kind: 'post' as const, value: post } })),
    ...authors.map(author => ({ id: `author:${author.id}`, group: 'authors', label: author.name, description: author.bio ?? author.role, icon: <User />, image: safeBlogHref(author.avatar) ? <img src={safeBlogHref(author.avatar)} alt="" loading="lazy" /> : undefined, data: { kind: 'author' as const, value: author } })),
    ...categories.map(category => ({ id: `category:${category.id}`, group: 'categories', label: category.name, description: category.description, icon: <Folder />, data: { kind: 'category' as const, value: category } })),
    ...tags.map(tag => ({ id: `tag:${tag.id}`, group: 'tags', label: tag.name, icon: <Tag />, data: { kind: 'tag' as const, value: tag } })),
  ];
  return <CommandPalette {...props} className={cn('zero-blog-overlay', props.className)} title={props.title ?? 'Search articles'} items={error ? [] : items}
    loading={props.loading && !error}
    onQueryChange={value => { setObservedQuery(value); props.onQueryChange?.(value); }}
    onOpenChange={open => { if (!open) setObservedQuery(''); props.onOpenChange?.(open); }}
    empty={error ? <BlogReadError compact title="Search is unavailable" description="Your query has been kept. Try again or change your search." onRetry={onRetry} /> : empty}
    loadingContent={props.loadingContent ?? <BlogSearchSkeleton />} groups={[
    { id: 'posts', label: 'Posts', icon: <FileText /> },
    ...(authors.length ? [{ id: 'authors', label: 'Authors', icon: <User />, prefix: '@' }] : []),
    ...(tags.length ? [{ id: 'tags', label: 'Tags', icon: <Tag />, prefix: '#' }] : []),
    ...(categories.length ? [{ id: 'categories', label: 'Categories', icon: <Folder />, prefix: '/' }] : []),
  ]} onSelect={(item, context) => {
    switch (item.data?.kind) {
      case 'post': if (onSelectPost) return onSelectPost(item.data.value, context); window.location.assign(hrefForPost(item.data.value, baseUrl)); break;
      case 'author': if (onSelectAuthor) return onSelectAuthor(item.data.value, context); if (safeBlogHref(item.data.value.href)) window.location.assign(safeBlogHref(item.data.value.href)!); else return false; break;
      case 'category': if (onSelectCategory) return onSelectCategory(item.data.value, context); if (safeBlogHref(item.data.value.href)) window.location.assign(safeBlogHref(item.data.value.href)!); else return false; break;
      case 'tag': if (onSelectTag) return onSelectTag(item.data.value, context); if (safeBlogHref(item.data.value.href)) window.location.assign(safeBlogHref(item.data.value.href)!); else return false; break;
    }
  }} />;
}
