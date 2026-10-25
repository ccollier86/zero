/** Public presentation data. No account, publication, transport or persistence ownership. */
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';

export interface BlogSocialLink { id: string; label: string; href: string; icon?: ReactNode }
export interface BlogAuthor {
  id: string; name: string; avatar?: string; bio?: string; role?: string; href?: string;
  social?: { twitter?: string; linkedin?: string; github?: string; website?: string };
  socialLinks?: readonly BlogSocialLink[];
}
export interface BlogCategory { id: string; name: string; slug: string; description?: string; count?: number; tone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral'; href?: string }
export interface BlogTag { id: string; name: string; slug: string; count?: number; href?: string }
export interface BlogTocItem { id: string; text?: string; title?: string; level: number; children?: readonly BlogTocItem[] }
export type TocItem = BlogTocItem;
export interface BlogPost {
  id: string; slug: string; title: string; excerpt?: string; href?: string;
  featuredImage?: string; featuredImageAlt?: string; author?: BlogAuthor;
  publishedAt?: string; updatedAt?: string; readingTime?: string;
  categories?: readonly BlogCategory[]; tags?: readonly BlogTag[]; toc?: readonly BlogTocItem[];
  blocks?: readonly BlogContentBlock[]; isNew?: boolean; isFeatured?: boolean;
}
export interface BlogImage { src: string; alt: string; caption?: string; width?: number; height?: number }
export type BlogContentBlock = { id?: string } & (
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 2 | 3 | 4 | 5 | 6; text: string; anchor?: string }
  | { type: 'quote'; text: string; author?: string; source?: string }
  | { type: 'callout'; variant: 'info' | 'warning' | 'error' | 'success' | 'tip'; title?: string; text: string }
  | { type: 'list'; style: 'bullet' | 'numbered'; items: readonly string[] }
  | { type: 'code'; code: string; language?: string; filename?: string; showLineNumbers?: boolean; highlightLines?: readonly number[] }
  | ({ type: 'image' } & BlogImage)
  | { type: 'image-gallery'; images: readonly BlogImage[]; layout?: 'grid' | 'carousel' | 'stack'; columns?: 2 | 3 | 4 }
  | { type: 'video'; src: string; title?: string; poster?: string }
  | { type: 'audio'; src: string; title?: string; artist?: string; coverArt?: string; peaks?: readonly number[] }
  | { type: 'divider' }
  | { type: 'embed'; url: string; title?: string; description?: string; image?: string }
  | { type: 'citation'; text: string; source: string; url?: string }
);
export type ContentBlock = BlogContentBlock;
export interface BlogLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> { href: string; children?: ReactNode }
export interface BlogPresentationOptions {
  baseUrl?: string;
  /** Supply Zero Link in a router-owned app, or any compatible anchor adapter. Native anchors are the portable default. */
  linkComponent?: ComponentType<BlogLinkProps>;
  postHref?: (post: BlogPost) => string;
  locale?: string;
}
export interface BlogPaginationState { currentPage: number; totalPages: number; totalItems?: number; itemsPerPage?: number }
export interface BlogFilterState { search?: string; category?: string | null; tag?: string; author?: string }
