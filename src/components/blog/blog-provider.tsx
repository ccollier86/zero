'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';
import { safeBlogHref, blogPostHref } from './blog-utils';
import type { BlogLinkProps, BlogPost, BlogPresentationOptions } from './blog.types';
import './blog.css';

const BlogContext = React.createContext<BlogPresentationOptions | null>(null);
/** Instance-local presentation defaults only; inherits the app's theme and never installs a data store. */
export function BlogProvider({ children, className, style, ...options }: BlogPresentationOptions & { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const inherited = React.useContext(BlogContext);
  return <BlogContext.Provider value={{ ...inherited, ...options }}><div className={cn(!inherited && 'zero-blog', 'zero-public', className)} style={style}>{children}</div></BlogContext.Provider>;
}
export function useBlogPresentation() { return React.useContext(BlogContext) ?? {}; }
export function useBlogScope() { return React.useContext(BlogContext) !== null; }
export function useBlogPostHref() {
  const options = useBlogPresentation();
  return (post: BlogPost, baseUrl?: string) => safeBlogHref(options.postHref?.(post)) ?? blogPostHref(post, baseUrl ?? options.baseUrl);
}
export function BlogLink({ href, children, ...props }: BlogLinkProps) {
  const { linkComponent: Link } = useBlogPresentation(), safe = safeBlogHref(href, true);
  if (!safe) return <span className={props.className}>{children}</span>;
  const attributes = { ...props, href: safe, ...(props.target === '_blank' ? { rel: 'noopener noreferrer' } : {}) };
  return Link ? <Link {...attributes}>{children}</Link> : <a {...attributes}>{children}</a>;
}
