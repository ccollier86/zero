'use client';
/** Shared native placeholders and honest read failures. No fake content, requests or navigation. */
import type { ReactNode } from 'react';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
export function BlogCardSkeleton({ className }: { className?: string }) {
  return <div className={cn('zero-blog-skeleton-card', className)} aria-hidden="true" data-slot="blog-card-skeleton">
    <Skeleton className="zero-blog-skeleton zero-blog-skeleton-media" />
    <div className="zero-blog-skeleton-copy"><Skeleton className="zero-blog-skeleton zero-blog-skeleton-line" data-width="short" />
      <Skeleton className="zero-blog-skeleton zero-blog-skeleton-title" /><Skeleton className="zero-blog-skeleton zero-blog-skeleton-line" />
      <Skeleton className="zero-blog-skeleton zero-blog-skeleton-line" data-width="medium" /></div>
  </div>;
}
export function BlogGridSkeleton({ count = 3, columns = 3, label = 'Loading articles…' }: { count?: number; columns?: 2 | 3 | 4; label?: string }) {
  const n = Math.max(1, Math.min(12, Number.isFinite(count) ? Math.floor(count) : 3));
  return <div role="status" aria-live="polite" className="zero-blog-loading"><span className="sr-only">{label}</span>
    <div className="zero-blog-grid" data-columns={Math.min(columns, n)} data-count={n} aria-hidden="true">{Array.from({ length: n }, (_, i) => <BlogCardSkeleton key={i} />)}</div>
  </div>;
}
export function BlogSearchSkeleton({ label = 'Searching articles…' }: { label?: string }) {
  return <div role="status" aria-live="polite" className="zero-blog-search-skeleton"><span className="sr-only">{label}</span>{[0, 1, 2].map(i => <div key={i} aria-hidden="true">
    <Skeleton className="zero-blog-skeleton zero-blog-skeleton-thumbnail" /><span><Skeleton className="zero-blog-skeleton zero-blog-skeleton-line" /><Skeleton className="zero-blog-skeleton zero-blog-skeleton-line" data-width="medium" /></span>
  </div>)}</div>;
}
export function BlogReadError({ title = 'Articles could not be loaded', description = 'Try again. Your search and filters have been kept.', onRetry, compact = false }: {
  title?: string; description?: ReactNode; onRetry?: () => void; compact?: boolean;
}) {
  return <div role="alert" className={cn('zero-blog-read-error', !compact && 'zero-blog-empty')}><strong>{title}</strong>{description && <p>{description}</p>}
    {onRetry && <Button type="button" variant="outline" onClick={onRetry}>Try again</Button>}</div>;
}
