'use client';

/** Blog-specific result projection into the reusable Zero command palette. No fetching or shared global stores. */
import * as React from 'react';
import { FileText, Tag, Folder } from 'lucide-react';
import { User } from '../animate-ui/icons/user';
import { CommandPalette, type CommandPaletteProps, type CommandPaletteItem } from '../command-palette';
import { safeBlogHref } from './blog-utils';
import { useBlogPostHref } from './blog-provider';
import type { BlogPost, BlogAuthor, BlogCategory, BlogTag } from './blog.types';

type BlogSearchData = { kind: 'post'; value: BlogPost } | { kind: 'author'; value: BlogAuthor } | { kind: 'category'; value: BlogCategory } | { kind: 'tag'; value: BlogTag };
type SelectRecord<T> = (value: T, context: { signal: AbortSignal }) => void | boolean | Promise<void | boolean>;
export interface BlogSearchPaletteProps extends Omit<CommandPaletteProps<BlogSearchData>, 'items' | 'groups' | 'onSelect'> {
  posts: readonly BlogPost[]; authors?: readonly BlogAuthor[]; categories?: readonly BlogCategory[]; tags?: readonly BlogTag[]; baseUrl?: string;
  onSelectPost?: SelectRecord<BlogPost>; onSelectAuthor?: SelectRecord<BlogAuthor>;
  onSelectCategory?: SelectRecord<BlogCategory>; onSelectTag?: SelectRecord<BlogTag>;
}
export function BlogSearchPalette({ posts, authors = [], categories = [], tags = [], baseUrl, onSelectPost, onSelectAuthor, onSelectCategory, onSelectTag, ...props }: BlogSearchPaletteProps) {
  const hrefForPost = useBlogPostHref();
  const items: CommandPaletteItem<BlogSearchData>[] = [
    ...posts.map(post => ({ id: `post:${post.id}`, group: 'posts', label: post.title, description: post.excerpt, keywords: [post.author?.name ?? '', ...(post.tags ?? []).map(tag => tag.name), ...(post.categories ?? []).map(category => category.name)],
      icon: <FileText />, image: safeBlogHref(post.featuredImage) ? <img src={safeBlogHref(post.featuredImage)} alt="" loading="lazy" /> : undefined, data: { kind: 'post' as const, value: post } })),
    ...authors.map(author => ({ id: `author:${author.id}`, group: 'authors', label: author.name, description: author.bio ?? author.role, icon: <User />, image: safeBlogHref(author.avatar) ? <img src={safeBlogHref(author.avatar)} alt="" loading="lazy" /> : undefined, data: { kind: 'author' as const, value: author } })),
    ...categories.map(category => ({ id: `category:${category.id}`, group: 'categories', label: category.name, description: category.description, icon: <Folder />, data: { kind: 'category' as const, value: category } })),
    ...tags.map(tag => ({ id: `tag:${tag.id}`, group: 'tags', label: tag.name, icon: <Tag />, data: { kind: 'tag' as const, value: tag } })),
  ];
  return <CommandPalette {...props} title={props.title ?? 'Search articles'} items={items} groups={[
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
