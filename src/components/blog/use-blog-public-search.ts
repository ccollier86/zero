'use client';
/** Keyed public reads: changed queries never inherit selectable results or failures from an older request. */
import { useEffect, useState } from 'react';
import { createPublicBlogClient } from '../../frontend/client/blog-client';
import { presentPublishedBlogPost } from '../../blog/presentation';
import type { BlogPost } from './blog.types';
interface SearchState { key: string; phase: 'loading' | 'ready' | 'error'; posts: readonly BlogPost[] }
export function useBlogPublicSearch({ site, basePath, posts, query }: { site: string; basePath: string; posts: readonly BlogPost[]; query: string }) {
  const [version, setVersion] = useState(0), [state, setState] = useState<SearchState | null>(null);
  const text = query.trim(), key = JSON.stringify([site, basePath, text, version]);
  useEffect(() => {
    if (!text) return;
    const owner = new AbortController();
    setState({ key, phase: 'loading', posts: [] });
    const timer = setTimeout(() => {
      const client = createPublicBlogClient(window.location.origin);
      void client.posts(site, { search: text, order: 'relevance', limit: 20 }, { signal: owner.signal }).then(page => {
        if (!owner.signal.aborted) setState({ key, phase: 'ready', posts: page.items.map(post => presentPublishedBlogPost(post, { site, basePath })) });
      }).catch(() => { if (!owner.signal.aborted) setState({ key, phase: 'error', posts: [] }); });
    }, 180);
    return () => { clearTimeout(timer); owner.abort(); };
  }, [site, basePath, key, text]);
  const current = state?.key === key ? state : null;
  return { posts: !text ? posts : current?.posts ?? [], loading: Boolean(text) && (!current || current.phase === 'loading'),
    error: Boolean(text) && current?.phase === 'error', retry: () => setVersion(value => value + 1) };
}
