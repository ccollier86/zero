'use client';

import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Text, Heading, type HeadingElement } from '../typography';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '../tooltip';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { BlogLink, useBlogPresentation } from './blog-provider';
import { blogDate, safeBlogHref } from './blog-utils';
import type { BlogAuthor, BlogCategory, BlogPost, BlogSocialLink } from './blog.types';

export interface TypographyProps extends React.HTMLAttributes<HTMLElement> {
  variant?: HeadingElement | 'p' | 'lead' | 'small' | 'caption' | 'label'; color?: 'primary' | 'secondary' | 'tertiary';
  balance?: boolean; lineClamp?: number;
}
export function Typography({ variant = 'p', color = 'primary', balance, lineClamp, style, className, ...props }: TypographyProps) {
  const attributes = { ...props, className: cn('zero-blog-type', className), 'data-blog-type': variant, 'data-color': color,
    style: { ...(balance ? { textWrap: 'balance' as const } : {}), ...(lineClamp ? { display: '-webkit-box', WebkitBoxOrient: 'vertical' as const, WebkitLineClamp: lineClamp, overflow: 'hidden' } : {}), ...style } };
  return /^h[1-6]$/u.test(variant) ? <Heading as={variant as HeadingElement} {...attributes} />
    : <Text as={variant === 'p' || variant === 'lead' ? 'p' : 'span'} {...attributes} />;
}
export function Prose({ className, size = 'lg', ...props }: React.ComponentProps<'div'> & { size?: 'default' | 'lg' }) {
  return <div {...props} className={cn('zero-blog-prose', className)} data-size={size} />;
}
export function BlogPostMeta({ post, showAuthor = true, showReadingTime = true }: { post: BlogPost; showAuthor?: boolean; showReadingTime?: boolean }) {
  const { locale } = useBlogPresentation(), date = blogDate(post.publishedAt, locale);
  if (!(showAuthor && post.author) && !date && !(showReadingTime && post.readingTime)) return null;
  return <div className="zero-blog-meta">
    {showAuthor && post.author && <span className="zero-blog-byline"><AuthorAvatar author={post.author} size="xs" showTooltip /><span>{post.author.name}</span></span>}
    {date && <time dateTime={date.iso}>{date.label}</time>}
    {showReadingTime && post.readingTime && <span>{post.readingTime}</span>}
  </div>;
}
export function AuthorAvatar({ author, size = 'default', showTooltip = false, className }: { author: BlogAuthor; size?: 'xs' | 'sm' | 'default' | 'lg'; showTooltip?: boolean; className?: string }) {
  const image = <Avatar className={cn('zero-blog-avatar', className)} data-size={size}>
    {safeBlogHref(author.avatar) && <AvatarImage src={safeBlogHref(author.avatar)} alt="" />}
    <AvatarFallback>{author.name.trim().split(/\s+/u).slice(0, 2).map(part => [...part][0]).join('')}</AvatarFallback>
  </Avatar>;
  if (!showTooltip) return <span aria-label={author.name}>{image}</span>;
  return <Tooltip><TooltipTrigger asChild><button className="zero-blog-avatar-button" type="button" aria-label={`About ${author.name}`}>{image}</button></TooltipTrigger>
    <TooltipContent title={author.name} description={author.bio ?? author.role} /></Tooltip>;
}
export function AuthorAvatarGroup({ authors, max = 4 }: { authors: readonly BlogAuthor[]; max?: number }) {
  const limit = Math.max(1, Math.floor(max));
  return <div className="zero-blog-avatar-group">{authors.slice(0, limit).map(author => <AuthorAvatar key={author.id} author={author} showTooltip />)}{authors.length > limit && <span>+{authors.length - limit}</span>}</div>;
}
export interface AuthorCardProps { author: BlogAuthor; showSocial?: boolean; showBio?: boolean; postsLink?: string; className?: string; variant?: 'default' | 'inline' | 'featured' }
export function AuthorCard({ author, showSocial = true, showBio = true, postsLink, className, variant = 'default' }: AuthorCardProps) {
  const social: readonly BlogSocialLink[] = author.socialLinks ?? Object.entries(author.social ?? {}).flatMap(([id, href]) => href ? [{ id, label: id === 'twitter' ? 'X' : id === 'github' ? 'GitHub' : id === 'linkedin' ? 'LinkedIn' : 'Website', href }] : []);
  const links = social.filter(link => safeBlogHref(link.href, true));
  return <section className={cn('zero-blog-author-card', className)} data-variant={variant} aria-label={`About ${author.name}`}>
    <AuthorAvatar author={author} size={variant === 'inline' ? 'sm' : 'lg'} /><div><Typography variant="label">{author.name}</Typography>
      {author.role && <Typography variant="small" color="secondary">{author.role}</Typography>}
      {showBio && author.bio && <Typography color="secondary">{author.bio}</Typography>}
      {showSocial && !!links.length && <nav aria-label={`${author.name} social links`} className="zero-blog-social-links">{links.map(link => <BlogLink key={link.id} href={link.href} aria-label={link.label} target="_blank">{link.icon}{link.label}</BlogLink>)}</nav>}
      {postsLink && <BlogLink href={postsLink}>More from {author.name} <ArrowUpRight aria-hidden="true" /></BlogLink>}
    </div>
  </section>;
}
export function AuthorCardInline(props: Omit<AuthorCardProps, 'variant'>) { return <AuthorCard {...props} variant="inline" />; }
export function AuthorCardFeatured(props: Omit<AuthorCardProps, 'variant'>) { return <AuthorCard {...props} variant="featured" />; }
export function CategoryBadges({ categories = [], maxVisible = 2, onCategoryClick, className }: { categories?: readonly BlogCategory[]; maxVisible?: number; onCategoryClick?: (category: BlogCategory) => void; className?: string }) {
  const count = Math.max(1, Math.floor(maxVisible));
  if (!categories.length) return null;
  return <div className={cn('zero-blog-badges', className)}>{categories.slice(0, count).map(category => <Badge key={category.id} variant="secondary" className="zero-blog-category" data-tone={category.tone ?? 'accent'}>
    {onCategoryClick ? <button type="button" onClick={() => onCategoryClick(category)}>{category.name}</button> : category.href ? <BlogLink href={category.href}>{category.name}</BlogLink> : category.name}
  </Badge>)}{categories.length > count && <Tooltip><TooltipTrigger asChild><button className="zero-blog-overflow-badge" type="button" aria-label={`${categories.length - count} more categories`}>+{categories.length - count}</button></TooltipTrigger><TooltipContent>{categories.slice(count).map(category => category.name).join(', ')}</TooltipContent></Tooltip>}</div>;
}
export function EmptyState({ title = 'No articles yet', description, action, className }: { title?: string; description?: string; action?: React.ReactNode; className?: string }) {
  return <div role="status" className={cn('zero-blog-empty', className)}><Typography variant="h3">{title}</Typography>{description && <Typography color="secondary">{description}</Typography>}{action}</div>;
}
export function EmptySearchResults({ query, onClear }: { query?: string; onClear?: () => void }) {
  return <EmptyState title="No results found" description={query ? `No articles match “${query}”. Try another search.` : 'Try another search.'} action={onClear && <Button type="button" variant="outline" onClick={onClear}>Clear search</Button>} />;
}
