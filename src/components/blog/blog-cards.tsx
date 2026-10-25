'use client';

import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Card, CardContent, CardMedia } from '../surfaces/card';
import { BlogLink, useBlogPostHref } from './blog-provider';
import { Typography, CategoryBadges, BlogPostMeta, EmptyState, EmptyBlogHero } from './blog-primitives';
import { safeBlogHref } from './blog-utils';
import type { BlogPost, BlogCategory } from './blog.types';

export interface BlogCardProps {
  post: BlogPost; variant?: 'default' | 'featured' | 'compact' | 'horizontal' | 'editorial'; baseUrl?: string;
  showCategory?: boolean; showReadingTime?: boolean; showAuthor?: boolean; className?: string;
  maxCategories?: number;
  onCategoryClick?: (category: BlogCategory) => void; onClick?: (post: BlogPost) => void;
}
export function BlogCard({ post, variant = 'default', baseUrl, showCategory = true, showReadingTime = true, showAuthor = true, maxCategories = 2, onCategoryClick, onClick, className }: BlogCardProps) {
  const hrefFor = useBlogPostHref(), source = safeBlogHref(post.featuredImage);
  return <Card asChild className={cn('zero-blog-card', className)}><article data-variant={variant}>
    {source && <CardMedia className="zero-blog-card-media"><BlogLink href={hrefFor(post, baseUrl)} tabIndex={-1} aria-hidden="true"><img src={source} alt={post.featuredImageAlt ?? ''} loading="lazy" decoding="async" /></BlogLink>
      {showCategory && <CategoryBadges categories={post.categories} maxVisible={maxCategories} onCategoryClick={onCategoryClick} className="zero-blog-card-overlay" />}
      {post.isNew && <span className="zero-blog-new">New</span>}
    </CardMedia>}
    <CardContent className="zero-blog-card-content"><BlogPostMeta post={post} showAuthor={showAuthor} showReadingTime={showReadingTime} />
      <div className="zero-blog-card-title"><Typography variant="h3"><BlogLink href={hrefFor(post, baseUrl)} onClick={() => onClick?.(post)}>{post.title}</BlogLink></Typography><ArrowUpRight aria-hidden="true" /></div>
      {post.excerpt && <Typography color="secondary" lineClamp={variant === 'compact' ? 2 : 3}>{post.excerpt}</Typography>}
      {showCategory && !source && <CategoryBadges categories={post.categories} maxVisible={maxCategories} onCategoryClick={onCategoryClick} />}
    </CardContent>
  </article></Card>;
}
export interface BlogCardGridProps extends Omit<BlogCardProps, 'post'> { posts: readonly BlogPost[]; columns?: 2 | 3 | 4; emptyMessage?: string; empty?: React.ReactNode }
export function BlogCardGrid({ posts, columns = 3, emptyMessage, empty, ...props }: BlogCardGridProps) {
  if (!posts.length) return empty === undefined ? <EmptyState title={emptyMessage ?? 'No articles yet'} /> : empty;
  return <div className="zero-blog-grid" data-columns={columns}>{posts.map(post => <BlogCard key={post.id} post={post} {...props} />)}</div>;
}
export function RecentPostsHero({ posts, title = 'Recent blog posts', baseUrl, onCategoryClick, className, maxCategories = 2, showEmptyState = true, empty }: { posts: readonly BlogPost[]; title?: string; baseUrl?: string; onCategoryClick?: (category: BlogCategory) => void; className?: string; maxCategories?: number; showEmptyState?: boolean; empty?: React.ReactNode }) {
  if (!posts.length) return showEmptyState ? empty ?? <EmptyBlogHero /> : null;
  return <section className={cn('zero-blog-recent', className)} aria-label={title}>
    <Typography variant="h2">{title}</Typography><div className="zero-blog-recent-grid" data-count={Math.min(posts.length, 3)}>
      {posts.slice(0, 3).map((post, index) => <BlogCard key={post.id} post={post} baseUrl={baseUrl} maxCategories={maxCategories} variant={index && posts.length >= 3 ? 'horizontal' : 'editorial'} onCategoryClick={onCategoryClick} />)}
    </div>
  </section>;
}
export function RelatedPosts({ posts, baseUrl, title = 'Related articles' }: { posts: readonly BlogPost[]; baseUrl?: string; title?: string }) {
  if (!posts.length) return null;
  return <section className="zero-blog-related"><Typography variant="h2">{title}</Typography><BlogCardGrid posts={posts} baseUrl={baseUrl} /></section>;
}
