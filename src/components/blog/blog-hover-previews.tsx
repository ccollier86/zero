'use client';

import * as React from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverTrigger, PopoverContent, PopoverViewport } from '../surfaces/popover';
import { MenuActiveHighlight } from '../overlays/menu-active-highlight';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { BlogLink } from './blog-provider';
import { safeBlogHref } from './blog-utils';
import type { BlogAuthor, BlogCategory } from './blog.types';

export interface BlogPreviewOptions {
  children?: React.ReactElement; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end';
  openDelay?: number; closeDelay?: number; tilt?: boolean; className?: string;
}
/** Rich previews are interactive popovers, not interactive controls hidden inside an ARIA tooltip. */
function Preview({ children, content, label, open: controlled, defaultOpen = false, onOpenChange, side = 'top', align = 'center', openDelay = 180, closeDelay = 140, tilt = false, className }: BlogPreviewOptions & { content: React.ReactNode; label: string }) {
  const [local, setLocal] = React.useState(defaultOpen), timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinned = React.useRef(false);
  const returningFocus = React.useRef(false);
  const open = controlled ?? local;
  const change = (value: boolean) => { clearTimeout(timer.current); if (!value) pinned.current = false; if (controlled === undefined) setLocal(value); onOpenChange?.(value); };
  const schedule = (value: boolean) => { clearTimeout(timer.current); if (!value && pinned.current) return; const delay = value ? openDelay : closeDelay; timer.current = setTimeout(() => change(value), Number.isFinite(delay) ? Math.max(0, Math.min(2000, delay)) : 0); };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  React.useEffect(() => { if (!open) { pinned.current = false; clearTimeout(timer.current); } }, [open]);
  return <Popover open={open} onOpenChange={change}>
    <PopoverTrigger asChild onPointerEnter={event => { if (event.pointerType !== 'touch') schedule(true); }} onPointerLeave={() => schedule(false)} onFocus={event => { if (!returningFocus.current && event.currentTarget.matches(':focus-visible')) change(true); }}
      onClick={event => { event.preventDefault(); pinned.current = true; change(true); }}>
      {children ?? <Button type="button" variant="ghost" size="sm">{label}</Button>}
    </PopoverTrigger>
    <PopoverContent className={cn('zero-blog-overlay zero-blog-rich-preview', className)} side={side} align={align}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={() => { returningFocus.current = true; queueMicrotask(() => { returningFocus.current = false; }); }} onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={() => schedule(false)}>
      <PopoverViewport><div className="zero-blog-preview-card" data-tilt={tilt || undefined}
        onPointerMove={event => { if (!tilt || event.pointerType === 'touch') return; const r = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty('--zero-blog-preview-x', String((event.clientX - r.left) / Math.max(1, r.width) * 2 - 1));
          event.currentTarget.style.setProperty('--zero-blog-preview-y', String(1 - (event.clientY - r.top) / Math.max(1, r.height) * 2)); }}
        onPointerLeave={event => { event.currentTarget.style.setProperty('--zero-blog-preview-x', '0'); event.currentTarget.style.setProperty('--zero-blog-preview-y', '0'); }}>{content}</div></PopoverViewport>
    </PopoverContent>
  </Popover>;
}
export interface AuthorTooltipProps extends BlogPreviewOptions { author: BlogAuthor; postCount?: number; onViewPosts?: (author: BlogAuthor) => void; showSocial?: boolean; showBio?: boolean }
export function AuthorTooltip({ author, postCount, onViewPosts, showSocial = true, showBio = true, ...props }: AuthorTooltipProps) {
  const social = author.socialLinks ?? Object.entries(author.social ?? {}).flatMap(([id, href]) => href ? [{ id, label: id === 'twitter' ? 'X' : id, href }] : []);
  const links = social.filter(link => safeBlogHref(link.href, true));
  return <Preview {...props} label={`About ${author.name}`} content={<>
    <div className="zero-blog-preview-person"><Avatar><AvatarImage src={safeBlogHref(author.avatar)} alt="" /><AvatarFallback>{author.name.trim().split(/\s+/u).slice(0, 2).map(part => [...part][0]).join('')}</AvatarFallback></Avatar>
      <div><strong>{author.name}</strong>{author.role && <p>{author.role}</p>}</div></div>
    {showBio && author.bio && <p>{author.bio}</p>}
    {postCount !== undefined && Number.isFinite(postCount) && postCount >= 0 && <p className="zero-blog-muted">{Math.floor(postCount)} {postCount === 1 ? 'article' : 'articles'}</p>}
    {showSocial && !!links.length && <nav className="zero-blog-social-links" aria-label={`${author.name} social links`}>{links.map(link => <BlogLink key={link.id} href={link.href} target="_blank">{link.label}</BlogLink>)}</nav>}
    {onViewPosts ? <Button type="button" variant="link" size="sm" onClick={() => onViewPosts(author)}>View all posts</Button> : author.href && <BlogLink href={author.href}>View all posts</BlogLink>}
  </>} />;
}
export interface CategoryTooltipProps extends BlogPreviewOptions { categories: readonly BlogCategory[]; count?: number; title?: string; onCategoryClick?: (category: BlogCategory) => void }
export function CategoryTooltip({ categories, count, title, onCategoryClick, ...props }: CategoryTooltipProps) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [localOpen, setLocalOpen] = React.useState(props.defaultOpen ?? false);
  const changeOpen = (value: boolean) => { if (props.open === undefined) setLocalOpen(value); props.onOpenChange?.(value); };
  if (!categories.length) return null;
  return <Preview {...props} open={props.open ?? localOpen} onOpenChange={changeOpen} label={title ?? `${count ?? categories.length} more categories`} content={<>
    <strong>{title ?? `${count ?? categories.length} more categories`}</strong><div ref={setContainer} className="zero-blog-preview-categories">
      {categories.map(category => <div key={category.id} data-preview-item="" className="zero-blog-preview-category">
        {onCategoryClick ? <Button type="button" variant="ghost" onClick={() => { onCategoryClick(category); changeOpen(false); }}>{category.name}{category.count !== undefined && <span>{category.count}</span>}</Button>
          : category.href ? <BlogLink href={category.href}>{category.name}</BlogLink> : <strong>{category.name}</strong>}
        {category.description && <p>{category.description}</p>}
      </div>)}<MenuActiveHighlight container={container} activeSelector="[data-preview-item]:focus-within" hoverSelector="[data-preview-item]" preserveSelectionFill={false} />
    </div></>} />;
}
